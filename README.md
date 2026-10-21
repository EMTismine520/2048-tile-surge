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
- New game: the restart button in the top bar or the `R` key. If the current game has a score, it asks for confirmation first.
- Sound: the speaker button in the top bar, or the `M` key, mutes and unmutes the sound effects. The setting is remembered.
- `Esc` closes a dialog or cancels the selected item.

## Combo, energy and items

- **Combo**: each move that merges at least one pair raises the combo by 1. A move without a merge, an item, or a revive resets it. The combo counter appears in the energy bar from 2 in a row, and the board edge glows in the combo's color.
- **Energy**: each merge earns 1 energy, times the combo multiplier (combo 1–2: x1, 3–5: x2, 6+: x3), up to 100. Combos only affect energy, not the score, so scores stay comparable with classic 2048.
- **Items** (the bar under the board; the badge shows the energy cost; greyed out when not affordable):
  - 撤销 Undo (15, or the `U` key): reverts the last move (board, score, energy). Only one step back. It pays from the energy you had *before* that move, so moving and undoing can't farm energy. It also works on the game-over screen.
  - 交换 Swap (25): tap two tiles to swap them. Tap the first tile again to unselect it.
  - 锤子 Hammer (30): tap a tile to smash it.
  - 清除 Clear (40): removes the 3 smallest tiles.
  - Swap and hammer wait for a tap on the board. Tap the item again (now labelled 取消), press `Esc`, or swipe to cancel; nothing is spent until the item takes effect. Items never spawn a new tile and always leave at least one tile on the board.
- **Revive** (复活, game-over screen): removes the 6 smallest tiles and continues with your current score. Once per game.

## Background

Low tiles are candy-colored two-tone gradients whose hues jump from one value to the next, so each value reads at a glance: 2 mint→cyan, 4 sky→indigo, 8 orchid→magenta, 16 coral→rose, 32 orange→tangerine, 64 lemon→amber, 128 lime→emerald. From 256 up tiles warm up and glow harder (coral, rose, violet flame), and 2048 is gold. Tiles from 512 up carry decorations: twinkling stars (512+), a spinning flame border (1024), a crown and a periodic sheen (2048). Tiles above 2048 are obsidian with gold digits and a spinning rainbow border. New and merged tiles land with a jelly squash-and-bounce, and tiles that slide squash briefly against the side they moved to.

The aurora behind the game follows the largest tile on the board: cyan/magenta/indigo (up to 32), amber/emerald (64–128), coral/rose (256–512), violet/rose (1024), gold (2048+). The board itself is alive in the same colors: an aurora gradient turns slowly beneath it and shows through the gaps (brighter during a combo), empty cells breathe in a diagonal wave, each move sweeps a light wave across the board in its direction, and each merge sends a ripple of the tile's color outwards. Merges of 256 or more shake the board and flash both the aurora and the board. When only 2 empty cells are left, the board rim pulses coral; on game over the board fades to grey, and on a win its edge turns gold.

## Boss mode

The key button in the top bar opens the boss mode dialog. Entering the right key turns boss mode on: all items, clear and revive are free and unlimited, the energy bar shows ∞ and the title badge reads BOSS. Boss mode stays on across reloads and new games until it is switched off in the same dialog. Scores count toward the normal best score.

The key is checked case-insensitively, with surrounding spaces ignored. Only its 32-bit FNV-1a hash is kept in the source (`GameManager.BOSS_KEY_HASH`). To change the key, compute the hash in the browser console and paste it there:

```js
GameManager.prototype.hashKey("new key")
```

This only keeps the key from being read at a glance: it is a client-side game, so anyone can also set `localStorage.bossMode` to `"true"`.

## Tuning

All numbers are constants at the top of `js/game_manager.js`: `ENERGY_MAX`, `ENERGY_PER_MERGE`, `COMBO_STEPS`, `ITEM_COSTS`, `CLEAR_COUNT`, `REVIVE_CLEAR_COUNT`, `REVIVE_LIMIT`, `IMPACT_VALUE`.

## Project structure

```
index.html                 entry point; script load order is the dependency order
js/
  application.js           bootstrap, wires the managers into GameManager
  game_manager.js          game state, move/merge rules, win/lose detection,
                           combo/energy, items, revive limit, boss mode
  grid.js, tile.js         board and tile data models
  html_actuator.js         renders the grid, score, energy bar, items, dialogs
                           and background tier to the DOM
  keyboard_input_manager.js  keyboard, touch, board taps and button input,
                           emits events
  local_storage_manager.js best score, game-state, mute and boss-mode persistence
  sound_manager.js         sound effects, synthesized live with Web Audio
  *_polyfill.js            legacy browser polyfills
style/
  main.css                 all styles (plain CSS, no build step)
  fonts/                   Clear Sans web fonts
```

## Editing styles

`style/main.css` is plain CSS; edit it directly. The board scales with the screen: everything is derived from `--board-raw` (the space left between the energy bar and the item bar), from which `--gap` and `--cell` are rounded to whole pixels (where `round()` is supported) and `--board` is rebuilt, so tile edges stay crisp. The board clips tile glows at its edge (`overflow: hidden`); its glass rim is `.game-container::after` (which also carries the coral `is-tight` pulse), and `.game-container::before` is the turning aurora layer. Board states are classes on `.game-container` set by `html_actuator.js`: `data-dir` (last move, 0 up 1 right 2 down 3 left; drives the light wave in `.board-fx` and the tiles' landing squash on `.tile-slid`), `data-combo`, `is-impact`, `is-tight` (≤ `HTMLActuator.TIGHT_CELLS` empty cells), `is-over`, `is-won`. Empty cells get `--r` / `--c` (row and column, 1–4) to stagger their breathing and entrance. On tall screens `--spare` (on `.app`) spreads the extra height over the gaps, the energy bar and the item bar instead of leaving it empty around the board. Tile colors are the `--t2` → `--t` (light top-left → deep bottom-right gradient) / `--fg` / `--fg-shadow` / `--glow` variables on each `.tile-N` rule; `--edge` (the darker bottom edge), the merge ring and the `.merge-ripple` (drawn under a merged tile, carrying its `tile-N` class) are derived from `--t`, and `--loop` holds a high tile's endless animation so it stacks with the appear/merge/squash animations. `tile-len-N` classes (added by `html_actuator.js`) pick the font size by digit count. The number sits in `.tile-value` inside `.tile-inner`, which leaves pseudo-elements free for the decorations: `.tile-value::before/::after` (stars, crown) and `.tile-inner::before` (sheen); `.tile-inner::after` is the merge ring. Aurora colors are `--aurora-1/2/3`, set per `[data-tier]`.

## Notes

- Saved games live in `localStorage` under `gameState` (with its `keepPlaying` field) and `bestScore`. Those keys are kept stable so existing saves keep working. A corrupted save is ignored and a new game starts. The mute setting is stored under `soundMuted`, and boss mode under `bossMode`.
- `gameState` also holds `energy`, `combo`, `revivesUsed` and `undoState` (the state before the last move, used by undo). Saves from older versions lack them and load with 0 energy and no undo.
- Sound effects use no audio files: `js/sound_manager.js` synthesizes them with the Web Audio API. Each merge plays a marimba note whose pitch climbs a pentatonic scale with the tile value, panned to the tile's column. Browsers without Web Audio simply stay silent.

## License

MIT. See [LICENSE.txt](LICENSE.txt).
