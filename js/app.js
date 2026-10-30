// UI: renders the current state and turns taps into state changes.
// Every change goes through commit(), which saves first and then re-renders.
import { BUILT_IN_PROMPTS, CENTER_PROMPT } from './prompts.js';
import {
  COLUMNS, MIN_ROWS, MAX_ROWS, MIN_PLAYERS, MAX_PLAYERS, MAX_PROMPT_LENGTH, PALETTE,
  cleanText, makeId, recommendedRows, generateBoard, unusedPrompts,
  cellTextProblem, customPromptProblem, completedLines, computeScores, rankPlayers,
  assignInitials, playerNameProblem, createGame, syncRecommendedRows, addPlayer, renamePlayer,
  removePlayer, ownedCount, changeOwner, claimCell, undoLast,
} from './logic.js';
import { loadGame, saveGame, clearGame, loadLibrary, saveLibrary } from './storage.js';

const app = document.getElementById('app');
const sheet = document.getElementById('sheet');

let state = null; // the saved game (see createGame in logic.js), or null
let library = loadLibrary(); // custom prompts: [{ id, text }]
let view = 'landing'; // 'landing' | 'game' (not saved)
let editMode = false; // active-game Edit Game mode (not saved)
let loadProblem = null; // reason text when the saved game couldn't be restored
let saveFailed = false;

// ---------- Saving ----------

function persist() {
  const wasFailing = saveFailed;
  saveFailed = !saveGame(state);
  return wasFailing !== saveFailed;
}

/** Save, then redraw. Call after every meaningful change. */
function commit() {
  persist();
  render();
}

function saveCustomPrompts() {
  if (!saveLibrary(library)) saveFailed = true;
}

const customTexts = () => library.map((p) => p.text);
const playerById = (id) => state.players.find((p) => p.id === id) ?? null;
const colorOf = (player) => PALETTE[player.colorIndex] ?? PALETTE[0];

// ---------- DOM helper ----------

