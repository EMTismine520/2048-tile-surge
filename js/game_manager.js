// Probability that a newly spawned tile is a 4 (otherwise it is a 2)
GameManager.NEW_TILE_FOUR_PROBABILITY = 0.1;

// Number of smallest tiles removed by the "Clear tiles" item
GameManager.CLEAR_COUNT = 3;

// Number of smallest tiles removed when reviving from game over
GameManager.REVIVE_CLEAR_COUNT = 6;

// Revives allowed per game (unlimited in boss mode)
GameManager.REVIVE_LIMIT = 1;

// Energy cap, and energy earned by each merge (before the combo multiplier)
GameManager.ENERGY_MAX       = 100;
GameManager.ENERGY_PER_MERGE = 1;

// Combo lengths that each add 1 to the energy multiplier:
// combo 1-2 earns x1, 3-5 earns x2, 6 and more earns x3
GameManager.COMBO_STEPS = [3, 6];

// Energy cost of each item (free in boss mode)
GameManager.ITEM_COSTS = { undo: 15, swap: 25, hammer: 30, clear: 40 };

// Merges from this value up shake the board and flash the background
GameManager.IMPACT_VALUE = 256;

// FNV-1a hash of the boss mode key (trimmed, lower case); see hashKey()
GameManager.BOSS_KEY_HASH = 2480231467;

// Tile movement vectors, indexed by direction: 0 up, 1 right, 2 down, 3 left
GameManager.VECTORS = [
  { x: 0,  y: -1 }, // Up
  { x: 1,  y: 0 },  // Right
  { x: 0,  y: 1 },  // Down
  { x: -1, y: 0 }   // Left
];

// Tiles from this value up get a fanfare the first time they appear
GameManager.MILESTONE_VALUE = 128;

function GameManager(size, InputManager, Actuator, StorageManager,
                     SoundManager) {
  this.size           = size; // Size of the grid
  this.inputManager   = new InputManager();
  this.storageManager = new StorageManager();
  this.actuator       = new Actuator();
  this.soundManager   = new SoundManager(size);

  this.startTiles     = 2;

  this.dialog    = null; // Name of the open dialog ("boss", "confirm")
  this.targeting = null; // Item waiting for a tile pick: { item, first }
  this.bossMode  = this.storageManager.getBossMode();

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("requestRestart", this.requestRestart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));
  this.inputManager.on("useItem", this.useItem.bind(this));
  this.inputManager.on("boardTap", this.selectCell.bind(this));
  this.inputManager.on("cancel", this.cancel.bind(this));
  this.inputManager.on("revive", this.revive.bind(this));
  this.inputManager.on("toggleSound", this.toggleSound.bind(this));
  this.inputManager.on("openBoss", this.openBoss.bind(this));
  this.inputManager.on("submitBossKey", this.submitBossKey.bind(this));
  this.inputManager.on("disableBoss", this.disableBoss.bind(this));

  // Restore the saved mute setting (silently)
  var muted = this.storageManager.getSoundMuted();
  this.soundManager.setMuted(muted, false);
  this.actuator.updateSoundButton(muted);

  this.setup();
}

// Restart the game
GameManager.prototype.restart = function () {
  this.closeDialog();
  this.targeting = null;
  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.setup();
  this.soundManager.restart(this.grid.allTiles());
};

// Restart button / R key: ask first when there is progress to lose
GameManager.prototype.requestRestart = function () {
  if (this.dialog) return;

  if (this.score > 0 && !this.over) {
    this.openDialog("confirm");
  } else {
    this.restart();
  }
};

// Keep playing after winning (allows going over the win tile)
GameManager.prototype.keepPlaying = function () {
  this.keepPlayingMode = true;
  this.actuator.continueGame(); // Clear the game won/lost message
  this.soundManager.keepPlaying();
  this.refreshControls();
};

// Mute/unmute sound effects and remember the choice
GameManager.prototype.toggleSound = function () {
  var muted = !this.soundManager.muted;

  this.storageManager.setSoundMuted(muted);
  this.soundManager.setMuted(muted, true);
  this.actuator.updateSoundButton(muted);
};

// Return true if the game is lost, or has won and the user hasn't kept playing
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlayingMode);
};

// ---------------------------------------------------------------------------
// Dialogs

// Opens a dialog ("boss" or "confirm"); an armed item is put away first
GameManager.prototype.openDialog = function (name) {
  this.targeting = null;
  this.dialog    = name;
  this.actuator.openDialog(name);
  this.refreshControls();
};

