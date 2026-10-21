// Movement directions; the numbers are shared with GameManager.VECTORS
var DIRECTIONS = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };

var KEY_R     = 82;
var KEY_M     = 77;
var KEY_U     = 85;
var KEY_ENTER = 13;
var KEY_ESC   = 27;

// Minimum swipe distance (px) that counts as a move
var SWIPE_THRESHOLD = 10;

function KeyboardInputManager() {
  this.events = {};

  if (window.navigator.msPointerEnabled) {
    //Internet Explorer 10 style
    this.eventTouchstart    = "MSPointerDown";
    this.eventTouchmove     = "MSPointerMove";
    this.eventTouchend      = "MSPointerUp";
  } else {
    this.eventTouchstart    = "touchstart";
    this.eventTouchmove     = "touchmove";
    this.eventTouchend      = "touchend";
  }

  this.listen();
}

KeyboardInputManager.prototype.on = function (event, callback) {
  if (!this.events[event]) {
    this.events[event] = [];
  }
  this.events[event].push(callback);
};

KeyboardInputManager.prototype.emit = function (event, data) {
  var callbacks = this.events[event];
  if (callbacks) {
    callbacks.forEach(function (callback) {
      callback(data);
    });
  }
};

KeyboardInputManager.prototype.listen = function () {
  var self = this;

  var map = {
    38: DIRECTIONS.UP,    // Up
    39: DIRECTIONS.RIGHT, // Right
    40: DIRECTIONS.DOWN,  // Down
    37: DIRECTIONS.LEFT,  // Left
    75: DIRECTIONS.UP,    // Vim up
    76: DIRECTIONS.RIGHT, // Vim right
    74: DIRECTIONS.DOWN,  // Vim down
    72: DIRECTIONS.LEFT,  // Vim left
    87: DIRECTIONS.UP,    // W
    68: DIRECTIONS.RIGHT, // D
    83: DIRECTIONS.DOWN,  // S
    65: DIRECTIONS.LEFT   // A
  };

  // Respond to direction keys
  document.addEventListener("keydown", function (event) {
    var modifiers = event.altKey || event.ctrlKey || event.metaKey ||
                    event.shiftKey;
    var mapped    = map[event.which];

    // Esc closes a dialog or puts an armed item away
    if (event.which === KEY_ESC) {
      self.cancel(event);
      return;
    }

    // Typing in the boss key field: only Enter means something to the game
    if (self.isTextField(event.target)) {
      if (event.which === KEY_ENTER) self.submitBossKey(event);
      return;
    }

    if (!modifiers) {
      if (mapped !== undefined) {
        event.preventDefault();
        self.emit("move", mapped);
      }
    }

    // R key restarts the game (asking first when there is progress)
    if (!modifiers && event.which === KEY_R) {
      self.requestRestart(event);
    }

    // U key undoes the last move
    if (!modifiers && event.which === KEY_U) {
      event.preventDefault();
      self.emit("useItem", "undo");
    }

    // M key mutes/unmutes the sound effects
    if (!modifiers && event.which === KEY_M) {
      self.toggleSound(event);
    }
  });

  // Respond to button presses
  this.bindButtonPress(".retry-button", this.restart);
  this.bindButtonPress(".confirm-restart", this.restart);
  this.bindButtonPress(".restart-button", this.requestRestart);
  this.bindButtonPress(".keep-playing-button", this.keepPlaying);
  this.bindButtonPress(".item-button", this.useItem);
  this.bindButtonPress(".undo-over-button", this.useItem);
  this.bindButtonPress(".revive-button", this.revive);
  this.bindButtonPress(".sound-button", this.toggleSound);
  this.bindButtonPress(".boss-button", this.openBoss);
  this.bindButtonPress(".boss-submit", this.submitBossKey);
  this.bindButtonPress(".boss-off", this.disableBoss);
  this.bindButtonPress(".dialog-cancel", this.cancel);

  // A tap on a dialog's dimmed backdrop (outside its card) closes it.
  // Dialogs sit outside .app, so taps there produce normal clicks.
  Array.prototype.forEach.call(document.querySelectorAll(".dialog"),
    function (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) self.cancel(event);
      });
    });

  // Mouse clicks on the board pick tiles for swap / hammer (touch taps are
  // handled with the swipes below, since touch never produces a click here)
  var board = document.querySelector(".game-container");
  board.addEventListener("click", function (event) {
    self.emit("boardTap", self.cellAt(event.clientX, event.clientY));
  });

  // Respond to swipe events anywhere on the screen. Preventing the default
  // on touchstart keeps the page from scrolling and stops the browser from
  // synthesizing a click, so buttons fire once (from their touchend binding)
  var touchStartClientX, touchStartClientY;
  var swipeActive = false;
  var onBoard     = false;
  var swipeArea   = document.querySelector(".app");

  swipeArea.addEventListener(this.eventTouchstart, function (event) {
    event.preventDefault();

    if ((!window.navigator.msPointerEnabled && event.touches.length > 1) ||
        event.targetTouches.length > 1) {
      swipeActive = false;
      return; // Ignore if touching with more than 1 finger
    }

    // A press that starts on a button is a tap, never a swipe
    swipeActive = !self.isButtonTarget(event.target);
    if (!swipeActive) return;

    var start = self.getTouchPoint(event, false);
    touchStartClientX = start.x;
    touchStartClientY = start.y;
    onBoard           = board.contains(event.target);
  });

  swipeArea.addEventListener(this.eventTouchmove, function (event) {
    event.preventDefault();
  });

  swipeArea.addEventListener(this.eventTouchend, function (event) {
    if ((!window.navigator.msPointerEnabled && event.touches.length > 0) ||
        event.targetTouches.length > 0) {
      return; // Ignore if still touching with one or more fingers
    }

    if (!swipeActive) return;
    swipeActive = false;

    var end = self.getTouchPoint(event, true);

    var dx = end.x - touchStartClientX;
    var absDx = Math.abs(dx);

    var dy = end.y - touchStartClientY;
    var absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) > SWIPE_THRESHOLD) {
      // (right : left) : (down : up)
      self.emit("move", absDx > absDy ?
        (dx > 0 ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT) :
        (dy > 0 ? DIRECTIONS.DOWN : DIRECTIONS.UP));
    } else if (onBoard) {
      // A tap on the board picks a tile for swap / hammer
      self.emit("boardTap", self.cellAt(end.x, end.y));
    }
  });
};

