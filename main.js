const { app, BrowserWindow, Menu } = require('electron');

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Standart menüyü kaldırıp tam ekran odaklanma sorununu önler
    Menu.setApplicationMenu(null);

    // Canlı web siteni açar
    win.loadURL('https://amet-r-chat.onrender.com');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});