// Closes the open dialog, if any
GameManager.prototype.closeDialog = function () {
  if (!this.dialog) return;

  this.dialog = null;
  this.actuator.closeDialog();
};

// Esc / cancel buttons: close the dialog, or else put the armed item away
GameManager.prototype.cancel = function () {
  if (this.dialog) {
    this.closeDialog();
  } else {
    this.cancelTargeting(true);
  }
};

// ---------------------------------------------------------------------------
// Energy and items

// Combo after a move, and the energy its merges earn (no merge breaks it)
GameManager.prototype.chargeEnergy = function (mergeCount) {
  if (!mergeCount) {
    this.combo = 0;
    return;
  }

  this.combo++;

  var gain = mergeCount * GameManager.ENERGY_PER_MERGE *
             this.comboMultiplier(this.combo);
  this.energy = Math.min(GameManager.ENERGY_MAX, this.energy + gain);
};

// Energy multiplier of a combo length: 1 plus one per COMBO_STEPS reached
GameManager.prototype.comboMultiplier = function (combo) {
  return GameManager.COMBO_STEPS.reduce(function (multiplier, step) {
    return combo >= step ? multiplier + 1 : multiplier;
  }, 1);
};

// Whether the current energy pays for the item (always true in boss mode)
GameManager.prototype.canAfford = function (item) {
  return this.bossMode || this.energy >= GameManager.ITEM_COSTS[item];
};

// Pays for an item that took effect (nothing in boss mode)
GameManager.prototype.spend = function (item) {
  if (!this.bossMode) this.energy -= GameManager.ITEM_COSTS[item];
};

// Whether the item can be used right now
GameManager.prototype.canUse = function (item) {
  // Undo also works on the game-over screen; it pays from the energy the
  // game had before the undone move, so it can't be used to farm energy
  if (item === "undo") {
    if (!this.undoState || (this.isGameTerminated() && !this.over)) {
      return false;
    }
    return this.bossMode ||
           this.undoState.energy >= GameManager.ITEM_COSTS.undo;
  }

  if (this.isGameTerminated()) return false;

  // Removing or swapping needs at least two tiles (one always stays)
  return this.grid.allTiles().length > 1 && this.canAfford(item);
};

// Item button / key: undo and clear act at once, swap and hammer wait for
// a tile pick on the board
GameManager.prototype.useItem = function (item) {
  if (this.dialog) return;

  // Pressing the armed item again puts it away
  if (this.targeting && this.targeting.item === item) {
    this.cancelTargeting(true);
    return;
  }

  if (!this.canUse(item)) {
    this.soundManager.blocked();
    return;
  }

  this.targeting = null;

  if (item === "undo") {
    this.undo();
  } else if (item === "clear") {
    this.clearTiles();
  } else {
    this.targeting = { item: item, first: null };
    this.soundManager.arm(true);
    this.refreshControls();
  }
};

// Puts the armed item away (no energy is spent); sound plays the cue
GameManager.prototype.cancelTargeting = function (sound) {
  if (!this.targeting) return;

  this.targeting = null;
  if (sound) this.soundManager.arm(false);
  this.refreshControls();
};

// Items and revives break the combo and drop the undo snapshot
// (undo only ever reverts the last move)
GameManager.prototype.resetChain = function () {
  this.combo     = 0;
  this.undoState = null;
};

// Undo: back to the state before the last move, paying from that state's
// energy
GameManager.prototype.undo = function () {
  var state = this.undoState;
  var cost  = this.bossMode ? 0 : GameManager.ITEM_COSTS.undo;

  this.loadState(state);
  this.energy    = state.energy - cost;
  this.resetChain();

  this.actuator.continueGame(); // Undo can leave the game-over screen
  this.soundManager.undo();
  this.actuate({ rewind: true });
};

// "Clear tiles": remove the smallest tiles and keep playing
// (no new tile is spawned, since this isn't a move)
GameManager.prototype.clearTiles = function () {
  this.spend("clear");
  var removed = this.removeSmallestTiles(GameManager.CLEAR_COUNT);
  this.resetChain();

  this.soundManager.clear(removed);
  this.actuate({ removed: removed });
};