/** h('button', { class: 'btn', onclick: fn, text: 'Go' }, ...children). Text is never parsed as HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'value') el.value = value;
    else if (key === 'style') Object.assign(el.style, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) el.append(child);
  }
  return el;
}

function swatch(player, mini = false) {
  const c = colorOf(player);
  return h('span', { class: mini ? 'swatch mini' : 'swatch', style: { background: c.bg, color: c.fg }, text: player.initials });
}

function scrollTop() {
  window.scrollTo(0, 0);
}

// ---------- Bottom sheet ----------

function openSheet(title, ...content) {
  sheet.replaceChildren(
    h('div', { class: 'sheet-inner' },
      h('h2', { text: title }),
      ...content,
      h('button', { class: 'btn', onclick: closeSheet, text: 'Cancel' }),
    ),
  );
  if (!sheet.open) sheet.showModal();
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

// Tapping the dark backdrop (outside the sheet content) closes it.
sheet.addEventListener('click', (event) => {
  if (event.target === sheet) closeSheet();
});

// ---------- Game-level actions ----------

function startNewGame() {
  if ((state || loadProblem) && !confirm('Start a new game?\n\nThe saved game, including all claims and scores, will be deleted. Your custom prompts are kept.')) {
    return;
  }
  state = createGame();
  loadProblem = null;
  editMode = false;
  view = 'game';
  commit();
  scrollTop();
}

function resetGame() {
  if (!confirm('Delete this game?\n\nAll players, claims and scores will be permanently lost. Your custom prompts are kept.')) return;
  closeSheet();
  clearGame();
  state = null;
  editMode = false;
  view = 'landing';
  render();
  scrollTop();
}

// ---------- Render ----------

function render() {
  app.replaceChildren();
  app.classList.remove('has-bar');
  document.querySelector('.bar')?.remove();
  if (saveFailed) {
    app.append(h('div', { class: 'banner', role: 'alert', text: "Not saving! Storage isn't working. Don't close Safari." }));
  }
  if (view === 'landing' || !state) renderLanding();
  else if (state.status === 'setup' && state.setupStep === 'players') renderSetupPlayers();
  else if (state.status === 'setup') renderSetupBoard();
  else if (state.status === 'active') renderActive();
  else renderCompleted();
}

function renderLanding() {
  const parts = [h('div', { class: 'pumpkin', 'aria-hidden': 'true', text: '🎃' }), h('h1', { text: 'Halloween Bar Bingo' })];
  const buttons = [];
  if (loadProblem) {
    parts.push(
      h('p', { class: 'error', text: "Your saved game couldn't be safely restored." }),
      h('p', { class: 'muted', text: `${loadProblem} The original save has been kept as a backup on this device.` }),
    );
    buttons.push(h('button', { class: 'btn primary', onclick: startNewGame, text: 'Start New Game' }));
  } else if (state) {
    const summary = {
      setup: `Setup in progress · ${state.players.length} players`,
      active: `Game in progress · ${state.players.length} players`,
      completed: 'Finished game · final standings saved',
    }[state.status];
    parts.push(h('p', { class: 'muted', text: summary }));
    buttons.push(
      h('button', { class: 'btn primary', onclick: () => { view = 'game'; render(); scrollTop(); }, text: 'Resume Game' }),
      h('button', { class: 'btn', onclick: startNewGame, text: 'Start New Game' }),
    );
  } else {
    buttons.push(h('button', { class: 'btn primary', onclick: startNewGame, text: 'Start New Game' }));
  }
  app.append(h('div', { class: 'landing' }, ...parts, h('div', { class: 'stack' }, ...buttons)));
}

// ---------- Setup: players ----------

function renderSetupPlayers() {
  const { players, board } = state;
  const recommended = recommendedRows(players.length);

  const rows = players.map((p, i) =>
    h('div', { class: 'player-row' },
      h('span', { 'data-chip': p.id }, swatch(p)),
      h('input', {
        type: 'text', value: p.name, placeholder: `Player ${i + 1}`, maxlength: 24,
        autocapitalize: 'words', autocomplete: 'off', enterkeyhint: 'next', 'aria-label': `Player ${i + 1} name`,
        oninput: (e) => {
          p.name = e.target.value;
          assignInitials(players);
          for (const other of players) {
            app.querySelector(`[data-chip="${other.id}"]`)?.replaceChildren(swatch(other));
          }
          if (persist()) render();
        },
      }),
      h('button', {
        class: 'icon-btn', 'aria-label': `Remove player ${i + 1}`, text: '×', disabled: players.length <= MIN_PLAYERS,
        onclick: () => {
          removePlayer(state, p.id);
          assignInitials(players);
          syncRecommendedRows(state);
          commit();
        },
      }),
    ),
  );

  const setRows = (rowsValue, overridden) => {
    board.rows = rowsValue;
    board.rowsOverridden = overridden;
    syncRecommendedRows(state);
    commit();
  };

  app.append(
    h('h1', { text: 'New Game' }),
    h('p', { class: 'muted', text: 'Enter each player. Colors and initials are assigned automatically.' }),
    h('h2', { text: `Players (${players.length})` }),
    h('div', { class: 'stack' }, ...rows),
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn', disabled: players.length >= MAX_PLAYERS, text: '+ Add player',
        onclick: () => {
          addPlayer(state, '');
          assignInitials(players);
          syncRecommendedRows(state);
          commit();
          const inputs = app.querySelectorAll('.player-row input');
          inputs[inputs.length - 1]?.focus();
        },
      }),
    ),
    h('h2', { text: 'Board size' }),
    h('div', { class: 'card stack' },
      h('p', { text: `Recommended for ${players.length} players: ${COLUMNS} × ${recommended}` }),
      h('div', { class: 'stepper' },
        h('button', { class: 'icon-btn', 'aria-label': 'Fewer rows', text: '−', disabled: board.rows <= MIN_ROWS, onclick: () => setRows(board.rows - 1, true) }),
        h('span', { class: 'value', text: `${COLUMNS} × ${board.rows}` }),
        h('button', { class: 'icon-btn', 'aria-label': 'More rows', text: '+', disabled: board.rows >= MAX_ROWS, onclick: () => setRows(board.rows + 1, true) }),
      ),
      board.rowsOverridden
        ? h('button', { class: 'link-btn', onclick: () => setRows(recommended, false), text: 'Use recommended size' })
        : h('p', { class: 'muted', text: 'Follows the player count until you change it.' }),
    ),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: goToBoardStep, text: 'Next: Build board →' })),
    h('button', { class: 'link-btn', onclick: resetGame, text: 'Delete this game' }),
  );
}

function goToBoardStep() {
  for (const p of state.players) {
    const problem = playerNameProblem(state.players, p.name, p.id);
    if (problem) {
      alert(problem);
      return;
    }
    p.name = cleanText(p.name);
  }
  assignInitials(state.players);
  const { board } = state;
  if (board.cells.length !== board.rows * COLUMNS) {
    if (board.cells.some((c) => c.edited) && !confirm('The board size changed, so the board will be rebuilt.\n\nYour square edits will be lost. Continue?')) {
      return;
    }
    const centerText = board.cells.find((c) => c.isCenter)?.text || CENTER_PROMPT;
    board.cells = generateBoard(board.rows, BUILT_IN_PROMPTS, customTexts(), centerText);
  }
  state.setupStep = 'board';
  commit();
  scrollTop();
}

// ---------- Setup: board ----------

function renderSetupBoard() {
  const { board } = state;

  const regenerate = () => {
    if (board.cells.some((c) => c.edited && !c.isCenter) && !confirm('Regenerate the board?\n\nYour square edits will be replaced. The center square is kept.')) {
      return;
    }
    const centerText = board.cells.find((c) => c.isCenter)?.text || CENTER_PROMPT;
    board.cells = generateBoard(board.rows, BUILT_IN_PROMPTS, customTexts(), centerText);
    commit();
  };

  const startGame = () => {
    if (board.cells.some((c) => !cleanText(c.text))) {
      alert('Fill in every square before starting.');
      return;
    }
    if (!confirm(`Start the game?\n\nThe board size (${COLUMNS} × ${board.rows}) will be locked.`)) return;
    state.status = 'active';
    state.startedAt = Date.now();
    commit();
    scrollTop();
  };

  app.append(
    h('h1', { text: 'Build the Board' }),
    h('p', { class: 'muted', text: `${COLUMNS} × ${board.rows} · Tap any square to edit or replace it.` }),
    renderBoard((cell) => openCellEditor(cell)),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: regenerate, text: '↻ Regenerate board' })),
    renderCustomPrompts(),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { state.setupStep = 'players'; commit(); scrollTop(); }, text: '← Players' }),
      h('button', { class: 'btn primary', onclick: startGame, text: 'Start Game' }),
    ),
  );
}

function renderCustomPrompts() {
  const error = h('p', { class: 'error' });
  const input = h('input', { type: 'text', placeholder: 'New custom prompt', maxlength: MAX_PROMPT_LENGTH, autocomplete: 'off', enterkeyhint: 'done' });
  const form = h('form', {
    class: 'row',
    onsubmit: (e) => {
      e.preventDefault();
      const problem = customPromptProblem(library, input.value);
      if (problem) {
        error.textContent = problem;
        return;
      }
      library.push({ id: makeId('u'), text: cleanText(input.value) });
      saveCustomPrompts();
      render();
    },
  }, h('div', { class: 'grow' }, input), h('button', { class: 'btn', type: 'submit', text: 'Add' }));

  const items = library.map((p) =>
    h('li', {},
      h('span', { class: 'grow', text: p.text }),
      h('button', { class: 'btn small', onclick: () => openCustomPromptEditor(p), text: 'Edit' }),
      h('button', {
        class: 'btn small danger', text: 'Delete',
        onclick: () => {
          if (!confirm(`Delete "${p.text}" from your custom prompts?\n\nSquares already on the board are not changed.`)) return;
          library = library.filter((x) => x.id !== p.id);
          saveCustomPrompts();
          render();
        },
      }),
    ),
  );

  return h('section', {},
    h('h2', { text: `My custom prompts (${library.length})` }),
    h('p', { class: 'muted', text: 'Used when generating boards and kept for future games.' }),
    form,
    error,
    items.length ? h('ul', { class: 'list' }, ...items) : null,
  );
}

function openCustomPromptEditor(prompt) {
  const error = h('p', { class: 'error' });
  const textarea = h('textarea', { maxlength: MAX_PROMPT_LENGTH, value: prompt.text });
  openSheet('Edit custom prompt',
    textarea,
    error,
    h('button', {
      class: 'btn primary', text: 'Save',
      onclick: () => {
        const problem = customPromptProblem(library, textarea.value, prompt.id);
        if (problem) {
          error.textContent = problem;
          return;
        }
        prompt.text = cleanText(textarea.value);
        saveCustomPrompts();
        closeSheet();
        render();
      },
    }),
  );
}

/** Edit a square's text (setup, or Edit Game mode). In Edit Game mode it also offers unclaim/reassign. */
function openCellEditor(cell) {
  const { board } = state;
  const error = h('p', { class: 'error' });
  const textarea = h('textarea', { maxlength: MAX_PROMPT_LENGTH, value: cell.text, 'aria-label': 'Square text' });
  const saveToLibrary = h('input', { type: 'checkbox' });

  const applyText = (text) => {
    const problem = cellTextProblem(board.cells, text, cell.id);
    if (problem) {
      error.textContent = problem;
      return false;
    }
    cell.text = cleanText(text);
    cell.edited = true;
    return true;
  };

  const save = () => {
    if (!applyText(textarea.value)) return;
    if (saveToLibrary.checked && !customPromptProblem(library, cell.text)) {
      library.push({ id: makeId('u'), text: cell.text });
      saveCustomPrompts();
    }
    closeSheet();
    commit();
  };

  const unused = unusedPrompts(board.cells, BUILT_IN_PROMPTS, customTexts());
  const unusedCustoms = unusedPrompts(board.cells, [], customTexts());

  const swapRandom = () => {
    if (!unused.length) {
      error.textContent = 'No unused prompts left. Type your own instead.';
      return;
    }
    if (applyText(unused[Math.floor(Math.random() * unused.length)])) {
      closeSheet();
      commit();
    }
  };

  const content = [
    textarea,
    error,
    h('label', { class: 'check' }, saveToLibrary, 'Also save to my custom prompts'),
    h('button', { class: 'btn primary', onclick: save, text: 'Save text' }),
    h('button', { class: 'btn', onclick: swapRandom, text: '🎲 Swap for a random prompt' }),
  ];

  if (unusedCustoms.length) {
    content.push(
      h('p', { class: 'sheet-label', text: 'Replace with a custom prompt' }),
      h('div', { class: 'option-list' }, ...unusedCustoms.map((text) =>
        h('button', { class: 'option', text, onclick: () => { if (applyText(text)) { closeSheet(); commit(); } } }),
      )),
    );
  }

  if (state.status === 'active') {
    const owner = playerById(cell.ownerId);
    content.unshift(h('p', { class: 'muted', text: 'Editing the text keeps the current owner.' }));
    content.push(
      h('p', { class: 'sheet-label', text: owner ? `Owner: ${owner.name}` : 'Owner: nobody yet' }),
      owner
        ? h('button', {
            class: 'btn danger', text: `Unclaim (remove from ${owner.name})`,
            onclick: () => { closeSheet(); changeOwner(state, cell.id, null); commit(); },
          })
        : null,
      h('p', { class: 'sheet-label', text: owner ? 'Reassign to' : 'Assign to' }),
      playerGrid(state.players.filter((p) => p.id !== cell.ownerId), (p) => {
        closeSheet();
        changeOwner(state, cell.id, p.id);
        commit();
      }),
    );
  }

  openSheet(cell.isCenter ? 'Edit center square' : 'Edit square', ...content);
}

