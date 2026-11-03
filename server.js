'use strict';
// Khel Ghar LAN server. One device runs this; everyone on the same Wi-Fi/hotspot opens the printed address.
// (Online play needs no server: the page hosts rooms in the browser via PeerJS – see index.html.)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { _util, ...GAMES } = require('./games');
const { createHub } = require('./rooms');
const PORT = Number(process.env.PORT) || 3000;
const hub = createHub(GAMES);

const lanIPs = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const info = () => ({ ips: lanIPs(), port: PORT, games: Object.fromEntries(Object.entries(GAMES).map(([k, g]) => [k, { name: g.name, np: g.np, min: g.min, max: g.max }])) });

const FILES = {
  '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
  '/games.js': ['games.js', 'text/javascript'], '/rooms.js': ['rooms.js', 'text/javascript'],
};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && FILES[u.pathname]) {
    const [file, type] = FILES[u.pathname];
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(__dirname, file)).pipe(res);
  }
  if (req.method === 'GET' && u.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const off = hub.subscribe(u.searchParams.get('code'), u.searchParams.get('pid'), d => res.write(`data: ${JSON.stringify(d)}\n\n`));
    if (!off) return res.end();
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); off(); });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/api') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      let out;
      try {
        const p = JSON.parse(body || '{}');
        out = p.type === 'info' ? info() : hub.call(p.type, p);
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
