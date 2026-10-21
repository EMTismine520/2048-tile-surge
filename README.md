# Tile Surge

A browser-based 2048 puzzle game: slide tiles with the arrow keys (or swipe on touch screens) and merge equal numbers to reach the 2048 tile.

Tile Surge is a fork of [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048) (MIT License, Copyright (c) 2014 Gabriele Cirulli), which is itself based on [1024](https://play.google.com/store/apps/details?id=com.veewo.a1024) and [Saming's 2048](http://saming.fr/p/2048/).

## Run

No build step is needed to play. Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Controls

- Move: arrow keys, WASD, or Vim keys (HJKL); swipe on touch screens.
- Restart: `R` key or the "New Game" button.

## Project structure

```
index.html                 entry point; script load order is the dependency order
js/
  application.js           bootstrap, wires the managers into GameManager
  game_manager.js          game state, move/merge rules, win/lose detection
  grid.js, tile.js         board and tile data models
  html_actuator.js         renders the grid/score/messages to the DOM
  keyboard_input_manager.js  keyboard, touch and button input, emits events
  local_storage_manager.js best score and game-state persistence
  *_polyfill.js            legacy browser polyfills
style/
  main.scss, helpers.scss  styles (source)
  main.css                 compiled output, committed
```

## Editing styles

`style/main.css` is compiled from `style/main.scss` and is committed, so changes to the SCSS only take effect after recompiling it:

```bash
sass style/main.scss style/main.css
```

## Notes

- Saved games live in `localStorage` under `gameState` (with its `keepPlaying` field) and `bestScore`. Those keys are kept stable so existing saves keep working. A corrupted save is ignored and a new game starts.

## License

MIT. See [LICENSE.txt](LICENSE.txt).
