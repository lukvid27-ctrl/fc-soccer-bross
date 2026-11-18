// players.js - player database for FC Soccer Bros
// Stats scale 1-99: pace=sprint speed, shot=ball exit velocity, pass=pass lock-on & trivela curve,
// def=slide reach & recovery, jump=vertical leap.

const SKINS = ['#f5d0b0', '#e8b890', '#c68c5f', '#a0673c', '#6b4226', '#4a2c17'];
const HAIR_STYLES = ['short', 'buzz', 'curly', 'long', 'afro', 'slick', 'bald', 'mohawk'];
const HAIR_COLORS = ['#1a1209', '#3b2a1a', '#6b4a2b', '#c9a24a', '#e6d08a', '#8a8a8a', '#b5532a'];

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_'); }

// Positional stat templates (offset from OVR)
const POS_TEMPLATE = {
  ST:  { pace: 0,  shot: 2,   pass: -8,  def: -38, jump: -2 },
  CF:  { pace: 0,  shot: 2,   pass: -4,  def: -36, jump: -2 },
  LW:  { pace: 3,  shot: -1,  pass: -3,  def: -38, jump: -8 },
  RW:  { pace: 3,  shot: -1,  pass: -3,  def: -38, jump: -8 },
  CAM: { pace: -3, shot: 0,   pass: 4,   def: -28, jump: -10 },
  CM:  { pace: -5, shot: -3,  pass: 4,   def: -10, jump: -8 },
  LB:  { pace: 2,  shot: -14, pass: -3,  def: -2,  jump: -6 },
  RB:  { pace: 2,  shot: -14, pass: -3,  def: -2,  jump: -6 },
  CB:  { pace: -8, shot: -22, pass: -8,  def: 4,   jump: 4 },
  GK:  { pace: -12, shot: -28, pass: -10, def: 4,  jump: 4 },
};

function deriveStats(ovr, pos, name) {
  const t = POS_TEMPLATE[pos] || POS_TEMPLATE.CM;
  const h = hashStr(name);
  const jit = k => ((h >>> (k * 4)) & 7) - 3; // -3..+4
  const s = {};
  ['pace', 'shot', 'pass', 'def', 'jump'].forEach((k, i) => { s[k] = clamp(Math.round(ovr + t[k] + jit(i)), 25, 99); });
  return s;
}

function cosmetics(name) {
  const h = hashStr(name);
  return {
    skinTone: SKINS[h % SKINS.length],
    hairStyle: HAIR_STYLES[(h >>> 3) % HAIR_STYLES.length],
    hairColor: HAIR_COLORS[(h >>> 6) % HAIR_COLORS.length],
  };
}

const FILL_FN = ['Marco', 'Leo', 'Tom', 'Ivan', 'Ruben', 'Kai', 'Diego', 'Sami', 'Theo', 'Nico', 'Jamal', 'Yuki', 'Omar', 'Luca', 'Felix', 'Andre', 'Enzo', 'Milan', 'Jonas', 'Tariq', 'Mateo', 'Hugo', 'Pablo', 'Emil'];
const FILL_LN = ['Silva', 'Novak', 'Rossi', 'Berg', 'Okoye', 'Tanaka', 'Duarte', 'Costa', 'Weber', 'Mendes', 'Haas', 'Petrov', 'Alves', 'Moreau', 'Ito', 'Lang', 'Vega', 'Kovac', 'Reyes', 'Dunn', 'Ferro', 'Lund', 'Diaz', 'Hale'];
function fillerName(seed) { const h = hashStr(String(seed)); return FILL_FN[h % FILL_FN.length] + ' ' + FILL_LN[(h >>> 5) % FILL_LN.length]; }
function nationId(name) { return (typeof NATION_BY_NAME !== 'undefined' && NATION_BY_NAME[name]) || 'OTH'; }
function tierFor(ovr) { return ovr >= 86 ? 'Gold' : ovr >= 75 ? 'Silver' : 'Bronze'; }

const PLAYERS = {};
function addPlayer(p) {
  if (!p.id) p.id = slug(p.name) + (PLAYERS[slug(p.name)] ? '_' + p.ovr : '');
  if (!p.stats) p.stats = deriveStats(p.ovr, p.pos, p.name);
  Object.assign(p, Object.assign(cosmetics(p.name), p.cosmetics || {}));
  PLAYERS[p.id] = p;
  return p;
}

