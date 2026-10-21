function Grid(size, previousState) {
  this.size = size;
  this.cells = previousState ? this.fromState(previousState) : this.empty();
}

// Build a size x size 2D array, filling each slot with fn(x, y)
Grid.prototype.buildCells = function (fn) {
  var cells = [];

  for (var x = 0; x < this.size; x++) {
    var row = cells[x] = [];

    for (var y = 0; y < this.size; y++) {
      row.push(fn(x, y));
    }
  }

  return cells;
};

// Build a grid of the specified size
Grid.prototype.empty = function () {
  return this.buildCells(function () {
    return null;
  });
};

Grid.prototype.fromState = function (state) {
  return this.buildCells(function (x, y) {
    var tile = state[x][y];
    return tile ? new Tile(tile.position, tile.value) : null;
  });
};

// Find the first available random position
Grid.prototype.randomAvailableCell = function () {
  var cells = this.availableCells();

  if (cells.length) {
    return cells[Math.floor(Math.random() * cells.length)];
  }
};

Grid.prototype.availableCells = function () {
  var cells = [];

  this.eachCell(function (x, y, tile) {
    if (!tile) {
      cells.push({ x: x, y: y });
    }
  });

  return cells;
};

// Call callback for every cell
Grid.prototype.eachCell = function (callback) {
  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      callback(x, y, this.cells[x][y]);
    }
  }
};

// Check if there are any cells available
Grid.prototype.cellsAvailable = function () {
  return !!this.availableCells().length;
};

// Check if the specified cell is taken
Grid.prototype.cellAvailable = function (cell) {
  return !this.cellOccupied(cell);
};

Grid.prototype.cellOccupied = function (cell) {
  return !!this.cellContent(cell);
};

Grid.prototype.cellContent = function (cell) {
  if (this.withinBounds(cell)) {
    return this.cells[cell.x][cell.y];
  } else {
    return null;
  }
};

// Inserts a tile at its position
Grid.prototype.insertTile = function (tile) {
  this.cells[tile.x][tile.y] = tile;
};

Grid.prototype.removeTile = function (tile) {
  this.cells[tile.x][tile.y] = null;
};

// Moves a tile to the target cell and updates the tile's own position
Grid.prototype.moveTile = function (tile, cell) {
  this.removeTile(tile);
  tile.updatePosition(cell);
  this.insertTile(tile);
};

Grid.prototype.withinBounds = function (position) {
  return position.x >= 0 && position.x < this.size &&
         position.y >= 0 && position.y < this.size;
};

Grid.prototype.serialize = function () {
  var self = this;

  return {
    size: this.size,
    cells: this.buildCells(function (x, y) {
      return self.cells[x][y] ? self.cells[x][y].serialize() : null;
    })
  };
};
