'use strict';
// Self-check: rule asserts + hundreds of bot-only games per title. Run: node test.js
const assert = require('assert');
const G = require('./games');
const { rank3, cmp, cbLegal, bcMoves } = G._util;
const C = s => s.split(' ').map(x => ({ r: { A: 14, K: 13, Q: 12, J: 11 }[x[0]] || +x.slice(0, -1), s: x.slice(-1) }));

// 3-card ranking order
const order = ['AS AH AD', '2S 2H 2D', 'AS KS QS', 'AS 2S 3S', 'KS QS JS', 'AH KD QC', 'AH 2D 3C', 'KH QD JC', 'AS 9S 2S', 'AS AH KD', '2S 2H AD', 'AS KH JD'];
for (let i = 1; i < order.length; i++) assert(cmp(rank3(C(order[i - 1])), rank3(C(order[i]))) > 0, order[i - 1] + ' > ' + order[i]);

// Callbreak: must beat the trick when following; must trump when void
const s = { phase: 'play', turn: 1, trick: [{ seat: 0, card: { r: 10, s: 'H' } }], hands: [[], C('2H QH 5S 3D')] };
assert.deepStrictEqual(cbLegal(s, 1), C('QH'));
s.hands[1] = C('5S 3D 9S'); assert.deepStrictEqual(cbLegal(s, 1), C('5S 9S'));
s.trick.push({ seat: 1, card: { r: 4, s: 'S' } }); s.turn = 2; s.hands[2] = C('3S 7D');
assert.deepStrictEqual(cbLegal(s, 2), C('3S 7D')); // can't over-trump: any card

// Baag Chal: corner tiger at start has 3 moves; goats place on 21 empty points
const b = Array(25).fill(null); [0, 4, 20, 24].forEach(i => { b[i] = 'T'; });
assert.strictEqual(bcMoves(b, 0, 'G').length, 21);
assert.strictEqual(bcMoves(b, 0, 'T').filter(m => m.from === 0).length, 3);
b[1] = 'G'; assert(bcMoves(b, 1, 'T').some(m => m.from === 0 && m.to === 2 && m.cap === 1));

// Full bot games: must terminate without errors and keep invariants
function play(key, n, check) {
  const g = G[key], st = g.init(n);
  for (let steps = 0; steps < 20000; steps++) {
    const p = g.pending(st);
    if (!p.length && st.phase === 'roundEnd') { g.act(st, 0, { type: 'next' }); continue; }
    if (!p.length) return st;
    g.act(st, p[0], g.bot(st, p[0]));
    check && check(st);
  }
  throw new Error(key + ' did not finish');
}
for (let i = 0; i < 300; i++) {
  const cb = play('callbreak', 4, st => {
    if (st.phase === 'play') assert.strictEqual(st.hands.reduce((t, h) => t + h.length, 0) + st.trick.length + st.tricks.reduce((a, b) => a + b, 0) * 4, 52);
  });
  assert.strictEqual(cb.phase, 'over'); assert.strictEqual(cb.history.length, 5);
  for (const n of [2, 3, 4, 5, 6]) {
    const tp = play('teenpatti', n, st => assert.strictEqual(st.chips.reduce((a, b) => a + b, 0) + st.pot, 100 * n));
    assert.strictEqual(tp.phase, 'end'); assert(tp.result.winners.length >= 1);
  }
  for (const n of [2, 3, 4, 5]) { const k = play('kitti', n); assert.strictEqual(k.phase, 'end'); }
  const bc = play('baagchal', 2); assert(['T', 'G', 'draw'].includes(bc.winner));
  for (const n of [2, 3, 4]) { const l = play('ludo', n); assert(l.pos[l.winner].every(p => p === 56)); }
}
// Marriage: set rules, wilds, scoring, and full bot rounds
const { mValid, mNatural, mFindSee, mWildOf, mMaal } = G._util;
assert(mNatural(C('4H 5H 6H')) && mNatural(C('AS 2S 3S')) && mNatural(C('QS KS AS')) && mNatural(C('7D 7D 7D')));
assert(!mNatural(C('KS AS 2S')) && !mNatural(C('7D 7H 7S')) && !mNatural(C('4H 5D 6H')));
const w5 = mWildOf({ r: 5, s: 'H' }); // wild: every 5, plus 4H and 6H
assert(mValid(C('7D 7H 7S'), w5) && mValid(C('9C 5S JC'), w5) && mValid(C('9C 4H 9D'), w5) && !mValid(C('9C 4H KD'), w5) && !mValid(C('9C 8D KD'), w5) && !mValid(C('7D 7D 7S'), w5));
assert.strictEqual(mMaal(C('5H 4H 6H 5D 5S'), { r: 5, s: 'H' }), 3 + 2 + 2 + 5);
assert.strictEqual(mFindSee(C('2S 3S 4S 9D 9D 9D JC QC KC 5H')).length, 3);
assert.strictEqual(mFindSee(C('2S 3S 4S 9D 9D JC QC KC 5H')), null);
// Dublee: 7 pairs see the Maal, the 8th pair finishes (+5 bonus from each player)
assert.strictEqual(G._util.mFindDublee(C('2S 2S 3H 3H 4D 4D 5C 5C 6S 6S 7H 7H 8D 8D 9C')).length, 7);
assert.strictEqual(G._util.mFindDublee(C('2S 2S 3H 3H 4D 4D 5C 5C 6S 6S 7H 7H 8D 9C')), null);
{
  const M = G.marriage, st = M.init(4), p = st.turn;
  st.hands[p] = C('2S 2S 3H 3H 4D 4D 5C 5C 6S 6S 7H 7H 8D 8D 9C 10C JC QC KC AD 3S');
  st.stock.push(C('9C')[0]);
  M.act(st, p, { type: 'draw', from: 'stock' });
  M.act(st, p, { type: 'see', mode: 'dublee' });
  assert(st.dublee[p] && st.seen[p] && st.melds[p].length === 7 && st.hands[p].length === 8);
  const h = st.hands[p], pair = h.find((c, i) => h.some((o, j) => j !== i && o.r === c.r && o.s === c.s));
  const single = h.find(c => h.filter(o => o.r === c.r && o.s === c.s).length === 1);
  assert.throws(() => M.act(st, p, { type: 'finish', card: pair }), /8th dublee/); // throwing half the pair breaks it
  M.act(st, p, { type: 'finish', card: single });
  assert.strictEqual(st.phase, 'end'); assert(st.result.dublee);
  assert.strictEqual(st.result.scores.reduce((a, b) => a + b, 0), 0);
  assert(st.result.scores.every((v, i) => i === p ? v > 0 : v < 0));
}
for (let i = 0; i < 150; i++) {
  const n = 2 + i % 4;
  const m = play('marriage', n, st => {
    if (st.phase !== 'play') return;
    const total = st.hands.flat().length + st.melds.flat().flat().length + st.stock.length + st.discard.length + 1;
    assert.strictEqual(total, 156);
  });
  assert.strictEqual(m.phase, 'end');
  assert.strictEqual(m.result.scores.reduce((a, b) => a + b, 0), 0);
}