// ---------- ICONS (explicit stats) ----------
// [name, ovr, nation, pos, pace, shot, pass, def, jump]
const ICON_ROWS = [
  ['Pelé', 97, 'Brazil', 'CF', 96, 97, 94, 62, 95],
  ['Diego Maradona', 97, 'Argentina', 'CAM', 94, 95, 96, 55, 82],
  ['Ronaldo Nazário', 96, 'Brazil', 'ST', 97, 96, 84, 48, 88],
  ['Zinedine Zidane', 96, 'France', 'CAM', 85, 92, 97, 76, 86],
  ['Johan Cruyff', 95, 'Netherlands', 'CF', 93, 93, 95, 58, 84],
  ['Ronaldinho', 95, 'Brazil', 'LW', 94, 92, 95, 52, 85],
  ['Paolo Maldini', 95, 'Italy', 'CB', 88, 68, 84, 98, 94],
  ['Franz Beckenbauer', 95, 'Germany', 'CB', 86, 82, 92, 96, 91],
  ['Thierry Henry', 94, 'France', 'ST', 96, 94, 86, 54, 85],
  ['Lev Yashin', 94, 'Soviet Union', 'GK', 80, 60, 82, 97, 96],
  ['Xavi Hernández', 93, 'Spain', 'CM', 80, 82, 98, 76, 72],
  ['Andrés Iniesta', 93, 'Spain', 'CM', 83, 84, 97, 72, 74],
  ['Roberto Carlos', 92, 'Brazil', 'LB', 96, 94, 86, 88, 84],
  ['Cafu', 92, 'Brazil', 'RB', 94, 76, 88, 90, 86],
  ['Kaká', 92, 'Brazil', 'CAM', 94, 90, 91, 58, 83],
  ['Wayne Rooney', 91, 'England', 'ST', 88, 93, 87, 72, 89],
  ['David Beckham', 91, 'England', 'RW', 81, 91, 97, 74, 78],
  ['Didier Drogba', 91, 'Ivory Coast', 'ST', 87, 93, 78, 62, 95],
  ['Gareth Bale', 91, 'Wales', 'RW', 97, 92, 85, 68, 91],
  ['Andrea Pirlo', 91, 'Italy', 'CM', 74, 86, 98, 75, 70],
  ['Sergio Ramos', 91, 'Spain', 'CB', 84, 78, 82, 93, 96],
  ['Toni Kroos', 91, 'Germany', 'CM', 72, 86, 97, 78, 74],
  ['Zlatan Ibrahimović', 91, 'Sweden', 'ST', 83, 95, 84, 54, 94],
  ['Davor Šuker', 89, 'Croatia', 'ST', 87, 92, 82, 48, 85],
];
ICON_ROWS.forEach(r => addPlayer({
  name: r[0], ovr: r[1], nation: nationId(r[2]), nationName: r[2], club: 'ICN', pos: r[3], tier: 'Icon',
  stats: { pace: r[4], shot: r[5], pass: r[6], def: r[7], jump: r[8] },
}));

// ---------- THE CROATIAN MAESTROS ----------
addPlayer({
  id: 'modric_prime', name: 'Luka Modrić (Prime)', ovr: 96, nation: 'CRO', nationName: 'Croatia', club: 'RMA', pos: 'CM', tier: 'Prime Icon',
  stats: { pace: 87, shot: 89, pass: 99, def: 85, jump: 80 }, trivela: true, hyperLink: true,
  cosmetics: { skinTone: SKINS[0], hairStyle: 'long', hairColor: HAIR_COLORS[3] },
});
addPlayer({
  id: 'modric_active', name: 'Luka Modrić', ovr: 90, nation: 'CRO', nationName: 'Croatia', club: 'MIL', pos: 'CM', tier: 'Gold',
  stats: { pace: 78, shot: 84, pass: 96, def: 80, jump: 75 }, trivela: true, hyperLink: true,
  cosmetics: { skinTone: SKINS[0], hairStyle: 'long', hairColor: HAIR_COLORS[3] },
});
addPlayer({
  id: 'rakitic_icon', name: 'Ivan Rakitić', ovr: 88, nation: 'CRO', nationName: 'Croatia', club: 'BAR', pos: 'CM', tier: 'Icon',
  stats: { pace: 78, shot: 87, pass: 91, def: 77, jump: 76 }, hyperLink: true,
  cosmetics: { skinTone: SKINS[0], hairStyle: 'short', hairColor: HAIR_COLORS[2] },
});

