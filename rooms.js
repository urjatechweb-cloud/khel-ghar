'use strict';
// Room logic shared by the LAN server (server.js) and browser-hosted online rooms (index.html + PeerJS).
// A client is { pid, send(view) }; send receives either a room view or { gone: true }.
(function () {
const BOT_NAMES = ['Ram', 'Sita', 'Hari', 'Gita', 'Shyam', 'Maya', 'Bikash', 'Sabina'];
const fail = m => { throw new Error(m); };
const cleanName = n => String(n || '').trim().slice(0, 16) || 'Player';

function createHub(GAMES, { onChange } = {}) {
  const rooms = new Map(); // ponytail: in-memory; the browser host persists via onChange
  const serialize = r => ({ code: r.code, game: r.game, host: r.host, seats: r.seats, state: r.state });

  function view(room, pid) {
    const seat = room.seats.findIndex(s => s.pid === pid);
    return {
      code: room.code, game: room.game, host: room.host === pid, you: seat,
      seats: room.seats.map(s => ({ name: s.name, bot: !!s.bot, online: !!s.bot || room.clients.some(c => c.pid === s.pid) })),
      state: room.state ? GAMES[room.game].view(room.state, seat) : null,
    };
  }
  function broadcast(room) {
    for (const c of room.clients) c.send(view(room, c.pid));
    if (onChange) onChange(serialize(room));
    scheduleBot(room);
  }
  function scheduleBot(room) {
    if (room.timer || !room.state) return;
    const G = GAMES[room.game];
    const seat = G.pending(room.state).find(i => room.seats[i] && room.seats[i].bot);
    if (seat === undefined) return;
    room.timer = setTimeout(() => {
      room.timer = null;
      if (rooms.get(room.code) !== room || !room.state || !G.pending(room.state).includes(seat)) return;
      try { G.act(room.state, seat, G.bot(room.state, seat)); } catch (e) { console.error('bot error:', e); return; }
      broadcast(room);
    }, G.botDelay ? G.botDelay(room.state) : 900);
  }
  function close(code) {
    const room = rooms.get(String(code));
    if (!room) return;
    clearTimeout(room.timer);
    rooms.delete(room.code);
    for (const c of room.clients) c.send({ gone: true });
    if (onChange) onChange(null);
  }
  const getRoom = code => rooms.get(String(code)) || fail('Room not found');
  const mustHost = (room, pid) => { if (room.host !== pid) fail('Only the host can do that'); };
  const mustLobby = room => { if (room.state) fail('Game already started'); };

  const api = {
    create({ pid, name, game, code }) {
      if (!GAMES[game] || game[0] === '_') fail('Unknown game');
      if (!/^\d{4,5}$/.test(code) || rooms.has(String(code))) do code = String(1000 + Math.floor(Math.random() * 9000)); while (rooms.has(code));
      rooms.set(String(code), { code: String(code), game, host: pid, seats: [{ pid, name: cleanName(name) }], state: null, clients: [], timer: null });
      return { code: String(code) };
    },
    join({ pid, name, code }) {
      const room = getRoom(code), me = room.seats.find(s => s.pid === pid);
      if (me) me.name = me.bot ? me.name : cleanName(name);
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
      if (!human) return close(room.code);
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

  return {
    rooms, close,
    call(type, p) {
      if (!Object.prototype.hasOwnProperty.call(api, type)) fail('Unknown request');
      if (typeof p.pid !== 'string' || !p.pid) fail('Missing player id');
      return api[type](p) || { ok: true };
    },
    // Returns an unsubscribe function, or null when the room does not exist.
    subscribe(code, pid, send) {
      const room = rooms.get(String(code));
      if (!room) { send({ gone: true }); return null; }
      const c = { pid: String(pid), send };
      room.clients.push(c);
      broadcast(room);
      return () => { room.clients = room.clients.filter(x => x !== c); if (rooms.get(room.code) === room) broadcast(room); };
    },
    restore(saved) {
      const room = { ...saved, clients: [], timer: null };
      rooms.set(room.code, room);
      scheduleBot(room);
    },
  };
}

if (typeof module !== 'undefined') module.exports = { createHub }; else window.Rooms = { createHub };
})();