// A tap on the board while swap or hammer is armed
GameManager.prototype.selectCell = function (cell) {
  var targeting = this.targeting;
  if (!targeting || this.dialog || !cell) return;

  var tile = this.grid.cellContent(cell);
  if (!tile) {
    this.soundManager.blocked(); // Empty cell: nothing to pick
    return;
  }

  if (targeting.item === "hammer") {
    this.smashTile(tile);
    return;
  }

  // Swap: the first pick is remembered, the second one swaps
  var first = targeting.first && this.grid.cellContent(targeting.first);

  if (!first) {
    targeting.first = { x: tile.x, y: tile.y };
    this.soundManager.pick(tile);
    this.refreshControls();
  } else if (first === tile) {
    targeting.first = null; // Picking the same tile again unselects it
    this.soundManager.arm(false);
    this.refreshControls();
  } else if (first.value === tile.value) {
    this.soundManager.blocked(); // Swapping equal tiles changes nothing
  } else {
    this.swapTiles(first, tile);
  }
};

// Hammer: smash one tile (no new tile is spawned)
GameManager.prototype.smashTile = function (tile) {
  // Reset previous positions so the other tiles don't replay old slides
  this.prepareTiles();
  this.grid.removeTile(tile);

  this.spend("hammer");
  this.targeting = null;
  this.resetChain();

  this.soundManager.smash(tile);
  this.actuate({ smashed: [tile] });
};

// Swap: exchange two tiles (no new tile is spawned)
GameManager.prototype.swapTiles = function (a, b) {
  var cellA = { x: a.x, y: a.y };
  var cellB = { x: b.x, y: b.y };

  // Step 1: remember where both tiles were so they slide across
  this.prepareTiles();

  // Step 2: put each tile in the other's cell
  a.updatePosition(cellB);
  b.updatePosition(cellA);
  this.grid.insertTile(a);
  this.grid.insertTile(b);

  this.spend("swap");
  this.targeting = null;
  this.resetChain();

  // Step 3: a swap on a full board can break the last possible merge
  if (!this.movesAvailable()) this.over = true;

  this.soundManager.swap(a, b, this.over);
  this.actuate({ slow: true });
};

// Revives left in this game (Infinity in boss mode)
GameManager.prototype.revivesLeft = function () {
  if (this.bossMode) return Infinity;
  return Math.max(0, GameManager.REVIVE_LIMIT - this.revivesUsed);
};

// Removes the `count` smallest tiles, always leaving at least one tile
// on the board (an empty board has no moves and would soft-lock the game).
// Returns the removed tiles.
GameManager.prototype.removeSmallestTiles = function (count) {
  var removable = Math.min(count, this.grid.allTiles().length - 1);
  if (removable <= 0) return [];

  // Reset previous positions so the remaining tiles don't replay old slides
  this.prepareTiles();

  var removed = this.grid.smallestTiles(removable);
  removed.forEach(function (tile) {
    this.grid.removeTile(tile);
  }, this);

  return removed;
};

// "Revive": on game over, remove the smallest tiles and keep playing
// with the current score; limited per game outside boss mode
GameManager.prototype.revive = function () {
  if (!this.over) return;

  if (this.revivesLeft() === 0) {
    this.soundManager.blocked();
    return;
  }

  if (!this.bossMode) this.revivesUsed++;

  var removed = this.removeSmallestTiles(GameManager.REVIVE_CLEAR_COUNT);
  this.over = false;
  this.resetChain();

  this.actuator.continueGame(); // Clear the game over message
  this.soundManager.revive();
  this.actuate({ removed: removed });
};

// ---------------------------------------------------------------------------
// Boss mode

// Key button: opens the boss dialog (key entry, or the switch-off screen)
GameManager.prototype.openBoss = function () {
  if (this.dialog) return;
  this.openDialog("boss");
};

// Checks the typed key; the right one turns boss mode on
GameManager.prototype.submitBossKey = function (text) {
  if (this.dialog !== "boss") return;

  if (this.hashKey(text) !== GameManager.BOSS_KEY_HASH) {
    this.actuator.rejectBossKey();
    this.soundManager.blocked();
    return;
  }

  this.closeDialog();
  this.setBossMode(true);
};

// "Turn off boss mode" in the boss dialog
GameManager.prototype.disableBoss = function () {
  if (this.dialog !== "boss") return;

  this.closeDialog();
  this.setBossMode(false);
};

// Switches boss mode and remembers it across reloads and new games
GameManager.prototype.setBossMode = function (on) {
  this.bossMode = on;
  this.storageManager.setBossMode(on);
  this.soundManager.bossMode(on);
  this.refreshControls();
};