// ---------- ACTIVE STARS ----------
// [name, ovr, nation, pos, club]
const STAR_ROWS = [
  // Premier League
  ['Erling Haaland', 91, 'Norway', 'ST', 'MCI'], ['Rodri', 91, 'Spain', 'CM', 'MCI'], ['Mohamed Salah', 90, 'Egypt', 'RW', 'LIV'],
  ['Bukayo Saka', 89, 'England', 'RW', 'ARS'], ['Virgil van Dijk', 89, 'Netherlands', 'CB', 'LIV'], ['Kevin De Bruyne', 89, 'Belgium', 'CAM', 'MCI'],
  ['Cole Palmer', 88, 'England', 'CAM', 'CHE'], ['Martin Ødegaard', 88, 'Norway', 'CAM', 'ARS'], ['William Saliba', 88, 'France', 'CB', 'ARS'],
  ['Declan Rice', 88, 'England', 'CM', 'ARS'], ['Phil Foden', 88, 'England', 'CAM', 'MCI'], ['Alisson', 89, 'Brazil', 'GK', 'LIV'],
  ['Bruno Fernandes', 87, 'Portugal', 'CAM', 'MUN'], ['Alexander Isak', 87, 'Sweden', 'ST', 'NEW'], ['Son Heung-min', 87, 'South Korea', 'LW', 'TOT'],
  ['Gabriel Magalhães', 87, 'Brazil', 'CB', 'ARS'], ['Trent Alexander-Arnold', 87, 'England', 'RB', 'LIV'], ['Alexis Mac Allister', 86, 'Argentina', 'CM', 'LIV'],
  ['Joško Gvardiol', 86, 'Croatia', 'CB', 'MCI'], ['Kai Havertz', 85, 'Germany', 'ST', 'ARS'], ['Ollie Watkins', 85, 'England', 'ST', 'AVL'],
  ['Cristian Romero', 85, 'Argentina', 'CB', 'TOT'], ['Mateo Kovačić', 84, 'Croatia', 'CM', 'MCI'],
  // La Liga
  ['Kylian Mbappé', 92, 'France', 'ST', 'RMA'], ['Vinícius Júnior', 91, 'Brazil', 'LW', 'RMA'], ['Jude Bellingham', 91, 'England', 'CAM', 'RMA'],
  ['Lamine Yamal', 90, 'Spain', 'RW', 'BAR'], ['Raphinha', 89, 'Brazil', 'RW', 'BAR'], ['Pedri', 89, 'Spain', 'CM', 'BAR'],
  ['Federico Valverde', 89, 'Uruguay', 'CM', 'RMA'], ['Thibaut Courtois', 89, 'Belgium', 'GK', 'RMA'], ['Robert Lewandowski', 88, 'Poland', 'ST', 'BAR'],
  ['Antoine Griezmann', 88, 'France', 'ST', 'ATM'], ['Julián Álvarez', 88, 'Argentina', 'ST', 'ATM'], ['Antonio Rüdiger', 88, 'Germany', 'CB', 'RMA'],
  ['Nico Williams', 87, 'Spain', 'LW', 'ATH'], ['Dani Carvajal', 86, 'Spain', 'RB', 'RMA'], ['Dani Olmo', 86, 'Spain', 'CAM', 'BAR'],
  ['Jules Koundé', 86, 'France', 'RB', 'BAR'], ['Aurélien Tchouaméni', 86, 'France', 'CM', 'RMA'], ['Gavi', 85, 'Spain', 'CM', 'BAR'],
  ['Eduardo Camavinga', 85, 'France', 'CM', 'RMA'], ['Pau Cubarsí', 84, 'Spain', 'CB', 'BAR'], ['Arda Güler', 83, 'Türkiye', 'RW', 'RMA'],
  // Bundesliga
  ['Harry Kane', 91, 'England', 'ST', 'BAY'], ['Jamal Musiala', 89, 'Germany', 'CAM', 'BAY'], ['Florian Wirtz', 89, 'Germany', 'CAM', 'LEV'],
  ['Joshua Kimmich', 88, 'Germany', 'CM', 'BAY'], ['Michael Olise', 86, 'France', 'RW', 'BAY'], ['Alphonso Davies', 85, 'Canada', 'LB', 'BAY'],
  ['Kim Min-jae', 85, 'South Korea', 'CB', 'BAY'], ['Serhou Guirassy', 85, 'Guinea', 'ST', 'BVB'], ['Xavi Simons', 85, 'Netherlands', 'CAM', 'RBL'],
  ['Karim Adeyemi', 82, 'Germany', 'LW', 'BVB'],
  // Serie A
  ['Lautaro Martínez', 89, 'Argentina', 'ST', 'INT'], ['Nicolò Barella', 88, 'Italy', 'CM', 'INT'], ['Alessandro Bastoni', 87, 'Italy', 'CB', 'INT'],
  ['Rafael Leão', 87, 'Portugal', 'LW', 'MIL'], ['Mike Maignan', 87, 'France', 'GK', 'MIL'], ['Khvicha Kvaratskhelia', 87, 'Georgia', 'LW', 'NAP'],
  ['Christian Pulisic', 86, 'USA', 'RW', 'MIL'], ['Theo Hernández', 86, 'France', 'LB', 'MIL'], ['Hakan Çalhanoğlu', 86, 'Türkiye', 'CM', 'INT'],
  ['Federico Dimarco', 85, 'Italy', 'LB', 'INT'], ['Ademola Lookman', 85, 'Nigeria', 'LW', 'ATA'], ['Kenan Yıldız', 82, 'Türkiye', 'RW', 'JUV'],
  // Ligue 1 & Rest of World
  ['Ousmane Dembélé', 88, 'France', 'ST', 'PSG'], ['Gianluigi Donnarumma', 88, 'Italy', 'GK', 'PSG'], ['Lionel Messi', 98, 'Argentina', 'RW', 'MIA'],
  ['Achraf Hakimi', 87, 'Morocco', 'RB', 'PSG'], ['Vitinha', 87, 'Portugal', 'CM', 'PSG'], ['Viktor Gyökeres', 87, 'Sweden', 'ST', 'SCP'],
  ['Cristiano Ronaldo', 99, 'Portugal', 'ST', 'NAS'], ['Neymar Jr', 86, 'Brazil', 'LW', 'FLA'], ['João Neves', 85, 'Portugal', 'CM', 'PSG'],
  ['Bradley Barcola', 85, 'France', 'LW', 'PSG'], ['Sadio Mané', 84, 'Senegal', 'LW', 'NAS'], ['Ruben Neves', 84, 'Portugal', 'CM', 'HIL'],
  ['Luis Suárez', 82, 'Uruguay', 'ST', 'MIA'],
  // Croatia & USA depth
  ['Andrej Kramarić', 82, 'Croatia', 'ST', 'OTH'], ['Dominik Livaković', 82, 'Croatia', 'GK', 'OTH'], ['Martin Sučić', 80, 'Croatia', 'CM', 'OTH'],
  ['Antonee Robinson', 83, 'USA', 'LB', 'OTH'], ['Weston McKennie', 82, 'USA', 'CM', 'JUV'], ['Folarin Balogun', 81, 'USA', 'ST', 'MON'],
  ['Tyler Adams', 81, 'USA', 'CM', 'OTH'], ['Tim Weah', 80, 'USA', 'RW', 'JUV'],
];
STAR_ROWS.forEach(r => addPlayer({
  name: r[0], ovr: r[1], nation: nationId(r[2]), nationName: r[2], club: r[4], pos: r[3], tier: tierFor(r[1]),
}));

