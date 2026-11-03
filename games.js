'use strict';
(function () {
// Game rules. Each game: { name, np, min, max, init(n), act(s, seat, a), view(s, seat), pending(s), bot(s, seat), hint?(s, seat) }
// act() throws Error(message) for illegal moves; the server sends the message to the player.

const SUITS = ['S', 'H', 'D', 'C'];
const deck = () => SUITS.flatMap(s => Array.from({ length: 13 }, (_, i) => ({ r: i + 2, s })));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const eq = (a, b) => !!a && !!b && a.r === b.r && a.s === b.s;
const sortHand = h => h.sort((a, b) => SUITS.indexOf(a.s) - SUITS.indexOf(b.s) || b.r - a.r);
const fail = m => { throw new Error(m); };
const pick = a => a[Math.floor(Math.random() * a.length)];
function takeCard(hand, c) {
  const i = hand.findIndex(h => eq(h, c));
  if (i < 0) fail('You do not have that card');
  return hand.splice(i, 1)[0];
}

// ---------- 3-card hand ranking (Teen Patti, Kitti) ----------
const HAND_NAMES = ['High card', 'Pair', 'Color', 'Sequence', 'Pure sequence', 'Trail'];
function rank3(cs) {
  const r = cs.map(c => c.r).sort((a, b) => b - a);
  const flush = cs.every(c => c.s === cs[0].s);
  // A-K-Q is the top run, A-2-3 second, then K-Q-J ... 4-3-2
  const seq = r[0] === 14 && r[1] === 3 && r[2] === 2 ? 15
    : r[0] - 1 === r[1] && r[1] - 1 === r[2] ? (r[0] === 14 ? 16 : r[0]) : 0;
  if (r[0] === r[2]) return [5, r[0]];
  if (seq) return [flush ? 4 : 3, seq];
  if (flush) return [2, ...r];
  if (r[0] === r[1]) return [1, r[0], r[2]];
  if (r[1] === r[2]) return [1, r[1], r[0]];
  return [0, ...r];
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const handName = cs => HAND_NAMES[rank3(cs)[0]];

// ================= CALLBREAK =================
function cbDeal(s) {
  s.round++;
  s.dealer = (s.dealer + 1) % 4;
  const d = shuffle(deck());
  s.hands = [0, 1, 2, 3].map(i => sortHand(d.slice(i * 13, i * 13 + 13)));
  s.bids = [null, null, null, null];
  s.tricks = [0, 0, 0, 0];
  s.trick = [];
  s.lastTrick = null;
  s.turn = (s.dealer + 1) % 4;
  s.phase = 'bid';
}
function cbWinner(trick) {
  let w = trick[0];
  for (const t of trick)
    if ((t.card.s === w.card.s && t.card.r > w.card.r) || (t.card.s === 'S' && w.card.s !== 'S')) w = t;
  return w.seat;
}
// Must follow suit and beat the trick if possible; if void, must trump (and over-trump if possible).
function cbLegal(s, seat) {
  if (s.phase !== 'play' || s.turn !== seat) return [];
  const hand = s.hands[seat];
  if (!s.trick.length) return hand.slice();
  const lead = s.trick[0].card.s;
  const top = s.trick.find(t => t.seat === cbWinner(s.trick)).card;
  const follow = hand.filter(c => c.s === lead);
  if (follow.length) {
    if (top.s !== lead) return follow;
    const higher = follow.filter(c => c.r > top.r);
    return higher.length ? higher : follow;
  }
  const spades = hand.filter(c => c.s === 'S');
  if (spades.length) {
    if (top.s !== 'S') return spades;
    const higher = spades.filter(c => c.r > top.r);
    return higher.length ? higher : hand.slice();
  }
  return hand.slice();
}
function cbBotBid(hand) {
  let b = 0;
  for (const s of SUITS) {
    const cs = hand.filter(c => c.s === s), len = cs.length, has = r => cs.some(c => c.r === r);
    if (s === 'S') { b += (has(14) ? 1 : 0) + (has(13) && len >= 2 ? 0.8 : 0) + (has(12) && len >= 3 ? 0.5 : 0) + Math.max(0, len - 3) * 0.7; continue; }
    if (has(14)) b += len <= 5 ? 1 : 0.6;
    if (has(13) && len >= 2 && len <= 4) b += 0.6;
    if (len <= 1 && hand.filter(c => c.s === 'S').length >= 3) b += 0.5;
  }
  return Math.max(1, Math.min(8, Math.round(b)));
}
const cbLow = c => (c.s === 'S' ? 100 : 0) + c.r;
const callbreak = {
  name: 'Callbreak', np: 'कल ब्रेक', min: 4, max: 4,
  init() { const s = { round: 0, rounds: 5, dealer: 3, totals: [0, 0, 0, 0], history: [] }; cbDeal(s); return s; },
  act(s, seat, a) {
    if (a.type === 'next') {
      if (s.phase === 'roundEnd') return cbDeal(s);
      if (s.phase === 'over') return Object.assign(s, callbreak.init());
      fail('Round is not over yet');
    }
    if (s.turn !== seat) fail('Not your turn');
    if (s.phase === 'bid') {
      if (a.type !== 'bid') fail('Place your bid first');
      const v = Number(a.v);
      if (!Number.isInteger(v) || v < 1 || v > 8) fail('Bid must be 1–8');
      s.bids[seat] = v;
      s.turn = (seat + 1) % 4;
      if (s.bids.every(b => b !== null)) { s.phase = 'play'; s.turn = (s.dealer + 1) % 4; }
      return;
    }
    if (s.phase !== 'play' || a.type !== 'play') fail('Not now');
    if (!cbLegal(s, seat).some(c => eq(c, a.card))) fail('Follow suit / beat the trick / trump if you can');
    s.trick.push({ seat, card: takeCard(s.hands[seat], a.card) });
    if (s.trick.length < 4) { s.turn = (seat + 1) % 4; return; }
    const w = cbWinner(s.trick);
    s.tricks[w]++;
    s.lastTrick = { cards: s.trick, winner: w };
    s.trick = [];
    s.turn = w;
    if (s.hands[w].length) return;
    const sc = s.bids.map((b, i) => s.tricks[i] >= b ? Math.round((b + (s.tricks[i] - b) / 10) * 10) / 10 : -b);
    s.history.push(sc);
    s.totals = s.totals.map((t, i) => Math.round((t + sc[i]) * 10) / 10);
    s.phase = s.round >= s.rounds ? 'over' : 'roundEnd';
  },
  view(s, seat) {
    const { hands, ...pub } = s;
    return { ...pub, hand: hands[seat] || [], counts: hands.map(h => h.length), legal: cbLegal(s, seat) };
  },
  pending: s => (s.phase === 'bid' || s.phase === 'play') ? [s.turn] : [],
  botDelay: s => s.phase === 'play' && !s.trick.length && s.lastTrick ? 1900 : 900, // let players see the finished trick
  bot(s, seat) {
    const hand = s.hands[seat];
    if (s.phase === 'bid') return { type: 'bid', v: cbBotBid(hand) };
    const L = cbLegal(s, seat);
    if (!s.trick.length) {
      const ace = L.find(c => c.r === 14 && c.s !== 'S');
      return { type: 'play', card: ace || L.reduce((m, c) => cbLow(c) < cbLow(m) ? c : m) };
    }
    const wins = L.filter(c => cbWinner([...s.trick, { seat, card: c }]) === seat);
    const pool = wins.length ? wins : L;
    return { type: 'play', card: pool.reduce((m, c) => cbLow(c) < cbLow(m) ? c : m) };
  },
};

// ================= TEEN PATTI =================
const TP_MAX_STAKE = 32;
function tpDeal(s) {
  s.dealer = (s.dealer + 1) % s.n;
  const d = shuffle(deck());
  s.hands = Array.from({ length: s.n }, (_, i) => d.slice(i * 3, i * 3 + 3));
  s.seen = Array(s.n).fill(false);
  s.folded = Array(s.n).fill(false);
  s.pot = 0;
  for (let i = 0; i < s.n; i++) { s.chips[i] -= s.boot; s.pot += s.boot; }
  s.stake = s.boot;
  s.turn = (s.dealer + 1) % s.n;
  s.phase = 'bet';
  s.result = null;
  s.log = [];
}
const tpActive = s => s.folded.map((f, i) => f ? -1 : i).filter(i => i >= 0);
const tpCost = (s, seat) => s.seen[seat] ? 2 * s.stake : s.stake;
function tpPay(s, seat) { const c = tpCost(s, seat); s.chips[seat] -= c; s.pot += c; return c; }
function tpNext(s) { do s.turn = (s.turn + 1) % s.n; while (s.folded[s.turn]); }
function tpFinish(s, players, asker) {
  const ranks = players.map(p => rank3(s.hands[p]));
  const best = ranks.reduce((m, r) => cmp(r, m) > 0 ? r : m);
  let winners = players.filter((p, i) => cmp(ranks[i], best) === 0);
  if (asker !== undefined && winners.length > 1) winners = winners.filter(p => p !== asker); // tie on show: asker loses
  const share = Math.floor(s.pot / winners.length);
  winners.forEach((w, i) => { s.chips[w] += share + (i === 0 ? s.pot - share * winners.length : 0); });
  s.result = { winners, pot: s.pot, shown: players.length > 1 ? players.map(p => ({ seat: p, hand: s.hands[p], name: handName(s.hands[p]) })) : [] };
  s.pot = 0;
  s.phase = 'end';
}
const teenpatti = {
  name: 'Teen Patti', np: 'तीन पत्ती', min: 2, max: 6,
  init(n) { const s = { n, chips: Array(n).fill(100), dealer: n - 1, boot: 1, potLimit: 40 * n }; tpDeal(s); return s; },
  act(s, seat, a) {
    if (a.type === 'next') { if (s.phase !== 'end') fail('Round is not over yet'); return tpDeal(s); }
    if (s.phase !== 'bet') fail('Not now');
    if (s.folded[seat]) fail('You have packed');
    if (a.type === 'see') { s.seen[seat] = true; return; }
    if (s.turn !== seat) fail('Not your turn');
    const active = tpActive(s);
    if (a.type === 'pack') {
      s.folded[seat] = true;
      s.log.push({ seat, t: 'pack' });
      const left = tpActive(s);
      if (left.length === 1) return tpFinish(s, left);
      return tpNext(s);
    }
    if (a.type === 'chaal' || a.type === 'raise') {
      if (a.type === 'raise') { if (s.stake >= TP_MAX_STAKE) fail('Stake is at maximum'); s.stake *= 2; }
      s.log.push({ seat, t: a.type, c: tpPay(s, seat) });
      if (s.pot >= s.potLimit) return tpFinish(s, active); // pot limit reached: everyone shows
      return tpNext(s);
    }
    if (a.type === 'show') {
      if (active.length !== 2) fail('Show is allowed only when 2 players remain');
      s.log.push({ seat, t: 'show', c: tpPay(s, seat) });
      return tpFinish(s, active, seat);
    }
    fail('Unknown move');
  },
  view(s, seat) {
    const { hands, ...pub } = s;
    const shown = s.result ? s.result.shown.map(x => x.seat) : [];
    return {
      ...pub, active: tpActive(s).length,
      hand: hands[seat] && (s.seen[seat] || shown.includes(seat)) ? hands[seat] : null,
      handName: hands[seat] && s.seen[seat] ? handName(hands[seat]) : null,
      cost: seat >= 0 ? tpCost(s, seat) : 0, maxStake: TP_MAX_STAKE,
    };
  },
  pending: s => s.phase === 'bet' ? [s.turn] : [],
  bot(s, seat) {
    if (!s.seen[seat] && (s.stake >= 4 || Math.random() < 0.5)) return { type: 'see' };
    if (!s.seen[seat]) return { type: 'chaal' };
    const r = rank3(s.hands[seat]), two = tpActive(s).length === 2;
    if (r[0] >= 2) {
      if (two && s.stake >= 16) return { type: 'show' };
      return { type: s.stake < 16 ? 'raise' : 'chaal' };
    }
    if (r[0] === 1) {
      if (two && s.stake >= 4) return { type: 'show' };
      return { type: s.stake <= 8 ? 'chaal' : 'pack' };
    }
    if (r[1] >= 13 && s.stake <= 2) return { type: two ? 'show' : 'chaal' };
    return { type: 'pack' };
  },
};

// ================= KITTI (9 cards → 3 hands) =================
function sortGroups(gs) { return gs.slice().sort((a, b) => cmp(rank3(b), rank3(a))); }
function autoArrange(h) {
  let best = null, bs = -1;
  for (let a = 1; a < 9; a++) for (let b = a + 1; b < 9; b++) {
    const g1 = [0, a, b], rest = [...Array(9).keys()].filter(i => !g1.includes(i));
    for (let x = 1; x < 6; x++) for (let y = x + 1; y < 6; y++) {
      const g2 = [rest[0], rest[x], rest[y]], g3 = rest.filter(i => !g2.includes(i));
      const gs = [g1, g2, g3].map(g => g.map(i => h[i]));
      const sc = gs.reduce((t, g) => { const r = rank3(g); return t + r[0] * 100 + r[1]; }, 0);
      if (sc > bs) { bs = sc; best = gs; }
    }
  }
  return sortGroups(best);
}
function kDeal(s) {
  const d = shuffle(deck());
  s.hands = Array.from({ length: s.n }, (_, i) => sortHand(d.slice(i * 9, i * 9 + 9)));
  s.arranged = Array(s.n).fill(null);
  s.phase = 'arrange';
  s.result = null;
}
const kitti = {
  name: 'Kitti', np: 'किट्टी', min: 2, max: 5,
  init(n) { const s = { n, points: Array(n).fill(0), carry: 0 }; kDeal(s); return s; },
  act(s, seat, a) {
    if (a.type === 'next') { if (s.phase !== 'end') fail('Round is not over yet'); return kDeal(s); }
    if (s.phase !== 'arrange' || a.type !== 'submit') fail('Not now');
    if (s.arranged[seat]) fail('Already submitted');
    const g = a.groups;
    if (!Array.isArray(g) || g.length !== 3 || g.some(x => !Array.isArray(x) || x.length !== 3)) fail('Make 3 hands of 3 cards');
    const left = s.hands[seat].slice();
    const groups = g.map(x => x.map(c => takeCard(left, c))); // throws on unknown/duplicate card
    s.arranged[seat] = sortGroups(groups);
    if (s.arranged.some(x => !x)) return;
    const wins = Array(s.n).fill(0), slots = [];
    for (let k = 0; k < 3; k++) {
      const rs = s.arranged.map(x => rank3(x[k]));
      const best = rs.reduce((m, r) => cmp(r, m) > 0 ? r : m);
      const top = rs.map((r, i) => cmp(r, best) === 0 ? i : -1).filter(i => i >= 0);
      slots.push(top.length === 1 ? top[0] : null);
      if (top.length === 1) wins[top[0]]++;
    }
    const max = Math.max(...wins), lead = wins.map((w, i) => w === max ? i : -1).filter(i => i >= 0);
    const winner = lead.length === 1 ? lead[0] : null;
    if (winner === null) s.carry++; else { s.points[winner] += 1 + s.carry; s.carry = 0; }
    s.result = { slots, wins, winner, names: s.arranged.map(x => x.map(handName)) };
    s.phase = 'end';
  },
  view(s, seat) {
    const { hands, arranged, ...pub } = s;
    return {
      ...pub, hand: hands[seat] || [], mine: arranged[seat] || null,
      submitted: arranged.map(Boolean), all: s.phase === 'end' ? arranged : null,
    };
  },
  pending: s => s.phase === 'arrange' ? s.arranged.map((x, i) => x ? -1 : i).filter(i => i >= 0) : [],
  bot: (s, seat) => ({ type: 'submit', groups: autoArrange(s.hands[seat]) }),
  hint: (s, seat) => autoArrange(s.hands[seat]),
};

// ================= BAAG CHAL (Tigers & Goats) =================
const BC_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const inb = (r, c) => r >= 0 && r < 5 && c >= 0 && c < 5;
// Diagonal lines exist only through points where row+col is even.
function bcMoves(board, placed, side) {
  const out = [];
  if (side === 'G' && placed < 20) { board.forEach((p, i) => { if (!p) out.push({ from: null, to: i, cap: null }); }); return out; }
  board.forEach((p, i) => {
    if (p !== side) return;
    const r = Math.floor(i / 5), c = i % 5;
    for (const [dr, dc] of BC_DIRS) {
      if (dr && dc && (r + c) % 2) continue;
      const r1 = r + dr, c1 = c + dc;
      if (!inb(r1, c1)) continue;
      const j = r1 * 5 + c1;
      if (!board[j]) out.push({ from: i, to: j, cap: null });
      else if (side === 'T' && board[j] === 'G' && inb(r1 + dr, c1 + dc) && !board[(r1 + dr) * 5 + c1 + dc])
        out.push({ from: i, to: (r1 + dr) * 5 + c1 + dc, cap: j });
    }
  });
  return out;
}
function bcApply(b, m, side) {
  if (m.from !== null) b[m.from] = null;
  b[m.to] = side;
  if (m.cap !== null) b[m.cap] = null;
}
const bcSide = seat => seat === 0 ? 'G' : 'T';
const baagchal = {
  name: 'Baag Chal', np: 'बाघ चाल', min: 2, max: 2,
  init() {
    const board = Array(25).fill(null);
    [0, 4, 20, 24].forEach(i => { board[i] = 'T'; });
    return { board, turn: 'G', placed: 0, captured: 0, phase: 'play', winner: null, seen: {}, last: null };
  },
  act(s, seat, a) {
    if (a.type === 'next') { if (s.phase !== 'over') fail('Game is not over'); return Object.assign(s, baagchal.init()); }
    if (s.phase !== 'play') fail('Game over');
    if (bcSide(seat) !== s.turn) fail('Not your turn');
    const from = a.from === null || a.from === undefined ? null : Number(a.from), to = Number(a.to);
    const m = bcMoves(s.board, s.placed, s.turn).find(x => x.from === from && x.to === to);
    if (!m) fail('Illegal move');
    bcApply(s.board, m, s.turn);
    if (m.from === null) s.placed++;
    if (m.cap !== null) s.captured++;
    s.last = m;
    s.turn = s.turn === 'G' ? 'T' : 'G';
    if (s.captured >= 5) s.winner = 'T';
    else if (!bcMoves(s.board, s.placed, s.turn).length) s.winner = s.turn === 'G' ? 'T' : 'G';
    else if (s.placed === 20) {
      const k = s.board.map(p => p || '.').join('') + s.turn;
      s.seen[k] = (s.seen[k] || 0) + 1;
      if (s.seen[k] >= 3) s.winner = 'draw';
    }
    if (s.winner) s.phase = 'over';
  },
  view(s, seat) {
    const { seen, ...pub } = s;
    return { ...pub, side: seat >= 0 ? bcSide(seat) : null, moves: s.phase === 'play' && seat >= 0 && bcSide(seat) === s.turn ? bcMoves(s.board, s.placed, s.turn) : [] };
  },
  pending: s => s.phase === 'play' ? [s.turn === 'G' ? 0 : 1] : [],
  bot(s, seat) {
    const side = bcSide(seat), ms = bcMoves(s.board, s.placed, side);
    const after = m => { const b = s.board.slice(); bcApply(b, m, side); return bcMoves(b, s.placed + (m.from === null ? 1 : 0), side === 'G' ? 'T' : 'G'); };
    let best = null, bs = -Infinity;
    for (const m of ms) {
      let sc;
      if (side === 'T') {
        const b = s.board.slice(); bcApply(b, m, 'T');
        const threats = bcMoves(b, 20, 'T').filter(x => x.cap !== null).length; // goats' reply ignored: greedy
        sc = (m.cap !== null ? 1000 : 0) + threats * 10;
      } else {
        const t = after(m);
        sc = -t.filter(x => x.cap !== null).length * 100 - t.length;
      }
      sc += Math.random();
      if (sc > bs) { bs = sc; best = m; }
    }
    return { type: 'move', from: best.from, to: best.to };
  },
};


// ================= MARRIAGE (3 decks, 21 cards) =================
// Turn: draw (stock, or the top discard only if it makes a set at once) → optionally "see" by laying down
// 3 pure sequences/tunnelas → discard. After seeing, Maal (Tiplu and relatives) is revealed and works as wild.
// Finish: after seeing, all remaining 12 cards form 4 sets of 3. Scoring: n×own maal − total maal; unseen pay 10, seen pay 3 to the winner.
// Dublee: 7 identical pairs (no wilds) also see the Maal; the 8th pair ends the game (+5 from each player).
const mUp = r => r === 14 ? 2 : r + 1, mDown = r => r === 2 ? 14 : r - 1;
const isRed = s => s === 'H' || s === 'D';
// Wild = any card of the Tiplu's rank, plus Poplu / Jhiplu (same suit, one rank up / down).
const mWildOf = t => c => c.r === t.r || (c.s === t.s && (c.r === mUp(t.r) || c.r === mDown(t.r)));
function mRun(rs) { const a = [...rs].sort((x, y) => x - y); return (a[0] + 1 === a[1] && a[1] + 1 === a[2]) || (a[0] === 2 && a[1] === 3 && a[2] === 14); }
const mNatural = cs => cs.every(c => eq(c, cs[0])) || (cs.every(c => c.s === cs[0].s) && mRun(cs.map(c => c.r)));
function mValid(cs, wild) {
  if (mNatural(cs)) return true;
  if (!wild) return false;
  const nat = cs.filter(c => !wild(c));
  if (nat.length <= 1) return true;
  if (nat.every(c => c.r === nat[0].r) && new Set(nat.map(c => c.s)).size === nat.length) return true; // trial
  if (!nat.every(c => c.s === nat[0].s)) return false;
  return [nat.map(c => c.r), nat.map(c => c.r === 14 ? 1 : c.r)].some(rs => new Set(rs).size === rs.length && Math.max(...rs) - Math.min(...rs) <= 2);
}
function mPartition(cards, wild) {
  if (!cards.length) return [];
  const [a, ...rest] = cards;
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
    const g = [a, rest[i], rest[j]];
    if (!mValid(g, wild)) continue;
    const sub = mPartition(rest.filter((_, k) => k !== i && k !== j), wild);
    if (sub) return [g, ...sub];
  }
  return null;
}
function mTriples(hand, ok) {
  const out = [];
  for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) for (let k = j + 1; k < hand.length; k++)
    if (ok([hand[i], hand[j], hand[k]])) out.push([i, j, k]);
  return out;
}
function mFindSee(hand) { // 3 disjoint pure sequences / tunnelas, as index triples
  const t = mTriples(hand, mNatural), dis = (a, b) => !a.some(x => b.includes(x));
  for (let a = 0; a < t.length; a++) for (let b = a + 1; b < t.length; b++) if (dis(t[a], t[b]))
    for (let c = b + 1; c < t.length; c++) if (dis(t[a], t[c]) && dis(t[b], t[c])) return [t[a], t[b], t[c]];
  return null;
}
function mMaal(cards, t) {
  let p = 0;
  for (const c of cards) {
    if (eq(c, t)) p += 3;
    else if (c.s === t.s && (c.r === mUp(t.r) || c.r === mDown(t.r))) p += 2;
    else if (c.r === t.r && isRed(c.s) === isRed(t.s)) p += 5; // Alter
  }
  return p;
}
function mFindDublee(hand) { // 7 identical pairs, as index pairs
  const used = new Set(), out = [];
  for (let i = 0; i < hand.length && out.length < 7; i++) {
    if (used.has(i)) continue;
    const j = hand.findIndex((c, k) => k > i && !used.has(k) && eq(c, hand[i]));
    if (j > 0) { used.add(i); used.add(j); out.push([i, j]); }
  }
  return out.length === 7 ? out : null;
}
const mHasPair = h => h.some((c, i) => h.some((o, j) => j > i && eq(o, c)));
const mWild = (s, seat) => s.seen[seat] ? mWildOf(s.tiplu) : null;
function mCanTake(s, seat) {
  const top = s.discard[s.discard.length - 1], h = s.hands[seat], w = mWild(s, seat);
  if (!top) return false;
  if (s.dublee[seat]) return h.some(c => eq(c, top)); // only to complete the 8th dublee
  for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) if (mValid([top, h[i], h[j]], w)) return true;
  return false;
}
function mFinishWith(s, seat) {
  if (!s.seen[seat]) return [];
  const h = s.hands[seat], w = mWild(s, seat), out = [];
  for (const c of h) {
    if (out.some(o => eq(o, c))) continue;
    const t = h.slice(); takeCard(t, c);
    if (s.dublee[seat] ? mHasPair(t) : mPartition(t, w)) out.push(c);
  }
  return out;
}
function mDeal(s) {
  s.round++;
  s.dealer = (s.dealer + 1) % s.n;
  const d = shuffle([...deck(), ...deck(), ...deck()]);
  s.hands = Array.from({ length: s.n }, () => sortHand(d.splice(0, 21)));
  s.tiplu = d.pop();
  s.discard = [d.pop()];
  s.stock = d;
  s.seen = Array(s.n).fill(false);
  s.dublee = Array(s.n).fill(false);
  s.melds = Array.from({ length: s.n }, () => []);
  s.turn = (s.dealer + 1) % s.n;
  s.step = 'draw';
  s.phase = 'play';
  s.result = null;
  s.last = null;
}
function mUseful(hand, wild) { // higher = keep
  const inSet = new Set();
  mTriples(hand, g => mValid(g, wild)).forEach(t => t.forEach(i => inSet.add(i)));
  return hand.map((c, i) => {
    if (wild && wild(c)) return 1000;
    let v = inSet.has(i) ? 50 : 0;
    hand.forEach((o, j) => {
      if (i === j) return;
      if (eq(o, c)) v += 2.5;
      else if (o.s === c.s && (Math.abs(o.r - c.r) === 1 || (c.r === 14 && o.r === 2) || (o.r === 14 && c.r === 2))) v += 3;
      else if (o.s === c.s && Math.abs(o.r - c.r) === 2) v += 1.5;
      else if (o.r === c.r) v += wild ? 1 : 0.3;
    });
    return v + Math.random() * 0.1;
  });
}
const marriage = {
  name: 'Marriage', np: 'म्यारिज', min: 2, max: 5,
  init(n) { const s = { n, round: 0, dealer: n - 1, totals: Array(n).fill(0), history: [] }; mDeal(s); return s; },
  act(s, seat, a) {
    if (a.type === 'next') { if (s.phase !== 'end') fail('Round is not over yet'); return mDeal(s); }
    if (s.phase !== 'play') fail('Not now');
    if (s.turn !== seat) fail('Not your turn');
    const h = s.hands[seat];
    if (a.type === 'draw') {
      if (s.step !== 'draw') fail('You already drew a card');
      if (a.from === 'discard') {
        if (!mCanTake(s, seat)) fail('You can pick that card only if it makes a set right away');
        h.push(s.discard.pop());
      } else {
        if (!s.stock.length) { const top = s.discard.pop(); s.stock = shuffle(s.discard); s.discard = [top]; }
        if (!s.stock.length) fail('No cards left to draw');
        h.push(s.stock.pop());
      }
      sortHand(h);
      s.step = 'discard';
      s.last = { seat, t: a.from === 'discard' ? 'pick' : 'draw' };
      return;
    }
    if (s.step !== 'discard') fail('Draw a card first');
    if (a.type === 'see') {
      if (s.seen[seat]) fail('You have already seen the Maal');
      const dub = a.mode === 'dublee', idx = dub ? mFindDublee(h) : mFindSee(h);
      if (!idx) fail(dub ? 'You need 7 dublees (identical pairs) to see the Maal' : 'You need 3 pure sequences or tunnelas to see the Maal');
      s.dublee[seat] = dub;
      s.melds[seat] = idx.map(t => t.map(i => h[i]));
      const drop = new Set(idx.flat());
      s.hands[seat] = h.filter((_, i) => !drop.has(i));
      s.seen[seat] = true;
      s.last = { seat, t: 'see' };
      return;
    }
    if (a.type === 'discard') {
      s.discard.push(takeCard(h, a.card));
      s.turn = (seat + 1) % s.n;
      s.step = 'draw';
      s.last = { seat, t: 'discard' };
      return;
    }
    if (a.type === 'finish') {
      if (!s.seen[seat]) fail('See the Maal before finishing');
      const rest = h.slice(), c = takeCard(rest, a.card);
      let groups;
      if (s.dublee[seat]) { const i = rest.findIndex((x, k) => rest.some((o, j) => j > k && eq(o, x))); groups = i < 0 ? null : [[rest[i], rest[i]]]; }
      else groups = mPartition(rest, mWild(s, seat));
      if (!groups) fail(s.dublee[seat] ? 'You need an 8th dublee to finish' : 'Your cards do not all make sets yet');
      s.hands[seat] = rest;
      s.discard.push(c);
      const maal = s.hands.map((hh, i) => s.seen[i] ? mMaal([...hh, ...s.melds[i].flat()], s.tiplu) : 0);
      const total = maal.reduce((x, y) => x + y, 0);
      const scores = maal.map(m => s.n * m - total);
      const bonus = s.dublee[seat] ? 5 : 0;
      s.seen.forEach((sn, i) => { if (i !== seat) { const pen = (sn ? 3 : 10) + bonus; scores[i] -= pen; scores[seat] += pen; } });
      s.totals = s.totals.map((t, i) => t + scores[i]);
      s.history.push(scores);
      s.result = { winner: seat, maal, scores, groups: [...s.melds[seat], ...groups], tiplu: s.tiplu, dublee: s.dublee[seat] };
      s.phase = 'end';
      return;
    }
    fail('Unknown move');
  },
  view(s, seat) {
    const { hands, stock, tiplu, discard, ...pub } = s, me = seat >= 0, mine = me && s.phase === 'play' && s.turn === seat;
    return {
      ...pub, hand: me ? hands[seat] : [], counts: hands.map(h => h.length), stockCount: stock.length,
      top: discard[discard.length - 1] || null, tiplu: (me && s.seen[seat]) || s.phase === 'end' ? tiplu : null,
      canTake: mine && s.step === 'draw' && mCanTake(s, seat),
      canSee: mine && s.step === 'discard' && !s.seen[seat] && !!mFindSee(hands[seat]),
      canSeeDublee: mine && s.step === 'discard' && !s.seen[seat] && !!mFindDublee(hands[seat]),
      finishWith: mine && s.step === 'discard' ? mFinishWith(s, seat) : [],
    };
  },
  pending: s => s.phase === 'play' ? [s.turn] : [],
  botDelay: () => 1000,
  bot(s, seat) {
    const h = s.hands[seat];
    if (s.step === 'draw') { // pick the discard only if it would not be the first card thrown back
      let take = false;
      if (s.dublee[seat]) take = mCanTake(s, seat);
      else if (mCanTake(s, seat)) { const t = [...h, s.discard[s.discard.length - 1]], u = mUseful(t, mWild(s, seat)); take = u[t.length - 1] > Math.min(...u) + 1; }
      return { type: 'draw', from: take ? 'discard' : 'stock' };
    }
    if (!s.seen[seat] && mFindSee(h)) return { type: 'see' };
    if (!s.seen[seat] && mFindDublee(h)) return { type: 'see', mode: 'dublee' };
    const fin = mFinishWith(s, seat);
    if (fin.length) return { type: 'finish', card: fin[0] };
    const u = s.dublee[seat] ? h.map(c => h.filter(o => eq(o, c)).length + Math.random() * 0.1) : mUseful(h, mWild(s, seat));
    return { type: 'discard', card: h[u.indexOf(Math.min(...u))] };
  },
};