// 32-bit FNV-1a hash of the trimmed, lower-cased text. Only the hash is
// kept in the source so the key isn't readable at a glance (a client-side
// game can't truly keep it secret). The multiply by the FNV prime
// (2^24 + 403) is spelled out as shifts, since Math.imul isn't everywhere.
GameManager.prototype.hashKey = function (text) {
  var hash = 0x811c9dc5;

  text = String(text).replace(/^\s+|\s+$/g, "").toLowerCase();

  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) +
            (hash << 24)) >>> 0;
  }

  return hash;
};

// ---------------------------------------------------------------------------
// State

// Set up the game
GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  // Reload the game from a previous game if present
  if (previousState) {
    this.loadState(previousState);
  } else {
    this.grid            = new Grid(this.size);
    this.score           = 0;
    this.over            = false;
    this.won             = false;
    this.keepPlayingMode = false;
    this.energy          = 0;
    this.combo           = 0;
    this.revivesUsed     = 0;
    this.undoState       = null;

    // Add the initial tiles
    this.addStartTiles();
  }

  // A resumed game that already holds the best score has had its
  // "new best" moment; a fresh game gets one when it passes the record
  this.bestAnnounced = this.score > 0 &&
                       this.score >= this.storageManager.getBestScore();

  // Update the actuator
  this.actuate();
};

// Loads a saved state (a save, or the undo snapshot)
GameManager.prototype.loadState = function (state) {
  this.grid            = new Grid(state.grid.size, state.grid.cells);
  this.score           = state.score;
  this.over            = state.over;
  this.won             = state.won;
  // The saved key stays "keepPlaying" so existing saves keep working
  this.keepPlayingMode = state.keepPlaying;
  // Saves from before the energy system lack these fields
  this.energy          = state.energy || 0;
  this.combo           = state.combo || 0;
  this.revivesUsed     = state.revivesUsed || 0;
  this.undoState       = state.undoState || null;
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

// Adds a tile in a random position; returns it (null if the board is full)
GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < GameManager.NEW_TILE_FOUR_PROBABILITY ? 4 : 2;
    var tile = new Tile(this.grid.randomAvailableCell(), value);

    this.grid.insertTile(tile);
    return tile;
  }

  return null;
};

// Saves the game and sends the updated grid to the actuator.
// effects (optional) asks for one-off animations:
// { removed, smashed, slow, rewind, impact, direction }
GameManager.prototype.actuate = function (effects) {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  // Clear the state when the game is over (game over only, not win)
  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  this.actuator.actuate(this.grid, {
    score:      this.score,
    over:       this.over,
    won:        this.won,
    bestScore:  this.storageManager.getBestScore(),
    terminated: this.isGameTerminated(),
    maxTile:    this.maxTileValue(),
    effects:    effects || {}
  });

  this.refreshControls();
};

// Sends the energy bar, combo, items and boss state to the actuator
// (without redrawing the tiles)
GameManager.prototype.refreshControls = function () {
  var self      = this;
  var usable    = {};
  var targeting = this.targeting;

  Object.keys(GameManager.ITEM_COSTS).forEach(function (item) {
    usable[item] = self.canUse(item);
  });

  this.actuator.updateControls({
    energy:      this.energy,
    energyMax:   GameManager.ENERGY_MAX,
    combo:       this.combo,
    multiplier:  this.comboMultiplier(this.combo),
    bossMode:    this.bossMode,
    costs:       GameManager.ITEM_COSTS,
    usable:      usable,
    targeting:   targeting ? targeting.item : null,
    selection:   targeting ? targeting.first : null,
    revivesLeft: this.revivesLeft()
  });
};

// Represent the current game as an object (what gets saved)
GameManager.prototype.serialize = function () {
  var state = this.snapshot();
  state.undoState = this.undoState;
  return state;
};

// The game state without the undo snapshot (what undo restores)
GameManager.prototype.snapshot = function () {
  return {
    grid:        this.grid.serialize(),
    score:       this.score,
    over:        this.over,
    won:         this.won,
    keepPlaying: this.keepPlayingMode,
    energy:      this.energy,
    combo:       this.combo,
    revivesUsed: this.revivesUsed
  };
};

// Save all tile positions and remove merger info
GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

// Move a tile and its representation
GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.moveTile(tile, cell);
};

