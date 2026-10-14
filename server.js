const express = require('express');
const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  DisconnectReason,
  initAuthCreds,
  BufferJSON,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_NAME = process.env.BOT_NAME || 'Tanda Mini Bot';
const OWNER_NAME = process.env.OWNER_NAME || 'Lenny Muriuki';
const COMPANY_NAME = process.env.COMPANY_NAME || 'Deçan Techs';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const sessions = new Map();
const pairingRequests = new Map();
const authLocks = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function encodeAuth(value) {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function decodeAuth(value) {
  return value ? JSON.parse(JSON.stringify(value), BufferJSON.reviver) : value;
}

function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    const error = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    error.status = 503;
    throw error;
  }
}

async function supabaseRequest(table, options = {}) {
  requireSupabase();
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation'
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await response.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = body; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || `Supabase request failed (${response.status})`);
    error.status = 502;
    throw error;
  }
  return data;
}

async function getStoredSession(sessionId) {
  const rows = await supabaseRequest('tanda_sessions', {
    query: { select: '*', session_id: `eq.${sessionId}`, limit: '1' }
  });
  return rows?.[0] || null;
}

async function saveStoredSession(sessionId, patch) {
  const existing = sessions.get(sessionId);
  const row = {
    session_id: sessionId,
    phone: patch.phone || existing?.phone || sessionId,
    creds: encodeAuth(patch.creds || existing?.creds || {}),
    keys: encodeAuth(patch.keys || existing?.keys || {}),
    connected: patch.connected ?? existing?.connected ?? false,
    updated_at: new Date().toISOString()
  };
  const result = await supabaseRequest('tanda_sessions', {
    method: 'POST',
    query: { on_conflict: 'session_id' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: row
  });
  if (existing) Object.assign(existing, row);
  return result;
}

function framed(text) {
  return `╭━━━〔 ✦ ${BOT_NAME.toUpperCase()} ✦ 〕━━━╮\n${text}\n╰━━━━━━━━━━━━━━━━━━╯\n\n© ${COMPANY_NAME} • By ${OWNER_NAME}`;
}

function extractText(message) {
  const m = message?.message;
  return m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    m?.buttonsResponseMessage?.selectedButtonId ||
    m?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    '';
}

async function handleMessage(sock, sessionId, message) {
  if (!message?.message || message.key?.fromMe) return;
  const chat = message.key.remoteJid;
  if (!chat || chat === 'status@broadcast') return;
  const text = extractText(message).trim();
  if (!text.startsWith('.')) return;
  const [rawCommand] = text.slice(1).split(/\s+/);
  const command = (rawCommand || '').toLowerCase();
  const reply = async (body) => sock.sendMessage(chat, { text: framed(body) }, { quoted: message });
  const commands = {
    menu: () => reply(`✨ *Welcome to ${BOT_NAME}*\n\n. menu  •  .help\n.ping  •  .info\n.owner  •  .status\n\nChoose a command and try it.`),
    help: () => reply(`🤖 *${BOT_NAME} is connected.*\n\nTry: .menu, .ping, .info, .owner, .status`),
    ping: () => reply('🏓 Pong! The bot is responding.'),
    info: () => reply(`✦ ${BOT_NAME}\n✦ Created by ${OWNER_NAME}\n✦ ${COMPANY_NAME}\n✦ WhatsApp session powered by Baileys`),
    owner: () => reply(`👑 Owner: ${OWNER_NAME}\n🏢 Company: ${COMPANY_NAME}`),
    status: () => reply(`🟢 Connected and listening.\n📱 Session: ${sessionId}`)
  };
  if (commands[command]) {
    try { await commands[command](); }
    catch (error) { logger.error({ error, sessionId }, 'Command failed'); }
  }
}

async function createAuthState(sessionId, phone) {
  const stored = await getStoredSession(sessionId);
  const record = {
    session_id: sessionId,
    phone,
    creds: stored?.creds && Object.keys(stored.creds).length ? decodeAuth(stored.creds) : initAuthCreds(),
    keys: decodeAuth(stored?.keys || {}),
    connected: stored?.connected || false
  };
  sessions.set(sessionId, { ...record, socket: null, starting: false });
  const writeQueue = async (task) => {
    const previous = authLocks.get(sessionId) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    authLocks.set(sessionId, next);
    try { await next; } finally {
      if (authLocks.get(sessionId) === next) authLocks.delete(sessionId);
    }
  };
  const keyStore = {
    get: async (type, ids) => {
      const output = {};
      for (const id of ids) {
        const value = record.keys?.[type]?.[id];
        output[id] = value === undefined ? null : value;
      }
      return output;
    },
    set: async (data) => {
      for (const [type, entries] of Object.entries(data)) {
        record.keys[type] ||= {};
        for (const [id, value] of Object.entries(entries)) {
          if (value === null || value === undefined) delete record.keys[type][id];
          else record.keys[type][id] = value;
        }
      }
      await writeQueue(() => saveStoredSession(sessionId, { keys: record.keys, creds: record.creds, phone }));
    }
  };
  return {
    state: {
      creds: record.creds,
      keys: makeCacheableSignalKeyStore(keyStore, logger)
    },
    saveCreds: async () => {
      await writeQueue(() => saveStoredSession(sessionId, { creds: record.creds, keys: record.keys, phone }));
    },
    record
  };
}

async function startSession(phone, requestPairing = false) {
  const sessionId = phone;
  const existing = sessions.get(sessionId);
  if (existing?.socket && !existing.socket.ws?.isClosed) {
    if (existing.connected) return { connected: true };
    if (requestPairing) {
      throw Object.assign(new Error('This phone session is already starting. Wait a moment, then check WhatsApp.'), { status: 409 });
    }
    return { connected: Boolean(existing.connected) };
  }
  if (existing?.starting) throw Object.assign(new Error('This phone session is already starting. Wait a moment.'), { status: 409 });
  const auth = await createAuthState(sessionId, phone);
  const entry = sessions.get(sessionId);
  entry.starting = true;
  const sock = makeWASocket({
    auth: auth.state,
    logger: logger.child({ sessionId }),
    printQRInTerminal: false,
    browser: ['Tanda Mini Bot', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false
  });
  entry.socket = sock;
  sock.ev.on('creds.update', async () => {
    try { await auth.saveCreds(); }
    catch (error) { logger.error({ error, sessionId }, 'Could not persist credentials'); }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages) await handleMessage(sock, sessionId, message);
  });
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      entry.connected = true;
      entry.starting = false;
      try { await saveStoredSession(sessionId, { connected: true, creds: auth.record.creds, keys: auth.record.keys, phone }); }
      catch (error) { logger.error({ error, sessionId }, 'Could not store connected status'); }
      logger.info({ sessionId }, 'WhatsApp session connected');
      try {
        await sock.sendMessage(`${phone}@s.whatsapp.net`, {
          text: framed(`🎉 *You are successfully connected to ${BOT_NAME}!*\n\nWelcome aboard. Send *.menu* or *.help* in this chat to try the available commands.\n\nYour session is saved securely in the configured Supabase project.`)
        });
      } catch (error) { logger.warn({ error, sessionId }, 'Could not send connection confirmation'); }
    }
    if (connection === 'close') {
      entry.connected = false;
      entry.starting = false;
      const status = lastDisconnect?.error?.output?.statusCode;
      try { await saveStoredSession(sessionId, { connected: false, creds: auth.record.creds, keys: auth.record.keys, phone }); }
      catch (error) { logger.error({ error, sessionId }, 'Could not store disconnect status'); }
      if (status !== DisconnectReason.loggedOut) {
        setTimeout(() => startSession(phone).catch(error => logger.error({ error, sessionId }, 'Reconnect failed')), 3000);
      } else {
        sessions.delete(sessionId);
        try {
          await supabaseRequest('tanda_sessions', {
            method: 'DELETE',
            query: { session_id: `eq.${sessionId}` },
            prefer: 'return=minimal'
          });
        } catch (error) { logger.error({ error, sessionId }, 'Could not remove logged-out session'); }
      }
    }
  });
  if (requestPairing && !auth.state.creds.registered) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    const code = await sock.requestPairingCode(phone);
    return { code: code.match(/.{1,4}/g)?.join('-') || code };
  }
  return { connected: false };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    name: BOT_NAME,
    sessions: sessions.size,
    connected: [...sessions.values()].filter(item => item.connected).length,
    uptimeSeconds: Math.floor(process.uptime())
  });
});