// Croatia's Active Modrić is the Gold card on AC Milan; mark Croatia cards
// ---------- SQUAD HELPERS ----------
// Generated depth players so every one of the 48 nations has a full squad.
const FILLER_POS = ['ST', 'CAM', 'CM', 'LW', 'CB', 'GK', 'RB', 'LB'];
const NATION_TIER = { ARG: 80, FRA: 82, ESP: 80, ENG: 80, BRA: 80, POR: 78, GER: 78, NED: 77, BEL: 76, ITA: 77, CRO: 76, USA: 74, MEX: 73, CAN: 70, URU: 75, COL: 75, NOR: 74, JPN: 73, KOR: 73, MAR: 74, SEN: 72 };

function nationFiller(n) {
  const base = NATION_TIER[n.id] || 66 + (hashStr(n.id) % 6);
  const out = [];
  FILLER_POS.forEach((pos, i) => {
    const ovr = clamp(base - 2 - i + (hashStr(n.id + pos) % 3), 55, 78);
    out.push(addPlayer({ id: 'gen_' + n.id + '_' + pos + i, name: fillerName(n.id + pos + i), ovr, nation: n.id, nationName: n.name, club: 'OTH', pos, tier: tierFor(ovr), generated: true }));
  });
  return out;
}

function squadFor(teamId, mode) {
  // mode: 'nation' | 'club' | 'icons'
  let list;
  if (teamId === 'ICONS') list = Object.values(PLAYERS).filter(p => p.tier === 'Icon' || p.tier === 'Prime Icon');
  else if (TEAMS[teamId] && TEAMS[teamId].kind === 'nation') {
    list = Object.values(PLAYERS).filter(p => p.nation === teamId && p.tier !== 'Prime Icon' && p.club !== 'ICN');
    if (list.length < 8) list = list.concat(nationFiller(TEAMS[teamId]).filter(f => !list.includes(f)));
  } else list = Object.values(PLAYERS).filter(p => p.club === teamId && p.tier !== 'Prime Icon' && p.club !== 'ICN');
  return list.sort((a, b) => b.ovr - a.ovr);
}