// Illegal moves are rejected
const cb = G.callbreak.init(4);
assert.throws(() => G.callbreak.act(cb, 0, { type: 'bid', v: 3 }), /Not your turn/);
assert.throws(() => G.callbreak.act(cb, cb.turn, { type: 'bid', v: 9 }), /1–8/);
const kt = G.kitti.init(2);
assert.throws(() => G.kitti.act(kt, 0, { type: 'submit', groups: [kt.hands[1].slice(0, 3), kt.hands[0].slice(3, 6), kt.hands[0].slice(6)] }));
// Room hub (shared by the LAN server and browser hosts): seats, privacy, leave → bot, last human closes
{
  const { _util, ...GAMES } = G, hub = require('./rooms').createHub(GAMES), seen = { a: [], b: [] };
  const { code } = hub.call('create', { pid: 'a', name: 'Asha', game: 'callbreak', code: '55555' });
  assert.strictEqual(code, '55555');
  assert.match(hub.call('create', { pid: 'z', name: 'Z', game: 'ludo', code: null }).code, /^\d{4}$/); // no code → generated
  hub.subscribe(code, 'a', v => seen.a.push(v)); hub.subscribe(code, 'b', v => seen.b.push(v));
  hub.call('join', { pid: 'b', name: 'Bikram', code });
  assert.throws(() => hub.call('addBot', { pid: 'b', code }), /host/);
  hub.call('addBot', { pid: 'a', code }); hub.call('addBot', { pid: 'a', code });
  hub.call('start', { pid: 'a', code });
  const va = seen.a[seen.a.length - 1], vb = seen.b[seen.b.length - 1];
  assert.strictEqual(va.state.hand.length, 13); assert.strictEqual(vb.you, 1);
  assert.notDeepStrictEqual(va.state.hand, vb.state.hand); // each player only sees their own cards
  assert(!JSON.stringify(vb).includes('"hands"'));
  hub.call('leave', { pid: 'b', code });
  assert(hub.rooms.get(code).seats[1].bot);
  hub.call('leave', { pid: 'a', code });
  assert(!hub.rooms.has(code)); assert.deepStrictEqual(seen.b[seen.b.length - 1], { gone: true });
  assert.throws(() => hub.call('info', { pid: 'a' }), /Unknown request/);
}
console.log('All checks passed');
