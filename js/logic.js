// Pure game rules: no DOM and no storage. Everything here can be tested from tests.html.

export const COLUMNS = 5;
export const MIN_ROWS = 5;
export const MAX_ROWS = 8;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const LINE_LENGTH = 5;
export const LINE_BONUS = 3;
export const MAX_PROMPT_LENGTH = 60;

// Player colors. Each has a pre-chosen text color (fg) that stays readable on it.
export const PALETTE = [
  { bg: '#e6194b', fg: '#ffffff' }, // red
  { bg: '#4363d8', fg: '#ffffff' }, // blue
  { bg: '#ffe119', fg: '#000000' }, // yellow
  { bg: '#3cb44b', fg: '#000000' }, // green
  { bg: '#f032e6', fg: '#000000' }, // magenta
  { bg: '#42d4f4', fg: '#000000' }, // cyan
  { bg: '#f58231', fg: '#000000' }, // orange
  { bg: '#f5f5f5', fg: '#000000' }, // white
  { bg: '#911eb4', fg: '#ffffff' }, // purple
  { bg: '#9a6324', fg: '#ffffff' }, // brown
];

// ---------- Text ----------

/** Trim and collapse repeated whitespace. This is the text we store. */
export function cleanText(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ');
}

/** Comparison key for duplicate checks: ignores case and extra whitespace. */
export function normalizeText(text) {
  return cleanText(text).toLowerCase();
}

export function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- Board size and generation ----------

export function recommendedRows(playerCount) {
  if (playerCount <= 3) return 5;
  if (playerCount <= 5) return 6;
  if (playerCount <= 7) return 7;
  return 8;
}

/** Center cell index: middle column, middle row (upper-middle on even row counts). */
export function centerIndex(rows) {
  return Math.floor((rows - 1) / 2) * COLUMNS + Math.floor(COLUMNS / 2);
}

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Build a fresh board: random unique prompts from both lists, with the center text
 * pinned to the center cell. If there aren't enough prompts, the rest are left blank.
 */
