const http = require('http'); // Import the http module
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const pty = require('node-pty');
const chokidar = require('chokidar');

// Set the base user directory
const BASE_USER_DIR = path.resolve(process.env.INIT_CWD || __dirname, './user');

// Create a custom shell script to restrict the user from going outside the provided folder
const createRestrictedShellScript = (userDir) => `
function cd() {
    local target_dir
    if [[ -z "$1" || "$1" == "." ]]; then
        target_dir=$(pwd)
    elif [[ "$1" == ".." ]]; then
        target_dir=$(realpath "$(pwd)/..")
    else
        target_dir=$(realpath "$(pwd)/$1")
    fi

    # Ensure the target directory is within the user directory
    if [[ $target_dir == ${userDir}* ]]; then
        builtin cd "$target_dir"
    else
        echo "Access denied: Cannot navigate outside the user directory"
    fi
}
PS1="restricted-shell$ "; export PS1
cd "${userDir}"
`;

const app = express();
const server = http.createServer(app);
const io = new SocketServer({
    cors: '*', // Allow CORS
});

app.use(cors());
io.attach(server);

// Watch for file changes in the user directory and notify clients
chokidar.watch(BASE_USER_DIR).on('all', (event, filePath) => {
    io.emit('file:refresh', path.relative(BASE_USER_DIR, filePath));
});

io.on('connection', (socket) => {
    console.log(`Socket connected:`, socket.id);

    // Request passkey from the client when they connect
    socket.emit('request:passkey');

    socket.on('passkey:submitted', async (passkey) => {
        const userDir = path.join(BASE_USER_DIR, passkey);

        try {
            const dirExists = await fs.stat(userDir).catch(() => false);

            if (dirExists) {
                // If directory exists, open the folder
                console.log(`Directory exists: ${userDir}`);
                socket.emit('passkey:accepted', `Welcome back! Folder opened: ${passkey}`);
                setupRestrictedShell(userDir, socket);
            } else {
                // If directory doesn't exist, create it
                await fs.mkdir(userDir, { recursive: true });
                console.log(`Created new directory: ${userDir}`);
                socket.emit('passkey:accepted', `Directory created for passkey: ${passkey}`);
                setupRestrictedShell(userDir, socket);
            }
        } catch (error) {
            console.error('Error handling passkey:', error);
            socket.emit('passkey:error', 'Failed to process passkey');
        }
    });

    const setupRestrictedShell = (userDir, socket) => {
        // Create restricted shell script
        const shellScript = createRestrictedShellScript(userDir);

        // Write the shell script to the user's directory
        fs.writeFile(path.join(userDir, '.restricted_bashrc'), shellScript, 'utf-8')
            .then(() => {
                // Spawn a pseudo-terminal process with the restricted shell
                const ptyProcess = pty.spawn('bash', ['--rcfile', path.join(userDir, '.restricted_bashrc')], {
                    name: 'xterm-color',
                    cols: 80,
                    rows: 30,
                    cwd: userDir, // Set initial working directory
                    env: { ...process.env, HOME: userDir }, // Restrict environment to userDir
                });

                ptyProcess.onData(data => {
                    socket.emit('terminal:data', data);
                });

                socket.on('terminal:write', (data) => {
                    ptyProcess.write(data);
                });
            })
            .catch(err => {
                console.error('Error writing restricted shell script:', err);
                socket.emit('terminal:data', 'Error initializing restricted shell\n');
            });
    };

    socket.on('file:change', async ({ path: filePath, content }) => {
        const absolutePath = path.resolve(BASE_USER_DIR, filePath);
        if (!absolutePath.startsWith(BASE_USER_DIR)) {
            console.log('Unauthorized file access attempt:', absolutePath);
            socket.emit('terminal:data', 'Access denied: Cannot access files outside the user directory\n');
            return;
        }
        await fs.writeFile(absolutePath, content);
    });
});

// Serve file tree for the user's directory
app.get('/files', async (req, res) => {
    const passkey = req.query.passkey;
    const userDir = path.join(BASE_USER_DIR, passkey);

    if (!fs.existsSync(userDir)) {
        return res.status(403).json({ error: 'Access denied: User folder not found' });
    }

    const fileTree = await generateFileTree(userDir);
    return res.json({ tree: fileTree });
});

// Serve file content from the user's folder
app.get('/files/content', async (req, res) => {
    const passkey = req.query.passkey;
    const userDir = path.join(BASE_USER_DIR, passkey);
    const filePath = path.resolve(userDir, `.${req.query.path}`);

    if (!filePath.startsWith(userDir)) {
        return res.status(403).json({ error: 'Access denied: Cannot access files outside your folder' });
    }

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return res.json({ content });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to read file content' });
    }
});

server.listen(9000, '0.0.0.0', () => console.log(`🐳 Server running on port 9000`));

// Function to generate the file tree
async function generateFileTree(directory) {
    const tree = {};

    async function buildTree(currentDir, currentTree) {
        const files = await fs.readdir(currentDir);

        for (const file of files) {
            const filePath = path.join(currentDir, file);
            const stat = await fs.stat(filePath);

            if (stat.isDirectory()) {
                currentTree[file] = {};
                await buildTree(filePath, currentTree[file]);
            } else {
                currentTree[file] = null;
            }
        }
    }

    await buildTree(directory, tree);
    return tree;
}