// Classic Icons XI pseudo-team
TEAMS.ICONS = { id: 'ICONS', name: 'Classic Icons XI', c1: '#f4e7b0', c2: '#8a6d1d', style: 'sash', kind: 'icons', flag: '⭐' };
TEAMS.OTH = { id: 'OTH', name: 'Free Agents', c1: '#888', c2: '#fff', style: 'solid', kind: 'club' };
TEAMS.ICN = { id: 'ICN', name: 'Icons', c1: '#f4e7b0', c2: '#8a6d1d', style: 'solid', kind: 'club' };

// Hyper-Link chemistry: Croatia Hyper-Link (+5 stats) between any Modrić and Rakitić
function isModric(p) { return p.id === 'modric_prime' || p.id === 'modric_active'; }
function chemistryBoost(lineup) {
  // lineup: array of player objects. Returns { boost, links[] }
  let boost = 0; const links = [];
  const hasM = lineup.some(isModric), hasR = lineup.some(p => p.id === 'rakitic_icon');
  if (hasM && hasR) { boost = 5; links.push('Croatia Hyper-Link +5'); }
  else {
    const nations = {}, clubs = {};
    lineup.forEach(p => { nations[p.nation] = (nations[p.nation] || 0) + 1; if (p.club !== 'OTH' && p.club !== 'ICN') clubs[p.club] = (clubs[p.club] || 0) + 1; });
    const nPairs = Object.values(nations).filter(v => v >= 2).length, cPairs = Object.values(clubs).filter(v => v >= 2).length;
    const icons = lineup.filter(p => p.tier === 'Icon' || p.tier === 'Prime Icon').length;
    if (nPairs) { boost += 2; links.push('Nation link +2'); }
    if (cPairs) { boost += 2; links.push('Club link +2'); }
    if (icons >= 2) { boost += 1; links.push('Icon link +1'); }
    boost = Math.min(boost, 5);
  }
  return { boost, links };
}

function boosted(p, boost) {
  if (!boost) return p;
  const q = Object.assign({}, p);
  q.stats = {};
  Object.keys(p.stats).forEach(k => q.stats[k] = clamp(p.stats[k] + boost, 1, 99));
  q.ovr = clamp(p.ovr + boost, 1, 99);
  return q;
}