app.post('/api/pair', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (phone.length < 8 || phone.length > 15) {
      return res.status(400).json({ error: 'Enter a valid phone number including the country code, without + or spaces.' });
    }
    if (pairingRequests.has(phone)) {
      return res.status(429).json({ error: 'A pairing request is already running for this number. Please wait a moment.' });
    }
    pairingRequests.set(phone, Date.now());
    try {
      const result = await startSession(phone, true);
      if (!result.code) return res.status(409).json({ error: 'This phone is already connected or registered.' });
      res.json({ success: true, phone, code: result.code, message: 'Open WhatsApp on your phone and enter this pairing code.' });
    } finally {
      pairingRequests.delete(phone);
    }
  } catch (error) {
    logger.error({ error }, 'Pairing request failed');
    res.status(error.status || 500).json({ error: error.message || 'Could not create pairing code. Please try again.' });
  }
});

app.get('/api/sessions', (req, res) => {
  res.json([...sessions.values()].map(item => ({
    phone: item.phone,
    connected: Boolean(item.connected)
  })));
});

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function restoreSessions() {
  try {
    const rows = await supabaseRequest('tanda_sessions', {
      query: { select: 'session_id,phone,connected,creds,keys' }
    });
    for (const row of rows || []) {
      if (!row?.phone || !row?.creds?.registered) continue;
      startSession(row.phone).catch(error => logger.error({ error, phone: row.phone }, 'Session restore failed'));
    }
    logger.info({ restored: rows?.length || 0 }, 'Loaded saved sessions from Supabase');
  } catch (error) {
    logger.error({ error }, 'Could not restore sessions. Check Supabase configuration and SQL setup.');
  }
}

app.listen(PORT, async () => {
  logger.info({ port: PORT, name: BOT_NAME }, 'Tanda Mini Bot web service started');
  if (SUPABASE_URL && SUPABASE_KEY) await restoreSessions();
  else logger.warn('Supabase is not configured. Pairing and session persistence will not work.');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received; closing sockets');
  for (const item of sessions.values()) {
    try { item.socket?.end(undefined); } catch {}
  }
  process.exit(0);
});