// Move tiles on the grid in the specified direction
GameManager.prototype.move = function (direction) {
  // 0: up, 1: right, 2: down, 3: left
  var self = this;

  if (this.dialog) return;

  // A move puts an armed item away
  var wasTargeting = !!this.targeting;
  this.targeting = null;

  if (this.isGameTerminated()) { // Don't do anything if the game's over
    if (wasTargeting) this.refreshControls();
    return;
  }

  var cell, tile;

  var vector     = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved      = false;
  var movedCount = 0;
  var merges     = [];

  // Board state before the move, to detect what this move achieved
  var snapshot     = this.snapshot();
  var maxBefore    = this.maxTileValue();
  var bestBefore   = this.storageManager.getBestScore();
  var wonBefore    = this.won;
  var energyBefore = this.energy;

  // Save the current tile positions and remove merger information
  this.prepareTiles();

  // Traverse the grid in the right direction and move tiles
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next      = self.grid.cellContent(positions.next);

        // Only one merger per row traversal?
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);

          // Converge the two tiles' positions
          tile.updatePosition(positions.next);

          // Update the score
          self.score += merged.value;

          // Remember the merge for the sound effects
          merges.push({ value: merged.value, x: merged.x, y: merged.y });

          // The mighty win tile
          if (merged.value === Tile.WIN_VALUE) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
          movedCount++;
        }
      }
    });
  });

  if (moved) {
    // Step 1: this move becomes the one undo reverts
    this.undoState = snapshot;

    // Step 2: combo and energy
    this.chargeEnergy(merges.length);
    var charged = !this.bossMode && energyBefore < GameManager.ENERGY_MAX &&
                  this.energy >= GameManager.ENERGY_MAX;

    // Step 3: the new tile, and whether any move is left
    var spawned = this.addRandomTile();

    if (!this.movesAvailable()) {
      this.over = true; // Game over!
    }

    this.soundManager.move({
      direction:  direction,
      movedCount: movedCount,
      merges:     merges,
      spawned:    spawned,
      milestone:  this.milestoneReached(merges, maxBefore),
      newBest:    this.claimNewBest(bestBefore),
      won:        this.won && !wonBefore,
      over:       this.over,
      comboLevel: this.comboMultiplier(this.combo) - 1,
      charged:    charged
    });

    this.actuate({
      impact:    this.biggestMerge(merges) >= GameManager.IMPACT_VALUE,
      direction: direction
    });
  } else {
    this.soundManager.blocked(); // Nothing could move that way
    if (wasTargeting) this.refreshControls();
  }
};

// Largest tile value on the board (0 when empty)
GameManager.prototype.maxTileValue = function () {
  return this.grid.allTiles().reduce(function (max, tile) {
    return Math.max(max, tile.value);
  }, 0);
};

// Largest tile value created by these merges (0 when there are none)
GameManager.prototype.biggestMerge = function (merges) {
  return merges.reduce(function (max, merge) {
    return Math.max(max, merge.value);
  }, 0);
};

// Value of a new largest tile created by these merges that deserves a
// fanfare (at least MILESTONE_VALUE, and not the win tile, which has its
// own sound); 0 when there is none
GameManager.prototype.milestoneReached = function (merges, maxBefore) {
  var best = this.biggestMerge(merges);

  if (best <= maxBefore || best < GameManager.MILESTONE_VALUE ||
      best === Tile.WIN_VALUE) {
    return 0;
  }

  return best;
};

// True the first time this game's score passes an existing best score
GameManager.prototype.claimNewBest = function (bestBefore) {
  if (this.bestAnnounced || bestBefore <= 0 || this.score <= bestBefore) {
    return false;
  }

  this.bestAnnounced = true;
  return true;
};

// Get the vector representing the chosen direction
GameManager.prototype.getVector = function (direction) {
  return GameManager.VECTORS[direction];
};

// Build a list of positions to traverse in the right order
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  // Always traverse from the farthest cell in the chosen direction
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

// Farthest free cell in the vector's direction, plus the cell right after
// it (the obstacle that might merge)
GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  // Progress towards the vector direction until an obstacle is found
  do {
    previous = cell;
    cell     = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) &&
           this.grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // Used to check if a merge is required
  };
};

// Whether any move is possible (a free cell or two equal neighbours)
GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

// Check for available matches between tiles (more expensive check)
GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;

  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });

      if (tile) {
        for (var direction = 0; direction < GameManager.VECTORS.length;
             direction++) {
          var vector = self.getVector(direction);
          var cell   = { x: x + vector.x, y: y + vector.y };

          var other  = self.grid.cellContent(cell);

          if (other && other.value === tile.value) {
            return true; // These two tiles can be merged
          }
        }
      }
    }
  }

  return false;
};

// Whether two positions are the same cell
GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};
