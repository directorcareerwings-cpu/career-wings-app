const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');

let win;
let client;
let state = { status: 'disconnected', qr: null, sent: 0, failed: 0, total: 0, running: false };

function sendState(extra = {}) {
  state = { ...state, ...extra };
  if (win && !win.isDestroyed()) win.webContents.send('state', state);
}

function findBrowser() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 980, minHeight: 650,
    backgroundColor: '#eef8ff',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createClient() {
  const browser = findBrowser();
  const puppeteerOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  };
  if (browser) puppeteerOptions.executablePath = browser;

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'career-wings',
      dataPath: path.join(app.getPath('userData'), 'whatsapp-session')
    }),
    puppeteer: puppeteerOptions
  });

  client.on('qr', async qr => {
    try {
      const dataUrl = await QRCode.toDataURL(qr, { width: 260, margin: 2 });
      sendState({ status: 'qr', qr: dataUrl, browserPath: browser || 'Puppeteer managed browser' });
    } catch (e) {
      sendState({ status: 'qr', error: 'QR generation failed: ' + e.message });
    }
  });

  client.on('ready', () => sendState({ status: 'connected', qr: null, error: '' }));
  client.on('authenticated', () => sendState({ status: 'authenticated' }));
  client.on('auth_failure', msg => sendState({ status: 'auth_failure', error: String(msg) }));
  client.on('disconnected', reason => sendState({ status: 'disconnected', error: String(reason), running: false }));
}

ipcMain.handle('connect', async () => {
  if (!client) createClient();
  if (['connected','authenticated','qr'].includes(state.status)) return state;
  try {
    await client.initialize();
    return state;
  } catch (e) {
    const browser = findBrowser();
    const hint = browser
      ? 'Detected browser: ' + browser
      : 'Google Chrome or Microsoft Edge was not detected. Please install/update one and try again.';
    sendState({ status: 'disconnected', error: String(e.message || e) + ' ' + hint, running: false });
    try { if (client) await client.destroy(); } catch {}
    client = null;
    throw new Error(String(e.message || e) + ' ' + hint);
  }
});

ipcMain.handle('disconnect', async () => {
  if (client) {
    try { await client.logout(); } catch {}
    try { await client.destroy(); } catch {}
    client = null;
  }
  sendState({ status: 'disconnected', qr: null, running: false });
  return state;
});

ipcMain.handle('send-campaign', async (_event, payload) => {
  if (!client || state.status !== 'connected') throw new Error('Connect WhatsApp first.');
  const contacts = Array.isArray(payload?.contacts) ? payload.contacts : [];
  const message = String(payload?.message || '').trim();
  const delayMs = Math.max(5000, Math.min(60000, Number(payload?.delayMs || 8000)));
  if (!message) throw new Error('Message is required.');
  const eligible = contacts.filter(c => c && c.optedIn && String(c.phone || '').trim());
  sendState({ sent: 0, failed: 0, total: eligible.length, running: true });

  for (const contact of eligible) {
    if (!state.running) break;
    try {
      const digits = String(contact.phone).replace(/\D/g, '');
      if (digits.length < 8) throw new Error('Invalid phone number');
      const chatId = digits + '@c.us';
      const exists = await client.isRegisteredUser(chatId);
      if (!exists) throw new Error('Number is not registered on WhatsApp');
      const text = message.replace(/{{\s*name\s*}}/gi, String(contact.name || 'there'));
      await client.sendMessage(chatId, text);
      sendState({ sent: state.sent + 1 });
    } catch (error) {
      sendState({ failed: state.failed + 1, lastError: String(error.message || error) });
    }
    if (state.running && contact !== eligible[eligible.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  sendState({ running: false });
  return state;
});

ipcMain.handle('stop-campaign', async () => {
  sendState({ running: false });
  return state;
});

ipcMain.handle('import-csv', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return fs.readFileSync(result.filePaths[0], 'utf8');
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