// ---------- Board ----------

/** onTap(cell) makes squares tappable; pass null for a read-only board. */
function renderBoard(onTap) {
  const { board } = state;
  const inLine = new Set(completedLines(board).flatMap((line) => line.cells));
  return h('div', { class: 'board' },
    ...board.cells.map((cell, i) => {
      const owner = playerById(cell.ownerId);
      const classes = ['cell'];
      if (cell.isCenter) classes.push('center');
      if (!cell.text) classes.push('blank');
      if (owner) classes.push('owned');
      if (inLine.has(i)) classes.push('in-line');
      const color = owner ? colorOf(owner) : null;
      const label = owner ? `${cell.text}, claimed by ${owner.name}` : cell.text || 'Empty square';
      return h(onTap ? 'button' : 'div', {
        class: classes.join(' '),
        type: onTap ? 'button' : null,
        'aria-label': label,
        style: color ? { background: color.bg, color: color.fg } : null,
        onclick: onTap ? () => onTap(cell) : null,
      },
        owner ? h('span', { class: 'badge', text: owner.initials }) : null,
        h('span', { class: 'text', text: cell.text || 'Tap to edit' }),
      );
    }),
  );
}

function playerGrid(players, onPick) {
  return h('div', { class: 'player-grid' },
    ...players.map((p) => {
      const c = colorOf(p);
      return h('button', { class: 'player-btn', style: { background: c.bg, color: c.fg }, onclick: () => onPick(p) },
        h('span', { class: 'initials', text: p.initials }),
        h('span', { class: 'pname', text: p.name }),
      );
    }),
  );
}