// ================= LUDO =================
// Relative position per token: -1 base, 0..50 main track, 51..55 home column, 56 home.
const LUDO_START = [0, 13, 26, 39];
const LUDO_SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
const ludoColors = n => n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3];
const ludoAbs = (color, p) => (p + LUDO_START[color]) % 52;
function ludoLegal(s, seat, d) {
  return s.pos[seat].map((p, t) => (p === -1 ? d === 6 : p + d <= 56) ? t : -1).filter(t => t >= 0);
}
// Returns {np, caps:[[seat,token]]} without mutating.
function ludoSim(s, seat, t, d) {
  const p = s.pos[seat][t], np = p === -1 ? 0 : p + d, caps = [];
  if (np <= 50) {
    const a = ludoAbs(s.colors[seat], np);
    if (!LUDO_SAFE.includes(a))
      s.pos.forEach((ps, o) => { if (o !== seat) ps.forEach((q, k) => { if (q >= 0 && q <= 50 && ludoAbs(s.colors[o], q) === a) caps.push([o, k]); }); });
  }
  return { np, caps };
}
function ludoPass(s) { s.turn = (s.turn + 1) % s.n; s.sixes = 0; s.phase = 'roll'; s.moves = []; }
const ludo = {
  name: 'Ludo', np: 'लुडो', min: 2, max: 4,
  init(n) { return { n, rolls: 0, colors: ludoColors(n), pos: Array.from({ length: n }, () => [-1, -1, -1, -1]), turn: 0, dice: null, phase: 'roll', sixes: 0, moves: [], winner: null, last: null }; },
  act(s, seat, a) {
    if (a.type === 'next') { if (s.phase !== 'over') fail('Game is not over'); return Object.assign(s, ludo.init(s.n)); }
    if (s.phase === 'over') fail('Game over');
    if (s.turn !== seat) fail('Not your turn');
    if (a.type === 'roll') {
      if (s.phase !== 'roll') fail('Move a token first');
      const d = 1 + Math.floor(Math.random() * 6);
      s.dice = d;
      s.rolls++;
      s.last = null;
      if (d === 6 && ++s.sixes === 3) { s.msg = 'Three sixes – turn lost'; return ludoPass(s); }
      s.msg = null;
      s.moves = ludoLegal(s, seat, d);
      if (s.moves.length) { s.phase = 'move'; return; }
      if (d === 6) return; // no move but a six: roll again
      return ludoPass(s);
    }
    if (a.type === 'move') {
      if (s.phase !== 'move') fail('Roll the dice first');
      const t = Number(a.t);
      if (!s.moves.includes(t)) fail('That token cannot move');
      const { np, caps } = ludoSim(s, seat, t, s.dice);
      s.pos[seat][t] = np;
      caps.forEach(([o, k]) => { s.pos[o][k] = -1; });
      s.last = { seat, t, caps: caps.length };
      s.moves = [];
      if (s.pos[seat].every(p => p === 56)) { s.winner = seat; s.phase = 'over'; return; }
      if (s.dice === 6 || caps.length || np === 56) { s.phase = 'roll'; return; } // bonus turn
      return ludoPass(s);
    }
    fail('Unknown move');
  },
  view: s => s,
  pending: s => s.phase === 'over' ? [] : [s.turn],
  botDelay: () => 1100, // room for dice + token step animations
  bot(s, seat) {
    if (s.phase === 'roll') return { type: 'roll' };
    let best = s.moves[0], bs = -Infinity;
    for (const t of s.moves) {
      const p = s.pos[seat][t], { np, caps } = ludoSim(s, seat, t, s.dice);
      const safe = np > 50 || LUDO_SAFE.includes(ludoAbs(s.colors[seat], np));
      const sc = caps.length * 100 + (np === 56 ? 80 : 0) + (p === -1 ? 60 : 0) + (safe ? 20 : 0) + np / 10 + Math.random();
      if (sc > bs) { bs = sc; best = t; }
    }
    return { type: 'move', t: best };
  },
};

const API = { callbreak, teenpatti, kitti, marriage, baagchal, ludo, _util: { rank3, cmp, handName, cbLegal, cbWinner, bcMoves, autoArrange, ludoSim, deck, mValid, mNatural, mPartition, mFindSee, mFindDublee, mMaal, mWildOf } };
if (typeof module !== 'undefined') module.exports = API; else window.Games = API; // shared with the browser
})();
