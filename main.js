const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');

let win;
let client;
let state = { status: 'disconnected', qr: null, sent: 0, failed: 0, total: 0, running: false };

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function sendState(extra = {}) {
  state = { ...state, ...extra };
  if (win && !win.isDestroyed()) win.webContents.send('state', state);
}

function sessionRoot() {
  return path.join(app.getPath('userData'), 'whatsapp-session');
}

function sessionProfile() {
  return path.join(sessionRoot(), 'session-career-wings');
}

function clearStaleChromiumLocks() {
  const profile = sessionProfile();
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const file of lockFiles) {
    const target = path.join(profile, file);
    try {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    } catch {
      // Active Chromium may hold the lock. In that case initialization will report the issue.
    }
  }
}

function normalizePhone(value) {
  let s = String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (!s) return '';
  if (/^[+]?\d+(?:\.\d+)?e[+]?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = Math.trunc(n).toString();
  }
  let digits = s.replace(/\D/g, '');
  if (digits.startsWith('0091')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  if (digits.length === 10) digits = '91' + digits;
  return digits;
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
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#eef8ff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createClient() {
  clearStaleChromiumLocks();
  const browser = findBrowser();
  const puppeteerOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  };

  if (browser) puppeteerOptions.executablePath = browser;

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'career-wings',
      dataPath: sessionRoot()
    }),
    puppeteer: puppeteerOptions
  });

  client.on('qr', async qr => {
    try {
      const dataUrl = await QRCode.toDataURL(qr, { width: 260, margin: 2 });
      sendState({
        status: 'qr',
        qr: dataUrl,
        browserPath: browser || 'Puppeteer managed browser',
        error: ''
      });
    } catch (e) {
      sendState({ status: 'qr', error: 'QR generation failed: ' + e.message });
    }
  });

  client.on('ready', () => sendState({ status: 'connected', qr: null, error: '' }));
  client.on('authenticated', () => sendState({ status: 'authenticated', error: '' }));
  client.on('auth_failure', msg => sendState({ status: 'auth_failure', error: String(msg) }));

  client.on('disconnected', async reason => {
    sendState({ status: 'disconnected', error: String(reason), running: false });
    try { await client.destroy(); } catch {}
    client = null;
  });
}

ipcMain.handle('connect', async () => {
  if (!gotSingleInstanceLock) throw new Error('Another Career Wings WhatsApp Sender instance is already running.');
  if (state.status === 'connected' || state.status === 'authenticated' || state.status === 'qr') return state;

  if (client) {
    try { await client.destroy(); } catch {}
    client = null;
  }

  createClient();

  try {
    await client.initialize();
    return state;
  } catch (e) {
    const browser = findBrowser();
    const profile = sessionProfile();
    const message = String(e.message || e);
    const hint = message.includes('browser is already running')
      ? 'WhatsApp profile is still locked. Close other Career Wings WhatsApp Sender windows and Chrome/Edge, then press Connect again.'
      : browser
        ? 'Detected browser: ' + browser
        : 'Google Chrome or Microsoft Edge was not detected. Please install/update one and try again.';
    try { if (client) await client.destroy(); } catch {}
    client = null;
    sendState({ status: 'disconnected', qr: null, error: message + ' ' + hint, running: false, sessionProfile: profile });
    throw new Error(message + ' ' + hint);
  }
});

ipcMain.handle('disconnect', async () => {
  if (client) {
    try { await client.logout(); } catch {}
    try { await client.destroy(); } catch {}
    client = null;
  }
  sendState({ status: 'disconnected', qr: null, running: false, error: '' });
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
      const digits = normalizePhone(contact.phone);
      if (digits.length !== 12 || !digits.startsWith('91')) {
        throw new Error('Invalid Indian mobile number. Use 10 digits; +91 is added automatically.');
      }

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

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