// Hand-tuned stats for the two highest-rated active superstars
PLAYERS.cristiano_ronaldo.stats = { pace: 96, shot: 99, pass: 90, def: 58, jump: 99 };
PLAYERS.lionel_messi.stats = { pace: 93, shot: 96, pass: 99, def: 52, jump: 72 };

// ---------- 11-A-SIDE SQUAD BUILDER ----------
// Formation (4-3-3 with a CAM): slot 0 is the keeper, slots 1-10 are the outfielders.
const SLOT_POS = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CAM', 'LW', 'ST', 'RW'];
const POS_NAME = { GK: 'Keeper', LB: 'Left Back', CB: 'Centre Back', RB: 'Right Back', CM: 'Midfielder', CAM: 'Playmaker', LW: 'Left Winger', ST: 'Striker', RW: 'Right Winger', CF: 'Forward' };
const COMPAT = { ST: ['CF', 'LW', 'RW'], CF: ['ST', 'CAM'], LW: ['RW', 'CAM'], RW: ['LW', 'CAM'], CAM: ['CM', 'LW', 'RW', 'CF'], CM: ['CAM', 'CB'], LB: ['RB', 'CB'], RB: ['LB', 'CB'], CB: ['LB', 'RB', 'CM'], GK: [] };
function slotOk(slot, pos) { return slot === pos || (slot === 'ST' && pos === 'CF'); }

function genFiller(teamId, pos, k, base) {
  const T = TEAMS[teamId] || { name: 'Squad', kind: 'club' };
  const id = 'gf_' + teamId + '_' + pos + '_' + k;
  if (PLAYERS[id]) return PLAYERS[id];
  const ovr = clamp(base, 55, 86);
  return addPlayer({ id, name: fillerName(teamId + pos + k), ovr, nation: T.kind === 'nation' ? teamId : 'OTH', nationName: T.name, club: T.kind === 'nation' ? 'OTH' : teamId, pos, tier: tierFor(ovr), generated: true });
}

// picks: player objects chosen by humans (they keep their own position slot).
// exclude: ids that may not be used to fill the rest (e.g. already picked by the other side).
// Returns { team, slots[11], pickIdx: {playerId: slotIndex} }.
function buildSide(teamId, picks, exclude) {
  picks = picks || [];
  const slots = new Array(11).fill(null), used = new Set(exclude || []), pickIdx = {};
  picks.forEach(pd => used.add(pd.id));
  picks.forEach(pd => {
    let i = SLOT_POS.findIndex((s, idx) => !slots[idx] && slotOk(s, pd.pos));
    if (i < 0) { const c = COMPAT[pd.pos] || []; i = SLOT_POS.findIndex((s, idx) => !slots[idx] && idx > 0 && c.includes(s)); }
    if (i < 0) i = slots.findIndex((s, idx) => !slots[idx] && idx > 0);
    if (i >= 0) { slots[i] = pd; pickIdx[pd.id] = i; }
  });
  const pool = squadFor(teamId).filter(p => !used.has(p.id));
  const take = (idx, test) => { const j = pool.findIndex(p => !used.has(p.id) && test(p)); if (j >= 0) { slots[idx] = pool[j]; used.add(pool[j].id); return true; } return false; };
  SLOT_POS.forEach((s, idx) => { if (!slots[idx]) take(idx, p => slotOk(s, p.pos)); });
  SLOT_POS.forEach((s, idx) => { if (!slots[idx] && idx > 0) take(idx, p => (COMPAT[s] || []).includes(p.pos) && p.pos !== 'GK' && p.ovr >= 80); });
  const top = pool.slice(0, 6), T0 = TEAMS[teamId] || {};
  const avg = T0.str ? T0.str + 6 : (top.length ? top.reduce((a, p) => a + p.ovr, 0) / top.length : 74);
  SLOT_POS.forEach((s, idx) => { if (!slots[idx]) slots[idx] = genFiller(teamId, s, idx, Math.round(avg - 6 + (hashStr(teamId + idx) % 5))); });
  return { team: teamId, slots, pickIdx };
}
function sideStrength(side) { return Math.round(side.slots.reduce((a, p) => a + p.ovr, 0) / side.slots.length); }

