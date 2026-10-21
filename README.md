# Tile Surge

A browser-based 2048 puzzle game: slide tiles with the arrow keys (or swipe on touch screens) and merge equal numbers to reach the 2048 tile. The interface is in Chinese (方块浪潮), mobile-first, and always fits on one screen with no scrolling.

Tile Surge is a fork of [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048) (MIT License, Copyright (c) 2014 Gabriele Cirulli), which is itself based on [1024](https://play.google.com/store/apps/details?id=com.veewo.a1024) and [Saming's 2048](http://saming.fr/p/2048/).

## Run

No build step is needed to play. Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Controls

- Move: arrow keys, WASD, or Vim keys (HJKL); swipe anywhere on touch screens.
- Restart: `R` key or the "新游戏" (new game) button.
- Clear tiles: the "清除方块" button under the board removes the 3 smallest tiles (no new tile is spawned) so you can keep playing.
- Revive: on the game-over screen, "复活" removes the 6 smallest tiles and continues with your current score. It can be used any number of times.
- Sound: the speaker button in the top bar, or the `M` key, mutes and unmutes the sound effects. The setting is remembered.

The numbers live in `GameManager.CLEAR_COUNT`, `GameManager.REVIVE_CLEAR_COUNT` and `GameManager.CLEAR_LIMIT` (`js/game_manager.js`). Set `CLEAR_LIMIT` to a number to cap "Clear tiles" uses per game; `null` means unlimited. Both actions always leave at least one tile on the board.

## Project structure

```
index.html                 entry point; script load order is the dependency order
js/
  application.js           bootstrap, wires the managers into GameManager
  game_manager.js          game state, move/merge rules, win/lose detection
  grid.js, tile.js         board and tile data models
  html_actuator.js         renders the grid/score/messages to the DOM
  keyboard_input_manager.js  keyboard, touch and button input, emits events
  local_storage_manager.js best score, game-state and mute persistence
  sound_manager.js         sound effects, synthesized live with Web Audio
  *_polyfill.js            legacy browser polyfills
style/
  main.css                 all styles (plain CSS, no build step)
  fonts/                   Clear Sans web fonts
```

## Editing styles

`style/main.css` is plain CSS; edit it directly. The board scales with the screen: everything is derived from `--board` (board side, sized to the space left between the score cards and the buttons), `--gap` and `--cell` on `.game-container`. Tile colors are the `--t` / `--fg` / `--glow` variables on each `.tile-N` rule, and `tile-len-N` classes (added by `html_actuator.js`) pick the font size by digit count.

## Notes

- Saved games live in `localStorage` under `gameState` (with its `keepPlaying` field) and `bestScore`. Those keys are kept stable so existing saves keep working. A corrupted save is ignored and a new game starts. The mute setting is stored under `soundMuted`.
- Sound effects use no audio files: `js/sound_manager.js` synthesizes them with the Web Audio API. Each merge plays a marimba note whose pitch climbs a pentatonic scale with the tile value, panned to the tile's column. Browsers without Web Audio simply stay silent.

## License

MIT. See [LICENSE.txt](LICENSE.txt).
