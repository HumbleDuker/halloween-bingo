# Halloween Bar Bingo

A small phone-first bingo tracker for a Halloween bar crawl. One Game Master runs it from an iPhone: enter players, build the board, tap a square, tap who saw it. Scores and five-in-a-row bonuses update automatically.

Plain HTML, CSS and JavaScript. No build step, no backend, no accounts. Everything is saved in the browser's local storage on the device that's running the game.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell |
| `css/styles.css` | All styling |
| `js/prompts.js` | Built-in square prompts. Edit this list freely. |
| `js/logic.js` | Game rules: board generation, lines, scoring, players, undo |
| `js/storage.js` | Saving and loading (localStorage) |
| `js/app.js` | Screens and tap handling |
| `tests.html`, `js/tests.js` | Developer test page for the game rules (not linked from the app) |

## Scoring

- Each claimed square = 1 point.
- Each run of 5 touching squares owned by one player (across, down, or either diagonal) = +3. Overlapping runs count separately.

## Running locally

The app uses JavaScript modules, so it has to be served over HTTP. Opening `index.html` straight from disk won't work. Any static server works, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/` (or `/tests.html` to run the logic tests).

## Deploying

Push to GitHub, then in the repository go to **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. The site appears at `https://<user>.github.io/halloween-bingo/`.

## Saving on iPhone: read before game night

**Pick Safari or the Home Screen app before starting the game, and stick with that one for the night.**

- Safari and an app added to the Home Screen keep **separate storage**. A game started in Safari has to be continued in Safari. A game started from the Home Screen icon has to be continued from the Home Screen icon. Nothing transfers between them.
- **Don't use Private Browsing.** The game is lost when the private tab closes.
- Use **one tab**. Two tabs of the app will overwrite each other's saves.
- The game saves after every change and survives refreshing, locking the phone, and closing Safari. If saving ever fails, a red banner appears at the top. Don't close the app while it's showing.
- In regular Safari, data for a site you haven't visited in a long while may be cleared by the browser. That's no problem for one night, but don't count on a finished game still being there weeks later.

Custom prompts are saved separately from the game, so they're kept when you start a new game or reset.
