// Dev-only checks for logic.js and storage.js. Open tests.html through a local server.
import { BUILT_IN_PROMPTS, CENTER_PROMPT } from './prompts.js';
import {
  COLUMNS, recommendedRows, centerIndex, generateBoard, getLines, computeScores, normalizeText,
  cellTextProblem, customPromptProblem, unusedPrompts, createGame, syncRecommendedRows, addPlayer,
  removePlayer, changeOwner, claimCell, undoLast, makeInitials,
} from './logic.js';
import { normalizeState, parseSavedGame } from './storage.js';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, message: err.message });
  }
}
function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}
function eq(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message} expected ${b}, got ${a}`);
}

const at = (r, c) => r * COLUMNS + c;

/** An active game with named players and a generated board. */
function activeGame(rows, names) {
  const game = createGame();
  game.players = [];
  for (const name of names) addPlayer(game, name);
  game.board.rows = rows;
  game.board.cells = generateBoard(rows, BUILT_IN_PROMPTS, [], CENTER_PROMPT);
  game.status = 'active';
  return game;
}
function claimAll(game, indices, playerId) {
  for (const i of indices) changeOwner(game, game.board.cells[i].id, playerId);
}
const score = (game, player) => computeScores(game.players, game.board)[player.id];

// ---------- Board size ----------

test('recommendedRows matches the spec table', () => {
  eq([2, 3, 4, 5, 6, 7, 8, 9, 10].map(recommendedRows), [5, 5, 6, 6, 7, 7, 8, 8, 8]);
});

test('centerIndex is in the middle column for 5–8 rows', () => {
  eq([5, 6, 7, 8].map(centerIndex), [at(2, 2), at(2, 2), at(3, 2), at(3, 2)]);
});

test('recommended rows follow player count until overridden', () => {
  const game = createGame();
  eq(game.board.rows, 5, '2 players');
  for (let i = 0; i < 4; i++) addPlayer(game, '');
  syncRecommendedRows(game);
  eq(game.board.rows, 7, '6 players');
  game.board.rows = 5;
  game.board.rowsOverridden = true;
  addPlayer(game, '');
  addPlayer(game, '');
  syncRecommendedRows(game);
  eq(game.board.rows, 5, 'override kept with 8 players');
});

// ---------- Generation ----------

test('generateBoard: right size, unique, center pinned (200 runs)', () => {
  for (let run = 0; run < 200; run++) {
    const rows = 5 + (run % 4);
    const cells = generateBoard(rows, BUILT_IN_PROMPTS, ['smell URINE', 'Custom one'], CENTER_PROMPT);
    eq(cells.length, rows * COLUMNS, 'length');
    const keys = cells.map((c) => normalizeText(c.text));
    eq(new Set(keys).size, keys.length, 'duplicates');
    eq(cells.filter((c) => c.isCenter).length, 1, 'one center');
    eq(cells[centerIndex(rows)].text, CENTER_PROMPT, 'center text');
    eq(keys.filter((k) => k === 'smell urine').length, 1, 'center text only once');
  }
});

test('generateBoard includes every custom prompt when the pool is exactly full', () => {
  const builtIns = Array.from({ length: 20 }, (_, i) => `Built-in ${i}`);
  const customs = ['Custom A', 'Custom B', 'Custom C', 'Custom D'];
  const cells = generateBoard(5, builtIns, customs, CENTER_PROMPT); // 20 + 4 = 24 = 25 - 1
  for (const text of customs) assert(cells.some((c) => c.text === text), `missing ${text}`);
});

test('generateBoard de-dupes the pool and leaves blanks when short', () => {
  const cells = generateBoard(5, ['A', ' a ', 'B'], ['b', 'C'], CENTER_PROMPT);
  eq(cells.filter((c) => c.text).length, 4, 'center + A, B, C');
  eq(cells.filter((c) => !c.text).length, 21, 'blanks');
});

test('unusedPrompts skips prompts already on the board', () => {
  const cells = [{ id: 'c_0', text: 'Witch hat' }];
  eq(unusedPrompts(cells, ['witch  HAT', 'Toga'], ['toga', 'Cape']), ['Toga', 'Cape']);
});

// ---------- Duplicates ----------

test('normalizeText ignores case and whitespace', () => {
  eq(normalizeText('  Smell   URINE '), 'smell urine');
});

test('cell edit / replacement rejects duplicates on the board', () => {
  const cells = [{ id: 'c_0', text: 'Witch hat' }, { id: 'c_1', text: 'Toga' }];
  assert(cellTextProblem(cells, '  witch   HAT ', 'c_1'), 'edit to existing text');
  eq(cellTextProblem(cells, 'Witch hat', 'c_0'), null, 'same cell keeps its own text');
  assert(cellTextProblem(cells, '   ', 'c_0'), 'blank');
  eq(cellTextProblem(cells, 'Pirate', 'c_0'), null, 'new text ok');
});

test('custom prompt add / edit rejects duplicates', () => {
  const customs = [{ id: 'u_1', text: 'Cape caught in door' }, { id: 'u_2', text: 'Toga' }];
  assert(customPromptProblem(customs, 'CAPE caught  in door'), 'add duplicate');
  assert(customPromptProblem(customs, 'toga', 'u_1'), 'edit into duplicate');
  eq(customPromptProblem(customs, 'Toga', 'u_2'), null, 'edit keeps own text');
});

// ---------- Lines ----------

test('getLines count = rows + 7 × (rows − 4)', () => {
  eq([5, 6, 7, 8].map((r) => getLines(r).length), [12, 20, 28, 36]);
});

test('getLines includes bottom diagonals on an 8-row board', () => {
  const lines = getLines(8).map((l) => l.join(','));
  assert(lines.includes([at(3, 0), at(4, 1), at(5, 2), at(6, 3), at(7, 4)].join(',')), 'down-right');
  assert(lines.includes([at(3, 4), at(4, 3), at(5, 2), at(6, 1), at(7, 0)].join(',')), 'down-left');
});

test('lines: row, low column, both bottom diagonals each score', () => {
  const game = activeGame(8, ['Alex', 'Bo', 'Cy', 'Di']);
  const [a, b, c, d] = game.players;
  claimAll(game, [0, 1, 2, 3, 4].map((col) => at(0, col)), a.id);
  claimAll(game, [3, 4, 5, 6, 7].map((r) => at(r, 1)), b.id);
  claimAll(game, [at(3, 0), at(5, 2), at(6, 3), at(7, 4)], c.id); // down-right diagonal minus (4,1)
  eq(score(game, a).lines, 1, 'row');
  eq(score(game, b).lines, 1, 'column rows 3–7');
  eq(score(game, c).lines, 0, 'diagonal missing a square');
  claimAll(game, [0, 1, 2, 3, 4].map((k) => at(3 + k, 4 - k)), d.id);
  eq(score(game, d).lines, 1, 'down-left diagonal');
});

test('overlapping 6-long vertical counts as 2 lines', () => {
  const game = activeGame(7, ['Alex', 'Bo']);
  const [a] = game.players;
  claimAll(game, [0, 1, 2, 3, 4, 5].map((r) => at(r, 2)), a.id);
  eq(score(game, a), { squares: 6, lines: 2, total: 12 });
});

test('broken line (4 + another player) scores no bonus', () => {
  const game = activeGame(5, ['Alex', 'Bo']);
  const [a, b] = game.players;
  claimAll(game, [at(1, 0), at(1, 1), at(1, 2), at(1, 3)], a.id);
  claimAll(game, [at(1, 4)], b.id);
  eq(score(game, a).lines, 0);
});

test('spec example: 7 squares with one line = 10', () => {
  const game = activeGame(7, ['Alex', 'Bo']);
  const [a] = game.players;
  claimAll(game, [at(0, 0), at(0, 1), at(0, 2), at(0, 3), at(0, 4), at(2, 0), at(4, 4)], a.id);
  eq(score(game, a), { squares: 7, lines: 1, total: 10 });
});

// ---------- Claims, undo, edits ----------

test('claimCell refuses an already-claimed square (double tap)', () => {
  const game = activeGame(5, ['Alex', 'Bo']);
  const [a, b] = game.players;
  assert(claimCell(game, 'c_0', a.id));
  assert(!claimCell(game, 'c_0', a.id), 'same player again');
  assert(!claimCell(game, 'c_0', b.id), 'other player');
  eq(game.history.length, 1);
});

test('line bonus removed and restored by unclaim / reassign and their undo', () => {
  const game = activeGame(5, ['Alex', 'Bo']);
  const [a, b] = game.players;
  const row = [0, 1, 2, 3, 4].map((col) => at(0, col));
  claimAll(game, row, a.id);
  eq(score(game, a).total, 8, 'line');
  changeOwner(game, 'c_2', null);
  eq(score(game, a).total, 4, 'after unclaim');
  undoLast(game);
  eq(score(game, a).total, 8, 'undo unclaim');
  changeOwner(game, 'c_2', b.id);
  eq([score(game, a).total, score(game, b).total], [4, 1], 'after reassign');
  undoLast(game);
  eq([score(game, a).total, score(game, b).total], [8, 0], 'undo reassign');
  undoLast(game);
  eq(score(game, a).total, 4, 'undo last claim');
});

test('removing a player clears only their squares; undo never restores them', () => {
  const game = activeGame(5, ['Alex', 'Bo', 'Cy']);
  const [a, b] = game.players;
  claimAll(game, [0, 1, 2, 3, 4].map((col) => at(0, col)), a.id);
  claimAll(game, [0, 1, 2, 3, 4].map((col) => at(1, col)), b.id);
  removePlayer(game, b.id);
  eq(score(game, a).total, 8, 'Alex keeps line');
  assert(!game.board.cells.some((c) => c.ownerId === b.id), 'Bo squares cleared');
  assert(!(b.id in computeScores(game.players, game.board)), 'Bo gone from scores');
  while (game.history.length) {
    undoLast(game);
    assert(!game.board.cells.some((c) => c.ownerId === b.id), 'ghost owner after undo');
  }
});

test('active-game player add/remove never changes the board', () => {
  const game = activeGame(7, ['Alex', 'Bo', 'Cy']);
  const [a, b, c] = game.players;
  claimAll(game, [0, 6, 12], a.id);
  claimAll(game, [1, 7], b.id);
  claimAll(game, [2], c.id);
  const before = {
    rows: game.board.rows,
    length: game.board.cells.length,
    ids: game.board.cells.map((x) => x.id),
    center: game.board.cells.findIndex((x) => x.isCenter),
  };
  const othersOwnership = () => game.board.cells.map((x) => (x.ownerId === b.id ? null : x.ownerId));
  const ownershipBefore = othersOwnership();
  addPlayer(game, 'Di');
  addPlayer(game, 'Ed');
  removePlayer(game, b.id);
  eq(game.board.rows, before.rows, 'rows');
  eq(game.board.cells.length, before.length, 'cell count');
  eq(game.board.cells.map((x) => x.id), before.ids, 'cell ids');
  eq(game.board.cells.findIndex((x) => x.isCenter), before.center, 'center');
  eq(othersOwnership(), ownershipBefore, 'other ownership');
});

test('players keep distinct colors and initials', () => {
  const game = activeGame(5, ['Sam Smith', 'Sara Stone', 'Sam']);
  eq(new Set(game.players.map((p) => p.initials)).size, 3, 'initials');
  eq(new Set(game.players.map((p) => p.colorIndex)).size, 3, 'colors');
  removePlayer(game, game.players[0].id);
  const added = addPlayer(game, 'New');
  eq(added.colorIndex, 0, 'reuses the freed color');
  eq(makeInitials('  '), '?');
});

// ---------- Saved state ----------

test('normalizeState round-trips a real game', () => {
  const game = activeGame(6, ['Alex', 'Bo']);
  claimAll(game, [0, 1], game.players[0].id);
  const result = parseSavedGame(JSON.stringify(game));
  assert(result.ok, result.reason);
  eq(result.state.board, game.board);
  eq(result.state.players, game.players);
  eq(result.state.history.length, 2);
});

test('normalizeState repairs nextSeq and stale owner ids', () => {
  const game = activeGame(5, ['Alex', 'Bo']);
  claimAll(game, [0, 1, 2], game.players[0].id);
  const raw = JSON.parse(JSON.stringify(game));
  delete raw.nextSeq;
  raw.board.cells[4].ownerId = 'p_ghost';
  const result = normalizeState(raw);
  assert(result.ok, result.reason);
  eq(result.state.nextSeq, 4, 'nextSeq');
  eq(result.state.board.cells[4].ownerId, null, 'stale owner');
});

test('normalizeState treats a wrong cell count as corrupt and leaves the board alone', () => {
  const game = activeGame(7, ['Alex', 'Bo']);
  const raw = JSON.parse(JSON.stringify(game));
  raw.board.cells.pop();
  const result = normalizeState(raw);
  eq(result.ok, false, 'corrupt');
  eq(raw.board.cells.length, 34, 'input untouched');
});

test('unparseable save is corrupt', () => {
  eq(parseSavedGame('{not json').ok, false);
  eq(normalizeState({ status: 'active' }).ok, false);
});

// ---------- Report ----------

const failed = results.filter((r) => !r.ok);
document.getElementById('summary').textContent = failed.length
  ? `${failed.length} of ${results.length} tests FAILED`
  : `All ${results.length} tests passed`;
document.getElementById('summary').className = failed.length ? 'fail' : 'pass';
document.getElementById('results').replaceChildren(...results.map((r) => {
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` — ${r.message}`}`;
  return li;
}));
