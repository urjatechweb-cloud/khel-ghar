'use strict';
// Khel Ghar LAN server. One device runs this; everyone on the same Wi-Fi/hotspot opens the printed address.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { _util, ...GAMES } = require('./games');
const PORT = Number(process.env.PORT) || 3000;
const BOT_NAMES = ['Ram', 'Sita', 'Hari', 'Gita', 'Shyam', 'Maya', 'Bikash', 'Sabina'];
const rooms = new Map(); // ponytail: in-memory, rooms vanish when the server stops

const lanIPs = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const fail = m => { throw new Error(m); };
const cleanName = n => String(n || '').trim().slice(0, 16) || 'Player';

function view(room, pid) {
  const seat = room.seats.findIndex(s => s.pid === pid);
  return {
    code: room.code, game: room.game, host: room.host === pid, you: seat,
    seats: room.seats.map(s => ({ name: s.name, bot: !!s.bot, online: !!s.bot || room.clients.some(c => c.pid === s.pid) })),
    state: room.state ? GAMES[room.game].view(room.state, seat) : null,
  };
}
function broadcast(room) {
  for (const c of room.clients) c.res.write(`data: ${JSON.stringify(view(room, c.pid))}\n\n`);
  scheduleBot(room);
}
function scheduleBot(room) {
  if (room.timer || !room.state) return;
  const G = GAMES[room.game];
  const seat = G.pending(room.state).find(i => room.seats[i] && room.seats[i].bot);
  if (seat === undefined) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    if (!rooms.has(room.code) || !room.state || !G.pending(room.state).includes(seat)) return;
    try { G.act(room.state, seat, G.bot(room.state, seat)); } catch (e) { console.error('bot error:', e); return; }
    broadcast(room);
  }, G.botDelay ? G.botDelay(room.state) : 900);
}
function getRoom(code) { return rooms.get(String(code)) || fail('Room not found'); }
function mustHost(room, pid) { if (room.host !== pid) fail('Only the host can do that'); }
function mustLobby(room) { if (room.state) fail('Game already started'); }

const api = {
  info: () => ({ ips: lanIPs(), port: PORT, games: Object.fromEntries(Object.entries(GAMES).map(([k, g]) => [k, { name: g.name, np: g.np, min: g.min, max: g.max }])) }),
  create({ pid, name, game }) {
    if (!GAMES[game]) fail('Unknown game');
    let code;
    do code = String(1000 + Math.floor(Math.random() * 9000)); while (rooms.has(code));
    rooms.set(code, { code, game, host: pid, seats: [{ pid, name: cleanName(name) }], state: null, clients: [], timer: null });
    return { code };
  },
  join({ pid, name, code }) {
    const room = getRoom(code), me = room.seats.find(s => s.pid === pid);
    if (me) me.name = cleanName(name);
    else {
      mustLobby(room);
      if (room.seats.length >= GAMES[room.game].max) fail('Room is full');
      room.seats.push({ pid, name: cleanName(name) });
    }
    broadcast(room);
    return { code: room.code };
  },
  addBot({ pid, code }) {
    const room = getRoom(code);
    mustHost(room, pid); mustLobby(room);
    if (room.seats.length >= GAMES[room.game].max) fail('Room is full');
    const name = BOT_NAMES.find(n => !room.seats.some(s => s.name === n + ' (bot)')) || 'Bot';
    room.seats.push({ pid: 'bot-' + Math.random().toString(36).slice(2), name: name + ' (bot)', bot: true });
    broadcast(room);
  },
  kick({ pid, code, seat }) {
    const room = getRoom(code);
    mustHost(room, pid); mustLobby(room);
    if (!room.seats[seat] || room.seats[seat].pid === pid) fail('Cannot remove that seat');
    room.seats.splice(seat, 1);
    broadcast(room);
  },
  // Leaving in the lobby frees the seat; leaving mid-game hands the seat to a bot so others can finish.
  leave({ pid, code }) {
    const room = getRoom(code), i = room.seats.findIndex(s => s.pid === pid);
    if (i < 0) return;
    if (room.state) Object.assign(room.seats[i], { bot: true, name: room.seats[i].name.replace(/ \(bot\)$/, '') + ' (bot)' });
    else room.seats.splice(i, 1);
    const human = room.seats.find(s => !s.bot);
    if (!human) { clearTimeout(room.timer); rooms.delete(room.code); for (const c of room.clients) c.res.write('data: {"gone":true}\n\n'); return; }
    if (room.host === pid) room.host = human.pid;
    broadcast(room);
  },
  start({ pid, code }) {
    const room = getRoom(code), G = GAMES[room.game];
    mustHost(room, pid); mustLobby(room);
    if (room.seats.length < G.min || room.seats.length > G.max) fail(`${G.name} needs ${G.min === G.max ? G.min : G.min + '–' + G.max} players`);
    room.state = G.init(room.seats.length);
    broadcast(room);
  },
  lobby({ pid, code }) {
    const room = getRoom(code);
    mustHost(room, pid);
    room.state = null;
    clearTimeout(room.timer); room.timer = null;
    broadcast(room);
  },
  act({ pid, code, action }) {
    const room = getRoom(code), seat = room.seats.findIndex(s => s.pid === pid);
    if (!room.state) fail('Game has not started');
    if (seat < 0) fail('You are not in this game');
    if (!action || typeof action !== 'object') fail('Bad move');
    GAMES[room.game].act(room.state, seat, action);
    broadcast(room);
  },
  hint({ pid, code }) {
    const room = getRoom(code), G = GAMES[room.game], seat = room.seats.findIndex(s => s.pid === pid);
    if (!room.state || seat < 0 || !G.hint) fail('No hint');
    return { hint: G.hint(room.state, seat) };
  },
};

const FILES = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/games.js': ['games.js', 'text/javascript'] };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && FILES[u.pathname]) {
    const [file, type] = FILES[u.pathname];
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(__dirname, file)).pipe(res);
  }
  if (req.method === 'GET' && u.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const room = rooms.get(u.searchParams.get('code'));
    if (!room) return res.end('data: {"gone":true}\n\n');
    const client = { pid: u.searchParams.get('pid'), res };
    room.clients.push(client);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); room.clients = room.clients.filter(c => c !== client); if (rooms.has(room.code)) broadcast(room); });
    return broadcast(room);
  }
  if (req.method === 'POST' && u.pathname === '/api') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      let out;
      try {
        const p = JSON.parse(body || '{}');
        if (!api[p.type]) fail('Unknown request');
        if (p.type !== 'info' && (typeof p.pid !== 'string' || !p.pid)) fail('Missing player id');
        out = api[p.type](p) || { ok: true };
      } catch (e) { out = { error: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, '0.0.0.0', () => {
  console.log('\n  खेल घर / Khel Ghar is running.\n  Everyone on the same Wi-Fi or hotspot open:');
  for (const ip of lanIPs()) console.log(`    http://${ip}:${PORT}`);
  console.log(`    (this device: http://localhost:${PORT})\n`);
});
