// Background tiers: the aurora follows the largest tile on the board.
// Each entry is the smallest tile value that reaches the tier.
HTMLActuator.TIERS = [64, 256, 1024, 2048];

function HTMLActuator() {
  this.root             = document.documentElement;
  this.tileContainer    = document.querySelector(".tile-container");
  this.gameContainer    = document.querySelector(".game-container");
  this.scoreContainer   = document.querySelector(".score-container");
  this.bestContainer    = document.querySelector(".best-container");
  this.messageContainer = document.querySelector(".game-message");
  this.messageTitle     = document.querySelector(".message-title");
  this.finalScore       = document.querySelector(".final-score");
  this.reviveLeft       = document.querySelector(".revive-left");
  this.soundButton      = document.querySelector(".sound-button");
  this.bossButton       = document.querySelector(".boss-button");
  this.titleTag         = document.querySelector(".title-tag");
  this.energyHud        = document.querySelector(".energy-hud");
  this.energyFill       = document.querySelector(".energy-fill");
  this.energyValue      = document.querySelector(".energy-value");
  this.combo            = document.querySelector(".combo");
  this.comboCount       = document.querySelector(".combo-count");
  this.comboMultiplier  = document.querySelector(".combo-multiplier");
  this.itemButtons      = document.querySelectorAll(".item-button");
  this.cellMarker       = document.querySelector(".cell-marker");
  this.dialogs          = document.querySelectorAll(".dialog");
  this.bossDialog       = document.querySelector(".boss-dialog");
  this.bossInput        = document.querySelector(".boss-input");

  this.score     = 0;
  this.energy    = null; // Last energy shown, to animate changes
  this.comboShown = 0;
}

HTMLActuator.prototype.actuate = function (grid, metadata) {
  var self    = this;
  var effects = metadata.effects;

  window.requestAnimationFrame(function () {
    self.clearContainer(self.tileContainer);

    // Swapped tiles glide across more slowly than a normal slide
    self.toggleClass(self.tileContainer, "slow-slide", !!effects.slow);

    grid.cells.forEach(function (column) {
      column.forEach(function (cell) {
        if (cell) {
          self.addTile(cell, !!effects.rewind);
        }
      });
    });

    // Tiles taken off the board fade (clear, revive) or shatter (hammer)
    (effects.removed || []).forEach(function (tile) {
      self.addGhost(tile, "tile-vanish");
    });
    (effects.smashed || []).forEach(function (tile) {
      self.addGhost(tile, "tile-shatter");
    });

    if (effects.impact) {
      self.replayClass(self.gameContainer, "is-impact");
      self.replayClass(self.root, "is-flash");
    }

    self.updateScore(metadata.score);
    self.updateBestScore(metadata.bestScore, metadata.score);
    self.updateTier(metadata.maxTile);

    if (metadata.terminated) {
      if (metadata.over) {
        self.message(false); // You lose
      } else if (metadata.won) {
        self.message(true); // You win!
      }
    }

  });
};

// Continues the game (both restart and keep playing)
HTMLActuator.prototype.continueGame = function () {
  this.clearMessage();
};

// Removes every child of the element
HTMLActuator.prototype.clearContainer = function (container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
};

// Draws a tile; rewind marks tiles restored by undo (they fade back in
// instead of popping up as new tiles)
HTMLActuator.prototype.addTile = function (tile, rewind) {
  var self = this;

  var wrapper   = document.createElement("div");
  var position  = tile.previousPosition || { x: tile.x, y: tile.y };
  var positionClass = this.positionClass(position);

  // We can't use classlist because it somehow glitches when replacing classes
  var classes = this.tileClasses(tile, positionClass);

  if (tile.previousPosition) {
    // Make sure that the tile gets rendered in the previous position first
    window.requestAnimationFrame(function () {
      classes[2] = self.positionClass({ x: tile.x, y: tile.y });
      self.applyClasses(wrapper, classes); // Update the position
    });
  } else if (tile.mergedFrom) {
    classes.push("tile-merged");

    // Render the tiles that merged
    tile.mergedFrom.forEach(function (merged) {
      self.addTile(merged);
    });
  } else {
    classes.push(rewind ? "tile-rewind" : "tile-new");
  }

  this.applyClasses(wrapper, classes);
  wrapper.appendChild(this.tileInner(tile));

  // Put the tile on the board
  this.tileContainer.appendChild(wrapper);
};

