// localStorage persistence. Keys are namespaced because every project on a
// <user>.github.io site shares the same storage.
import { COLUMNS, MIN_ROWS, MAX_ROWS, PALETTE, makeInitials, nextColorIndex } from './logic.js';

const GAME_KEY = 'halloweenBingo.game.v1';
const CORRUPT_KEY = 'halloweenBingo.game.corrupt';
const LIBRARY_KEY = 'halloweenBingo.customPrompts.v1';

const STATUSES = ['setup', 'active', 'completed'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const timeOr = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * Validates a saved game. Safe gaps (missing optional fields, stale owner ids, nextSeq)
 * are repaired. Anything wrong with the board's structure makes the save corrupt:
 * the board is never regenerated, resized or replaced here.
 * Returns { ok: true, state } or { ok: false, reason }.
 */
export function normalizeState(raw) {
  const bad = (reason) => ({ ok: false, reason });
  if (!isObject(raw)) return bad('Saved data is not a game.');
  if (!STATUSES.includes(raw.status)) return bad('Unknown game status.');
  if (!Array.isArray(raw.players)) return bad('Player list is missing.');
  const board = raw.board;
  if (!isObject(board) || !Array.isArray(board.cells)) return bad('Board is missing.');
  if (board.columns !== undefined && board.columns !== COLUMNS) return bad('Board has the wrong number of columns.');
  if (!Number.isInteger(board.rows) || board.rows < MIN_ROWS || board.rows > MAX_ROWS) {
    return bad('Board has an invalid number of rows.');
  }
  const inSetup = raw.status === 'setup';
  if (!inSetup && board.cells.length !== board.rows * COLUMNS) return bad("Board squares don't match the board size.");
  if (!inSetup && raw.players.length === 0) return bad('Game has no players.');

  const playerIds = new Set();
  const players = [];
  for (const p of raw.players) {
    if (!isObject(p) || typeof p.id !== 'string' || !p.id || playerIds.has(p.id)) return bad('A player is invalid.');
    playerIds.add(p.id);
    players.push({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : '',
      initials: typeof p.initials === 'string' && p.initials ? p.initials : null,
      colorIndex: Number.isInteger(p.colorIndex) && p.colorIndex >= 0 && p.colorIndex < PALETTE.length ? p.colorIndex : null,
    });
  }
  for (const p of players) {
    if (p.colorIndex === null) p.colorIndex = nextColorIndex(players);
    if (p.initials === null) p.initials = makeInitials(p.name, players.map((o) => o.initials).filter(Boolean));
  }

  const cellIds = new Set();
  const cells = [];
  for (const c of board.cells) {
    if (!isObject(c) || typeof c.id !== 'string' || !c.id || cellIds.has(c.id) || typeof c.text !== 'string') {
      return bad('A board square is invalid.');
    }
    cellIds.add(c.id);
    cells.push({
      id: c.id,
      text: c.text,
      ownerId: playerIds.has(c.ownerId) ? c.ownerId : null,
      isCenter: c.isCenter === true,
      edited: c.edited === true,
    });
  }

  const knownOwner = (o) => (playerIds.has(o) ? o : null);
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((e) => isObject(e) && Array.isArray(e.prevOwners) && e.prevOwners.length === cells.length)
    .map((e) => ({ ...e, prevOwners: e.prevOwners.map(knownOwner) }));
  const maxSeq = history.reduce((m, e) => (Number.isInteger(e.seq) ? Math.max(m, e.seq) : m), 0);

  const boardComplete = cells.length === board.rows * COLUMNS;
  return {
    ok: true,
    state: {
      version: 1,
      status: raw.status,
      setupStep: raw.setupStep === 'board' && boardComplete ? 'board' : 'players',
      players,
      board: { columns: COLUMNS, rows: board.rows, rowsOverridden: board.rowsOverridden === true, cells },
      history,
      nextSeq: Math.max(maxSeq + 1, Number.isInteger(raw.nextSeq) ? raw.nextSeq : 1),
      createdAt: timeOr(raw.createdAt, Date.now()),
      startedAt: timeOr(raw.startedAt, null),
      completedAt: timeOr(raw.completedAt, null),
    },
  };
}

/** Parses a raw saved string. Returns { ok: true, state } or { ok: false, reason }. */
export function parseSavedGame(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: 'Saved data is unreadable.' };
  }
  return normalizeState(parsed);
}

/**
 * Returns one of:
 *   { kind: 'none' }                  no saved game
 *   { kind: 'ok', state }             restored game
 *   { kind: 'corrupt', reason }       unsafe to restore; raw copy kept under CORRUPT_KEY
 *   { kind: 'unavailable' }           storage can't be read at all
 */
export function loadGame() {
  let rawText;
  try {
    rawText = localStorage.getItem(GAME_KEY);
  } catch {
    return { kind: 'unavailable' };
  }
  if (rawText === null) return { kind: 'none' };
  const result = parseSavedGame(rawText);
  if (result.ok) return { kind: 'ok', state: result.state };
  try {
    localStorage.setItem(CORRUPT_KEY, rawText);
  } catch {
    // Nothing more we can do; the original is still under GAME_KEY until a new game is saved.
  }
  return { kind: 'corrupt', reason: result.reason };
}

/** Returns true if the write succeeded. */
export function saveGame(state) {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(GAME_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Custom prompts: [{ id, text }]. Kept separately so they survive new games and resets. */
export function loadLibrary() {
  try {
    const list = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((p) => isObject(p) && typeof p.id === 'string' && typeof p.text === 'string') : [];
  } catch {
    return [];
  }
}

export function saveLibrary(list) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