// ---------- PLAYER LOOKS (so cards and on-pitch characters resemble the real players) ----------
// id: [skin 0-5 (light→dark), hair style, hair colour index, beard?]
// hair colour: 0 black, 1 dark brown, 2 brown, 3 dirty blond, 4 blond, 5 grey, 6 ginger
const LOOKS = {
  modric_prime: [0, 'long', 3, false], modric_active: [0, 'long', 3, false], rakitic_icon: [0, 'short', 2, true],
  cristiano_ronaldo: [1, 'slick', 0, false], lionel_messi: [1, 'short', 1, true], erling_haaland: [0, 'long', 4, false],
  kylian_mbappe: [4, 'buzz', 0, false], neymar_jr: [2, 'mohawk', 4, false], vinicius_junior: [4, 'curly', 0, false],
  mohamed_salah: [2, 'curly', 0, true], harry_kane: [0, 'short', 2, false], jude_bellingham: [3, 'short', 0, false],
  lamine_yamal: [2, 'curly', 0, false], kevin_de_bruyne: [0, 'short', 6, true], virgil_van_dijk: [4, 'short', 0, true],
  phil_foden: [0, 'short', 4, false], bukayo_saka: [5, 'short', 0, false], rodri: [1, 'short', 1, false],
  pele: [5, 'buzz', 0, false], diego_maradona: [1, 'curly', 0, false], ronaldo_nazario: [2, 'buzz', 0, false],
  zinedine_zidane: [1, 'bald', 0, false], ronaldinho: [4, 'curly', 0, false], johan_cruyff: [0, 'long', 2, false],
  paolo_maldini: [0, 'slick', 0, false], franz_beckenbauer: [0, 'slick', 1, false], thierry_henry: [5, 'buzz', 0, false],
  lev_yashin: [0, 'slick', 0, false], xavi_hernandez: [0, 'short', 1, false], andres_iniesta: [0, 'bald', 2, false],
  roberto_carlos: [3, 'bald', 0, false], cafu: [5, 'buzz', 0, false], kaka: [2, 'buzz', 0, false],
  wayne_rooney: [0, 'buzz', 6, false], david_beckham: [0, 'slick', 3, false], didier_drogba: [5, 'bald', 0, false],
  gareth_bale: [0, 'slick', 2, false], andrea_pirlo: [0, 'long', 1, true], sergio_ramos: [1, 'slick', 0, true],
  toni_kroos: [0, 'slick', 4, false], zlatan_ibrahimovic: [1, 'slick', 1, true], davor_suker: [0, 'short', 2, false],
  sadio_mane: [5, 'buzz', 0, false], luis_suarez: [1, 'slick', 0, true], robert_lewandowski: [0, 'short', 2, true],
  antoine_griezmann: [0, 'slick', 3, true], achraf_hakimi: [3, 'buzz', 0, true], ousmane_dembele: [4, 'buzz', 0, true],
  joshua_kimmich: [0, 'short', 2, false], thibaut_courtois: [0, 'short', 1, true], alisson: [1, 'short', 1, true],
  son_heung_min: [2, 'short', 0, false], jamal_musiala: [3, 'curly', 0, false], florian_wirtz: [0, 'short', 2, false],
  pedri: [1, 'short', 1, false], gavi: [1, 'short', 1, false], raphinha: [3, 'short', 0, false],
  josko_gvardiol: [0, 'short', 1, false], mateo_kovacic: [0, 'short', 1, false], declan_rice: [0, 'short', 1, false],
  martin_degaard: [0, 'short', 3, false], cole_palmer: [1, 'short', 1, false], federico_valverde: [1, 'short', 1, false],
  christian_pulisic: [0, 'short', 1, false], lautaro_martinez: [1, 'short', 1, false], julian_alvarez: [1, 'short', 1, false],
};
Object.keys(LOOKS).forEach(id => {
  const p = PLAYERS[id], L = LOOKS[id]; if (!p) return;
  p.skinTone = SKINS[L[0]]; p.hairStyle = L[1]; p.hairColor = HAIR_COLORS[L[2]]; p.beard = L[3];
});