export function generateBoard(rows, builtIns, customs, centerText) {
  const center = cleanText(centerText);
  const seen = new Set([normalizeText(center)]);
  const pool = [];
  for (const text of [...builtIns, ...customs]) {
    const clean = cleanText(text);
    const key = normalizeText(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    pool.push(clean);
  }
  const picks = shuffle(pool).slice(0, rows * COLUMNS - 1);
  const middle = centerIndex(rows);
  const cells = [];
  for (let i = 0; i < rows * COLUMNS; i++) {
    const isCenter = i === middle;
    cells.push({
      id: `c_${i}`,
      text: isCenter ? center : picks.shift() ?? '',
      ownerId: null,
      isCenter,
      edited: false,
    });
  }
  return cells;
}

/** Prompts from the libraries that aren't on the board yet (de-duplicated). */
export function unusedPrompts(cells, builtIns, customs) {
  const seen = new Set(cells.map((c) => normalizeText(c.text)));
  const result = [];
  for (const text of [...builtIns, ...customs]) {
    const clean = cleanText(text);
    const key = normalizeText(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

/** Problem message if `text` can't be used for a cell, otherwise null. */
export function cellTextProblem(cells, text, exceptCellId = null) {
  const key = normalizeText(text);
  if (!key) return 'A square needs some text.';
  if (cells.some((c) => c.id !== exceptCellId && normalizeText(c.text) === key)) {
    return 'That prompt is already on the board.';
  }
  return null;
}

/** Problem message if `text` can't be saved as a custom prompt, otherwise null. */
export function customPromptProblem(customs, text, exceptId = null) {
  const key = normalizeText(text);
  if (!key) return 'A prompt needs some text.';
  if (customs.some((p) => p.id !== exceptId && normalizeText(p.text) === key)) {
    return 'That prompt is already in your custom prompts.';
  }
  return null;
}

// ---------- Lines and scoring ----------

/** Every run of 5 contiguous cells (horizontal, vertical, both diagonals) as index arrays. */
export function getLines(rows) {
  const at = (r, c) => r * COLUMNS + c;
  const run = (r, c, dr, dc) => Array.from({ length: LINE_LENGTH }, (_, k) => at(r + k * dr, c + k * dc));
  const lines = [];
  const lastRowStart = rows - LINE_LENGTH;
  const lastColStart = COLUMNS - LINE_LENGTH;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= lastColStart; c++) lines.push(run(r, c, 0, 1)); // horizontal
  }
  for (let c = 0; c < COLUMNS; c++) {
    for (let r = 0; r <= lastRowStart; r++) lines.push(run(r, c, 1, 0)); // vertical
  }
  for (let r = 0; r <= lastRowStart; r++) {
    for (let c = 0; c <= lastColStart; c++) lines.push(run(r, c, 1, 1)); // diagonal down-right
    for (let c = LINE_LENGTH - 1; c < COLUMNS; c++) lines.push(run(r, c, 1, -1)); // diagonal down-left
  }
  return lines;
}

/** Lines fully owned by a single player: [{ ownerId, cells: [indices] }]. */
export function completedLines(board) {
  const owners = board.cells.map((c) => c.ownerId);
  return getLines(board.rows)
    .filter((line) => owners[line[0]] !== null && line.every((i) => owners[i] === owners[line[0]]))
    .map((line) => ({ ownerId: owners[line[0]], cells: line }));
}

/** Scores are always derived from current ownership; they are never stored. */
export function computeScores(players, board) {
  const scores = {};
  for (const p of players) scores[p.id] = { squares: 0, lines: 0, total: 0 };
  for (const cell of board.cells) {
    if (scores[cell.ownerId]) scores[cell.ownerId].squares++;
  }
  for (const line of completedLines(board)) {
    if (scores[line.ownerId]) scores[line.ownerId].lines++;
  }
  for (const s of Object.values(scores)) s.total = s.squares + LINE_BONUS * s.lines;
  return scores;
}

/** Players sorted by total score. Ties share a rank. */
export function rankPlayers(players, scores) {
  return [...players]
    .sort((a, b) => scores[b.id].total - scores[a.id].total)
    .map((p) => ({
      player: p,
      score: scores[p.id],
      rank: 1 + players.filter((o) => scores[o.id].total > scores[p.id].total).length,
    }));
}

// ---------- Players ----------

/** Short label like "AL" or "JS" that isn't already in `taken`. */
export function makeInitials(name, taken = []) {
  const words = cleanText(name).split(' ').filter(Boolean).map((w) => Array.from(w));
  if (!words.length) return '?';
  const [first, second] = words;
  const candidates = second
    ? [first[0] + second[0], first[0] + second.slice(0, 2).join(''), first.slice(0, 2).join('') + second[0]]
    : [first.slice(0, 2).join(''), first.slice(0, 3).join('')];
  const used = new Set(taken.map((t) => t.toUpperCase()));
  for (const candidate of candidates) {
    const upper = candidate.toUpperCase();
    if (!used.has(upper)) return upper;
  }
  const base = candidates[0].toUpperCase();
  for (let n = 2; ; n++) if (!used.has(base + n)) return base + n;
}

/** Recompute everyone's initials in entry order (used during setup while names are typed). */
export function assignInitials(players) {
  const taken = [];
  for (const p of players) {
    p.initials = makeInitials(p.name, taken);
    taken.push(p.initials);
  }
}

export function nextColorIndex(players) {
  const used = new Set(players.map((p) => p.colorIndex));
  const free = PALETTE.findIndex((_, i) => !used.has(i));
  return free === -1 ? 0 : free;
}

/** Problem message if `name` can't be used, otherwise null. */
export function playerNameProblem(players, name, exceptId = null) {
  const clean = cleanText(name);
  if (!clean) return 'Every player needs a name.';
  if (players.some((p) => p.id !== exceptId && normalizeText(p.name) === normalizeText(clean))) {
    return `There's already a player called "${clean}".`;
  }
  return null;
}

// ---------- Game state changes ----------

export function createGame(now = Date.now()) {
  const game = {
    version: 1,
    status: 'setup',
    setupStep: 'players',
    players: [],
    board: { columns: COLUMNS, rows: MIN_ROWS, rowsOverridden: false, cells: [] },
    history: [],
    nextSeq: 1,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
  addPlayer(game, '');
  addPlayer(game, '');
  syncRecommendedRows(game);
  return game;
}

/** During setup only: follow the recommended row count unless the GM picked one. */
export function syncRecommendedRows(game) {
  if (game.status === 'setup' && !game.board.rowsOverridden) {
    game.board.rows = recommendedRows(game.players.length);
  }
}

/** Adds a player with the first unused color. Never touches the board. */
export function addPlayer(game, name) {
  if (game.players.length >= MAX_PLAYERS) return null;
  const player = {
    id: makeId('p'),
    name: cleanText(name),
    initials: makeInitials(name, game.players.map((p) => p.initials)),
    colorIndex: nextColorIndex(game.players),
  };
  game.players.push(player);
  return player;
}

/** Returns a problem message, or null after renaming. */
export function renamePlayer(game, playerId, name) {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return 'Player not found.';
  const problem = playerNameProblem(game.players, name, playerId);
  if (problem) return problem;
  player.name = cleanText(name);
  player.initials = makeInitials(player.name, game.players.filter((p) => p !== player).map((p) => p.initials));
  return null;
}

/**
 * Removes a player and clears any squares they own. Their id is also wiped from undo
 * snapshots so undo can never give a square back to a removed player.
 * Board size, cell ids and other players' squares are untouched.
 */
export function removePlayer(game, playerId) {
  if (game.players.length <= MIN_PLAYERS) return false;
  const index = game.players.findIndex((p) => p.id === playerId);
  if (index === -1) return false;
  game.players.splice(index, 1);
  for (const cell of game.board.cells) {
    if (cell.ownerId === playerId) cell.ownerId = null;
  }
  for (const entry of game.history) {
    entry.prevOwners = entry.prevOwners.map((o) => (o === playerId ? null : o));
  }
  return true;
}

export function ownedCount(game, playerId) {
  return game.board.cells.filter((c) => c.ownerId === playerId).length;
}

/** Claim, unclaim or reassign a square. Records an undo snapshot. */
export function changeOwner(game, cellId, newOwnerId, now = Date.now()) {
  const cell = game.board.cells.find((c) => c.id === cellId);
  if (!cell || cell.ownerId === newOwnerId) return false;
  const newOwner = game.players.find((p) => p.id === newOwnerId) ?? null;
  if (newOwnerId !== null && !newOwner) return false;
  const oldOwner = game.players.find((p) => p.id === cell.ownerId) ?? null;
  game.history.push({
    seq: game.nextSeq++,
    at: now,
    type: newOwnerId === null ? 'unclaim' : oldOwner ? 'reassign' : 'claim',
    cellId,
    text: cell.text,
    playerId: newOwnerId,
    playerName: newOwner?.name ?? null,
    fromName: oldOwner?.name ?? null,
    prevOwners: game.board.cells.map((c) => c.ownerId),
  });
  cell.ownerId = newOwnerId;
  return true;
}

/** Normal-play claim: only works on an unclaimed square (guards against double taps). */
export function claimCell(game, cellId, playerId) {
  const cell = game.board.cells.find((c) => c.id === cellId);
  if (!cell || cell.ownerId !== null) return false;
  return changeOwner(game, cellId, playerId);
}

/** Restores ownership to exactly what it was before the latest claim change. */
export function undoLast(game) {
  const entry = game.history.pop();
  if (!entry) return null;
  game.board.cells.forEach((cell, i) => {
    cell.ownerId = entry.prevOwners[i] ?? null;
  });
  return entry;
}