// Draws a tile that has just left the board, playing its exit animation
HTMLActuator.prototype.addGhost = function (tile, effectClass) {
  var wrapper = document.createElement("div");
  var classes = this.tileClasses(tile,
                                 this.positionClass({ x: tile.x, y: tile.y }));

  classes.push(effectClass);
  this.applyClasses(wrapper, classes);
  wrapper.appendChild(this.tileInner(tile));
  this.tileContainer.appendChild(wrapper);
};

// Base classes of a tile: value color, position (always at index 2),
// digit count (picks the font size) and the rainbow style above 2048
HTMLActuator.prototype.tileClasses = function (tile, positionClass) {
  var classes = ["tile", "tile-" + tile.value, positionClass,
                 "tile-len-" + String(tile.value).length];

  if (tile.value > Tile.WIN_VALUE) classes.push("tile-super");

  return classes;
};

// The face of a tile showing its value. The number sits in its own span so
// the CSS has spare pseudo-elements for the high-tile decorations (sparkles,
// crown, sheen)
HTMLActuator.prototype.tileInner = function (tile) {
  var inner = document.createElement("div");
  var value = document.createElement("span");

  inner.classList.add("tile-inner");
  value.classList.add("tile-value");
  value.textContent = tile.value;
  inner.appendChild(value);

  return inner;
};

// Replaces all classes of the element
HTMLActuator.prototype.applyClasses = function (element, classes) {
  element.setAttribute("class", classes.join(" "));
};

// Adds or removes a class depending on on
HTMLActuator.prototype.toggleClass = function (element, name, on) {
  if (on) {
    element.classList.add(name);
  } else {
    element.classList.remove(name);
  }
};

// Restarts a one-off CSS animation that is triggered by a class
HTMLActuator.prototype.replayClass = function (element, name) {
  element.classList.remove(name);
  void element.offsetWidth; // Force a reflow so the animation starts over
  element.classList.add(name);
};

// Converts a 0-based grid position to the 1-based one used in class names
HTMLActuator.prototype.normalizePosition = function (position) {
  return { x: position.x + 1, y: position.y + 1 };
};

// Class that places an element on the given grid cell
HTMLActuator.prototype.positionClass = function (position) {
  position = this.normalizePosition(position);
  return "tile-position-" + position.x + "-" + position.y;
};

// Shows the score, with a floating "+N" when it went up
HTMLActuator.prototype.updateScore = function (score) {
  this.clearContainer(this.scoreContainer);

  var difference = score - this.score;
  this.score = score;

  this.scoreContainer.textContent = this.score;

  if (difference > 0) {
    var addition = document.createElement("div");
    addition.classList.add("score-addition");
    addition.textContent = "+" + difference;

    this.scoreContainer.appendChild(addition);
  }
};

// Shows the best score; highlights it while the current game holds the record
HTMLActuator.prototype.updateBestScore = function (bestScore, score) {
  this.bestContainer.textContent = bestScore;
  this.toggleClass(this.bestContainer, "is-record",
                   score > 0 && score >= bestScore);
};

// Tints the aurora after the largest tile (the CSS keys the colors off
// data-tier on <html>, 1 to 5)
HTMLActuator.prototype.updateTier = function (maxTile) {
  var tier = 1;

  HTMLActuator.TIERS.forEach(function (value) {
    if (maxTile >= value) tier++;
  });

  this.root.setAttribute("data-tier", tier);
};

// Shows the win / game-over overlay with this game's score
HTMLActuator.prototype.message = function (won) {
  var type    = won ? "game-won" : "game-over";
  var message = won ? "你赢了！" : "游戏结束";

  this.messageContainer.classList.add(type);
  this.messageTitle.textContent = message;
  this.finalScore.textContent   = "本局得分 " + this.score;
};

// Hides the win / game-over overlay
HTMLActuator.prototype.clearMessage = function () {
  // IE only takes one value to remove at a time.
  this.messageContainer.classList.remove("game-won");
  this.messageContainer.classList.remove("game-over");
};

// Shows whether sound is muted on the sound button
// (the CSS swaps the speaker icon based on the sound-muted class)
HTMLActuator.prototype.updateSoundButton = function (muted) {
  var button = this.soundButton;
  var label  = muted ? "取消静音" : "静音";

  this.toggleClass(button, "sound-muted", muted);

  button.setAttribute("aria-pressed", muted ? "true" : "false");
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label + " (M)");
};

// ---------------------------------------------------------------------------
// Energy, combo, items and boss mode

// Redraws everything that depends on energy, combo, items and boss mode.
// state: { energy, energyMax, combo, multiplier, bossMode, costs, usable,
//          targeting, selection, revivesLeft }
HTMLActuator.prototype.updateControls = function (state) {
  this.updateEnergy(state);
  this.updateCombo(state.combo, state.multiplier);
  this.updateItems(state);
  this.updateSelection(state.targeting, state.selection);
  this.updateBoss(state.bossMode);
  this.updateMessageButtons(state);
};

