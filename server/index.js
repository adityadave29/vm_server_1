const http = require('http'); // Import the http module
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const pty = require('node-pty');
const chokidar = require('chokidar');

// Set the user directory
const BASE_USER_DIR = path.resolve(process.env.INIT_CWD || __dirname, './user');

// Spawn a pseudo-terminal process with the restricted shell
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

// Serve file tree
app.get('/files', async (req, res) => {
    const fileTree = await generateFileTree(BASE_USER_DIR);
    return res.json({ tree: fileTree });
});

// Serve file content
app.get('/files/content', async (req, res) => {
    const filePath = path.resolve(BASE_USER_DIR, `.${req.query.path}`);
    if (!filePath.startsWith(BASE_USER_DIR)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return res.json({ content });
});

server.listen(9000, () => console.log(`🐳 Server running on port 9000`));

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