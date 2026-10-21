// Probability that a newly spawned tile is a 4 (otherwise it is a 2)
GameManager.NEW_TILE_FOUR_PROBABILITY = 0.1;

// Number of smallest tiles removed by the "Clear tiles" button
GameManager.CLEAR_COUNT = 3;

// Number of smallest tiles removed when reviving from game over
GameManager.REVIVE_CLEAR_COUNT = 6;

// Max "Clear tiles" uses per game; null means unlimited
GameManager.CLEAR_LIMIT = null;

// Tile movement vectors, indexed by direction: 0 up, 1 right, 2 down, 3 left
GameManager.VECTORS = [
  { x: 0,  y: -1 }, // Up
  { x: 1,  y: 0 },  // Right
  { x: 0,  y: 1 },  // Down
  { x: -1, y: 0 }   // Left
];

function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size           = size; // Size of the grid
  this.inputManager   = new InputManager();
  this.storageManager = new StorageManager();
  this.actuator       = new Actuator();

  this.startTiles     = 2;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));
  this.inputManager.on("clearTiles", this.clearTiles.bind(this));
  this.inputManager.on("revive", this.revive.bind(this));

  this.setup();
}

// Restart the game
GameManager.prototype.restart = function () {
  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.setup();
};

// Keep playing after winning (allows going over the win tile)
GameManager.prototype.keepPlaying = function () {
  this.keepPlayingMode = true;
  this.actuator.continueGame(); // Clear the game won/lost message
};

// Return true if the game is lost, or has won and the user hasn't kept playing
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlayingMode);
};

// Removes the `count` smallest tiles, always leaving at least one tile
// on the board (an empty board has no moves and would soft-lock the game)
GameManager.prototype.removeSmallestTiles = function (count) {
  var removable = Math.min(count, this.grid.allTiles().length - 1);
  if (removable <= 0) return;

  // Reset previous positions so the remaining tiles don't replay old slides
  this.prepareTiles();

  this.grid.smallestTiles(removable).forEach(function (tile) {
    this.grid.removeTile(tile);
  }, this);
};

// Whether the "Clear tiles" button can be used right now
GameManager.prototype.canClear = function () {
  var limit = GameManager.CLEAR_LIMIT;

  if (this.isGameTerminated()) return false;
  if (limit !== null && this.clearsUsed >= limit) return false;

  return this.grid.allTiles().length > 1;
};

// "Clear tiles": remove the smallest tiles and keep playing
// (no new tile is spawned, since this isn't a move)
GameManager.prototype.clearTiles = function () {
  if (!this.canClear()) return;

  this.clearsUsed++;
  this.removeSmallestTiles(GameManager.CLEAR_COUNT);
  this.actuate();
};

// "Revive": on game over, remove the smallest tiles and keep playing
// with the current score
GameManager.prototype.revive = function () {
  if (!this.over) return;

  this.removeSmallestTiles(GameManager.REVIVE_CLEAR_COUNT);
  this.over = false;
  this.actuator.continueGame(); // Clear the game over message
  this.actuate();
};

// Set up the game
GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  // Reload the game from a previous game if present
  if (previousState) {
    this.grid        = new Grid(previousState.grid.size,
                                previousState.grid.cells); // Reload grid
    this.score       = previousState.score;
    this.over        = previousState.over;
    this.won         = previousState.won;
    // The saved key stays "keepPlaying" so existing saves keep working
    this.keepPlayingMode = previousState.keepPlaying;
    // Saves from before "Clear tiles" existed have no clearsUsed
    this.clearsUsed  = previousState.clearsUsed || 0;
  } else {
    this.grid        = new Grid(this.size);
    this.score       = 0;
    this.over        = false;
    this.won         = false;
    this.keepPlayingMode = false;
    this.clearsUsed  = 0;

    // Add the initial tiles
    this.addStartTiles();
  }

  // Update the actuator
  this.actuate();
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

// Adds a tile in a random position
GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < GameManager.NEW_TILE_FOUR_PROBABILITY ? 4 : 2;
    var tile = new Tile(this.grid.randomAvailableCell(), value);

    this.grid.insertTile(tile);
  }
};

// Sends the updated grid to the actuator
GameManager.prototype.actuate = function () {
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
    terminated: this.isGameTerminated()
  });

};

// Represent the current game as an object
GameManager.prototype.serialize = function () {
  return {
    grid:        this.grid.serialize(),
    score:       this.score,
    over:        this.over,
    won:         this.won,
    keepPlaying: this.keepPlayingMode,
    clearsUsed:  this.clearsUsed
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

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  var cell, tile;

  var vector     = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved      = false;

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

          // The mighty win tile
          if (merged.value === Tile.WIN_VALUE) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
        }
      }
    });
  });

  if (moved) {
    this.addRandomTile();

    if (!this.movesAvailable()) {
      this.over = true; // Game over!
    }

    this.actuate();
  }
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

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};