// ---------- Active game ----------

function renderActive() {
  const scores = computeScores(state.players, state.board);

  if (editMode) {
    app.append(
      h('div', { class: 'banner edit' },
        h('span', { text: 'Editing game' }),
        h('button', { class: 'btn small', onclick: () => { editMode = false; render(); }, text: 'Done' }),
      ),
      renderPlayerEditor(),
      h('p', { class: 'muted', text: 'Tap a square to edit its text, unclaim it, or reassign it.' }),
    );
  } else {
    app.append(h('div', { class: 'scoreboard' },
      ...state.players.map((p) => {
        const s = scores[p.id];
        return h('div', { class: 'score' },
          swatch(p, true),
          h('div', { class: 'info' },
            h('span', { class: 'name', text: p.name }),
            h('span', {},
              h('span', { class: 'total', text: String(s.total) }),
              ' ',
              s.lines ? h('span', { class: 'breakdown', text: `${s.squares} + ${s.lines * 3}` }) : null,
            ),
          ),
        );
      }),
    ));
  }

  app.append(renderBoard(editMode ? openCellEditor : openClaimSheet));
  renderActionBar();
}

function openClaimSheet(cell) {
  const owner = playerById(cell.ownerId);
  if (owner) {
    openSheet(cell.text,
      h('p', {}, swatch(owner, true), ` Claimed by ${owner.name}`),
      h('p', { class: 'muted', text: 'Made a mistake? Use Undo, or ⋯ Menu → Edit Game to unclaim or reassign it.' }),
    );
    return;
  }
  openSheet(cell.text,
    h('p', { class: 'sheet-label', text: 'Who claimed it?' }),
    playerGrid(state.players, (p) => {
      closeSheet();
      if (claimCell(state, cell.id, p.id)) commit();
    }),
  );
}

