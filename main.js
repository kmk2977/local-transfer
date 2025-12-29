const { app, BrowserWindow } = require('electron');
const path = require('path');
const server = require('./server.js');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        title: "Local Transfer",
        backgroundColor: '#0f172a', // Matches app BG
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // When the server notifies us it's ready, load the URL
    server.events.on('started', (data) => {
        if (mainWindow) {
            mainWindow.loadURL(data.localUrl);
        }
    });

    // Start the express server
    server.start(3000);

    // mainWindow.webContents.openDevTools(); // Use for debugging
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
