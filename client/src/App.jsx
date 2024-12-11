import { useCallback, useEffect, useState } from "react";
import Terminal from "./components/terminal";
import "./App.css";
import FileTree from "./components/tree";
import socket from "./socket";
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/ext-language_tools";

function App() {
  const [fileTree, setFileTree] = useState({});
  const [selectedFile, setSelectedFile] = useState("");
  const [code, setCode] = useState("");
  const [selectedFileContent, setSelectedFileContent] = useState("");
  const [passkey, setPasskey] = useState(null);
  const [passkeyError, setPasskeyError] = useState("");
  const [passkeyMessage, setPasskeyMessage] = useState("");

  const isSaved = selectedFileContent === code;

  const getFileTree = async () => {
    const response = await fetch(`http://10.1.241.232:9000/files?passkey=${passkey}`);
    const result = await response.json();
    setFileTree(result.tree);
  };

  const getFileContents = useCallback(async () => {
    if (!selectedFile) return;
    const response = await fetch(
      `http://10.1.241.232:9000/files/content?passkey=${passkey}&path=${selectedFile}`
    );
    const result = await response.json();
    setSelectedFileContent(result.content);
  }, [selectedFile, passkey]);

  useEffect(() => {
    if (passkey) {
      socket.emit("passkey:submitted", passkey);
    }
  }, [passkey]);

  useEffect(() => {
    socket.on("file:refresh", getFileTree);
    socket.on("passkey:accepted", (message) => {
      setPasskeyMessage(message);
      console.log("Passkey accepted, folder opened!");
    });
    socket.on("passkey:exists", (message) => {
      setPasskeyMessage(message);
    });
    socket.on("passkey:error", (message) => {
      setPasskeyError(message);
    });
    return () => {
      socket.off("file:refresh", getFileTree);
      socket.off("passkey:accepted");
      socket.off("passkey:exists");
      socket.off("passkey:error");
    };
  }, []);

  useEffect(() => {
    if (selectedFile) getFileContents();
  }, [getFileContents, selectedFile]);

  useEffect(() => {
    setCode("");
  }, [selectedFile]);

  // Prompt for passkey on first load
  useEffect(() => {
    const promptPasskey = () => {
      const userPasskey = prompt("Please enter a passkey:");
      if (userPasskey) setPasskey(userPasskey);
    };
    if (!passkey) promptPasskey();
  }, [passkey]);

  return (
    <div className="playground-container">
      <div className="editor-container">
        <div className="files">
          <FileTree
            onSelect={(path) => {
              setSelectedFile(path);
            }}
            tree={fileTree}
          />
        </div>
        <div className="editor">
          {selectedFile && (
            <p>
              {selectedFile.replaceAll("/", " > ")} {isSaved ? "saved" : "unsaved"}
            </p>
          )}
          <AceEditor value={code} onChange={(e) => setCode(e)} />
        </div>
      </div>
      <div className="terminal-container">
        <Terminal />
      </div>
      {passkeyError && <div className="error">{passkeyError}</div>}
      {passkeyMessage && <div className="message">{passkeyMessage}</div>}
    </div>
  );
}

export default App;