function renderActionBar() {
  const last = state.history.at(-1);
  const undoLabel = !last ? 'nothing yet' : last.type === 'unclaim' ? `unclaim · ${last.text}` : `${last.playerName} · ${last.text}`;
  app.classList.add('has-bar');
  document.body.append(
    h('nav', { class: 'bar' },
      h('button', {
        class: 'btn', disabled: !last, 'aria-label': last ? `Undo ${undoLabel}` : 'Undo',
        onclick: () => { if (undoLast(state)) commit(); },
      }, h('span', { text: '↶ Undo' }), h('span', { class: 'sub', text: undoLabel })),
      h('button', { class: 'btn', onclick: openHistorySheet },
        h('span', { text: 'History' }), h('span', { class: 'sub', text: `${state.history.length} changes` })),
      h('button', { class: 'btn', onclick: openMenuSheet }, h('span', { text: '⋯ Menu' }), h('span', { class: 'sub', text: 'edit · end' })),
    ),
  );
}

function historyList(entries) {
  if (!entries.length) return h('p', { class: 'muted', text: 'No claims yet.' });
  return h('ul', { class: 'list' },
    ...[...entries].reverse().map((e) => {
      const player = playerById(e.playerId);
      const action = {
        claim: `${e.playerName} claimed`,
        reassign: `Moved to ${e.playerName} (was ${e.fromName})`,
        unclaim: `Unclaimed (was ${e.fromName})`,
      }[e.type] ?? '';
      return h('li', {},
        h('span', { class: 'seq', text: `#${e.seq}` }),
        player ? swatch(player, true) : null,
        h('span', { class: 'grow' }, h('strong', { text: action }), h('br'), e.text),
      );
    }),
  );
}

function openHistorySheet() {
  openSheet('Claim history', historyList(state.history));
}