// Grid cell {x, y} under a viewport point, or null outside the grid
KeyboardInputManager.prototype.cellAt = function (clientX, clientY) {
  var grid = document.querySelector(".grid-container");
  var size = grid.querySelectorAll(".grid-row").length;
  var rect = grid.getBoundingClientRect();

  var x = Math.floor((clientX - rect.left) / rect.width * size);
  var y = Math.floor((clientY - rect.top) / rect.height * size);

  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return { x: x, y: y };
};

// Whether the element takes typed text (keys typed there aren't game keys)
KeyboardInputManager.prototype.isTextField = function (element) {
  return !!element && (element.tagName === "INPUT" ||
                       element.tagName === "TEXTAREA");
};

// Whether the element is a button or sits inside one
KeyboardInputManager.prototype.isButtonTarget = function (element) {
  while (element && element !== document) {
    if (element.tagName === "BUTTON") return true;
    element = element.parentNode;
  }

  return false;
};

// Returns the {x, y} coordinates of a touch/pointer event;
// isEnd selects the lifted finger (touchend) over the pressed one (touchstart)
KeyboardInputManager.prototype.getTouchPoint = function (event, isEnd) {
  if (window.navigator.msPointerEnabled) {
    return { x: event.pageX, y: event.pageY };
  }

  var touch = isEnd ? event.changedTouches[0] : event.touches[0];
  return { x: touch.clientX, y: touch.clientY };
};

KeyboardInputManager.prototype.restart = function (event) {
  event.preventDefault();
  this.emit("restart");
};

// "New game" button / R key: restart, confirming first if needed
KeyboardInputManager.prototype.requestRestart = function (event) {
  event.preventDefault();
  this.emit("requestRestart");
};

KeyboardInputManager.prototype.keepPlaying = function (event) {
  event.preventDefault();
  this.emit("keepPlaying");
};

// Item buttons (and the undo button on the game-over screen): the item
// comes from the button's data-item attribute
KeyboardInputManager.prototype.useItem = function (event, button) {
  event.preventDefault();
  this.emit("useItem", button.getAttribute("data-item"));
};

// Esc, cancel buttons and dialog backdrops
KeyboardInputManager.prototype.cancel = function (event) {
  event.preventDefault();
  this.emit("cancel");
};

// Key button in the top bar: open the boss mode dialog
KeyboardInputManager.prototype.openBoss = function (event) {
  event.preventDefault();
  this.emit("openBoss");
};

// Confirm button / Enter in the key field: check the typed boss key
KeyboardInputManager.prototype.submitBossKey = function (event) {
  event.preventDefault();
  this.emit("submitBossKey", document.querySelector(".boss-input").value);
};

// "Turn off boss mode" button
KeyboardInputManager.prototype.disableBoss = function (event) {
  event.preventDefault();
  this.emit("disableBoss");
};

// "Revive" button on the game-over screen
KeyboardInputManager.prototype.revive = function (event) {
  event.preventDefault();
  this.emit("revive");
};

// Sound button / M key: mute or unmute the sound effects
KeyboardInputManager.prototype.toggleSound = function (event) {
  event.preventDefault();
  this.emit("toggleSound");
};

// Whether a touch/pointer release happened inside the button's bounds
KeyboardInputManager.prototype.isReleasedOn = function (event, button) {
  var point = window.navigator.msPointerEnabled ?
              event : event.changedTouches[0];
  var rect  = button.getBoundingClientRect();

  return point.clientX >= rect.left && point.clientX <= rect.right &&
         point.clientY >= rect.top  && point.clientY <= rect.bottom;
};

// Binds fn(event, button) to every button matching the selector
KeyboardInputManager.prototype.bindButtonPress = function (selector, fn) {
  var self    = this;
  var buttons = document.querySelectorAll(selector);

  Array.prototype.forEach.call(buttons, function (button) {
    var handler = function (event) {
      fn.call(self, event, button);
    };

    button.addEventListener("click", handler);

    // A touch counts as a press only if the finger is lifted on the button;
    // a swipe that merely started on it must not trigger it. Cancelling the
    // touchend stops the browser from also sending a click (dialogs sit
    // outside .app, where touchstart isn't cancelled).
    button.addEventListener(self.eventTouchend, function (event) {
      if (event.cancelable) event.preventDefault();
      if (self.isReleasedOn(event, button)) handler(event);
    });
  });
};