// Energy bar: fill, number, full glow; a highlight sweeps when it charges
HTMLActuator.prototype.updateEnergy = function (state) {
  var hud    = this.energyHud;
  var energy = state.energy;
  var ratio  = state.bossMode ? 1 : energy / state.energyMax;

  this.energyFill.style.width = (ratio * 100) + "%";
  this.energyValue.textContent = state.bossMode ? "∞" : energy;

  this.toggleClass(hud, "is-full",
                   !state.bossMode && energy >= state.energyMax);

  if (this.energy !== null && energy > this.energy) {
    this.replayClass(hud, "is-charging");
  }
  this.energy = energy;
};

// Combo counter: shown from 2 merging moves in a row; bounces on each step
// and takes the energy multiplier's color (data-level 1 to 3)
HTMLActuator.prototype.updateCombo = function (combo, multiplier) {
  var shown = combo >= 2;

  this.toggleClass(this.combo, "is-active", shown);
  this.combo.setAttribute("data-level", multiplier);
  this.gameContainer.setAttribute("data-combo", shown ? multiplier : 0);

  if (shown) {
    this.comboCount.textContent      = combo;
    this.comboMultiplier.textContent = multiplier > 1 ?
                                       "能量 ×" + multiplier : "";

    if (combo > this.comboShown) this.replayClass(this.combo, "is-bump");
  }

  this.comboShown = combo;
};

// Item buttons: cost (∞ in boss mode), usable state, and the armed item
// turning into a "cancel" button
HTMLActuator.prototype.updateItems = function (state) {
  var self = this;

  Array.prototype.forEach.call(this.itemButtons, function (button) {
    var item  = button.getAttribute("data-item");
    var armed = state.targeting === item;
    var name  = button.querySelector(".item-name");

    button.querySelector(".item-cost").textContent =
      state.bossMode ? "∞" : state.costs[item];
    name.textContent = armed ? "取消" : name.getAttribute("data-label");

    self.toggleClass(button, "is-armed", armed);
    self.toggleClass(button, "is-disabled", !armed && !state.usable[item]);
    button.setAttribute("aria-disabled",
                        !armed && !state.usable[item] ? "true" : "false");
  });
};

// Board pick mode (swap / hammer) and the marker on the first swap pick
HTMLActuator.prototype.updateSelection = function (targeting, selection) {
  var board = this.gameContainer;

  this.toggleClass(board, "is-targeting", !!targeting);
  board.setAttribute("data-item", targeting || "");

  if (selection) {
    this.applyClasses(this.cellMarker, ["cell-marker", "is-shown",
                                        this.positionClass(selection)]);
  } else {
    this.applyClasses(this.cellMarker, ["cell-marker"]);
  }
};

// Boss mode look: title badge, key button state, boss dialog contents
HTMLActuator.prototype.updateBoss = function (on) {
  this.titleTag.textContent = on ? "BOSS" : "2048";
  this.toggleClass(this.root, "is-boss", on);
  this.toggleClass(this.bossDialog, "is-on", on);
  this.bossButton.setAttribute("aria-pressed", on ? "true" : "false");
};

// Game-over buttons: revive (with the revives left) and undo
HTMLActuator.prototype.updateMessageButtons = function (state) {
  var left = state.revivesLeft;

  this.reviveLeft.textContent = left === Infinity ? "∞" : left;
  this.toggleClass(this.messageContainer, "can-revive", left > 0);
  this.toggleClass(this.messageContainer, "can-undo", state.usable.undo);
};

// ---------------------------------------------------------------------------
// Dialogs

// Shows the named dialog ("boss" or "confirm"); the key field is cleared
// and focused so the keyboard comes up right away
HTMLActuator.prototype.openDialog = function (name) {
  var dialog = document.querySelector("." + name + "-dialog");

  this.closeDialog();
  dialog.classList.add("is-open");

  if (name === "boss" && !dialog.classList.contains("is-on")) {
    this.bossInput.value = "";
    this.bossInput.focus();
  }
};

// Hides every dialog and drops the keyboard focus from the key field
HTMLActuator.prototype.closeDialog = function () {
  Array.prototype.forEach.call(this.dialogs, function (dialog) {
    dialog.classList.remove("is-open");
  });

  this.bossInput.blur();
};

// Wrong key: shake the field and select the text for retyping
HTMLActuator.prototype.rejectBossKey = function () {
  this.replayClass(this.bossInput, "is-wrong");
  this.bossInput.select();
};