function openMenuSheet() {
  openSheet('Menu',
    h('button', {
      class: 'btn', disabled: editMode, text: '✏️ Edit Game',
      onclick: () => {
        if (!confirm('Edit the game?\n\nYou can rename, add or remove players, change square text, and unclaim or reassign squares. The board size cannot change.')) return;
        closeSheet();
        editMode = true;
        render();
        scrollTop();
      },
    }),
    h('button', {
      class: 'btn', text: '🏁 End Game',
      onclick: () => {
        if (!confirm('End the game now?\n\nFinal standings will be shown and squares can no longer be claimed.')) return;
        closeSheet();
        state.status = 'completed';
        state.completedAt = Date.now();
        editMode = false;
        commit();
        scrollTop();
      },
    }),
    h('button', { class: 'btn danger', onclick: resetGame, text: 'Reset / Delete Game' }),
  );
}

function renderPlayerEditor() {
  const error = h('p', { class: 'error' });
  const rows = state.players.map((p) =>
    h('div', { class: 'player-row' },
      swatch(p),
      h('input', {
        type: 'text', value: p.name, maxlength: 24, autocapitalize: 'words', autocomplete: 'off', 'aria-label': `Rename ${p.name}`,
        onchange: (e) => {
          const problem = renamePlayer(state, p.id, e.target.value);
          if (problem) {
            alert(problem);
            e.target.value = p.name;
            return;
          }
          commit();
        },
      }),
      h('button', {
        class: 'icon-btn', 'aria-label': `Remove ${p.name}`, text: '×', disabled: state.players.length <= MIN_PLAYERS,
        onclick: () => {
          if (!confirm(`Remove ${p.name} from the game?`)) return;
          const owned = ownedCount(state, p.id);
          if (owned && !confirm(`${p.name} owns ${owned} square${owned === 1 ? '' : 's'}.\n\nOK = clear their squares and remove ${p.name}.\nCancel = keep ${p.name}.`)) return;
          removePlayer(state, p.id);
          commit();
        },
      }),
    ),
  );

  const input = h('input', { type: 'text', placeholder: 'New player name', maxlength: 24, autocapitalize: 'words', autocomplete: 'off' });
  const addForm = h('form', {
    class: 'row',
    onsubmit: (e) => {
      e.preventDefault();
      const problem = playerNameProblem(state.players, input.value);
      if (problem) {
        error.textContent = problem;
        return;
      }
      addPlayer(state, input.value);
      commit();
    },
  }, h('div', { class: 'grow' }, input), h('button', { class: 'btn', type: 'submit', text: 'Add' }));

  return h('section', { class: 'stack' },
    ...rows,
    state.players.length < MAX_PLAYERS ? addForm : h('p', { class: 'muted', text: `Maximum ${MAX_PLAYERS} players.` }),
    error,
  );
}

// ---------- Completed game ----------

function renderCompleted() {
  const scores = computeScores(state.players, state.board);
  const standings = rankPlayers(state.players, scores);
  app.append(
    h('h1', { text: '🏆 Final Standings' }),
    h('ul', { class: 'list standings' },
      ...standings.map(({ player, score, rank }) =>
        h('li', {},
          h('span', { class: 'rank', text: String(rank) }),
          swatch(player),
          h('span', { class: 'grow' },
            h('strong', { text: player.name }), h('br'),
            h('span', { class: 'muted', text: `${score.squares} square${score.squares === 1 ? '' : 's'} ·${score.lines} line${score.lines === 1 ? '' : 's'} (+${score.lines * 3})` }),
          ),
          h('span', { class: 'total', text: String(score.total) }),
        ),
      ),
    ),
    h('h2', { text: 'Final board' }),
    renderBoard(null),
    h('details', {}, h('summary', { text: `Claim history (${state.history.length})` }), historyList(state.history)),
    h('div', { class: 'stack', style: { marginTop: '24px' } },
      h('button', {
        class: 'btn', text: '↩ Reopen Game',
        onclick: () => {
          if (!confirm('Reopen this game?\n\nThe board, claims and history are kept and play continues.')) return;
          state.status = 'active';
          state.completedAt = null;
          commit();
          scrollTop();
        },
      }),
      h('button', { class: 'btn primary', onclick: startNewGame, text: 'Start New Game' }),
      h('button', { class: 'btn danger', onclick: resetGame, text: 'Reset / Delete Game' }),
    ),
  );
}

// ---------- Start up ----------

const loaded = loadGame();
if (loaded.kind === 'ok') {
  state = loaded.state;
} else if (loaded.kind === 'corrupt') {
  loadProblem = loaded.reason;
} else {
  if (loaded.kind === 'unavailable') saveFailed = true;
  state = createGame();
  view = 'game';
  persist();
}
render();
