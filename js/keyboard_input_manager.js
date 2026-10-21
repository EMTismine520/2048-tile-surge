// Movement directions; the numbers are shared with GameManager.VECTORS
var DIRECTIONS = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };

var KEY_R = 82;
var KEY_M = 77;

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

    if (!modifiers) {
      if (mapped !== undefined) {
        event.preventDefault();
        self.emit("move", mapped);
      }
    }

    // R key restarts the game
    if (!modifiers && event.which === KEY_R) {
      self.restart(event);
    }

    // M key mutes/unmutes the sound effects
    if (!modifiers && event.which === KEY_M) {
      self.toggleSound(event);
    }
  });

  // Respond to button presses
  this.bindButtonPress(".retry-button", this.restart);
  this.bindButtonPress(".restart-button", this.restart);
  this.bindButtonPress(".keep-playing-button", this.keepPlaying);
  this.bindButtonPress(".clear-button", this.clearTiles);
  this.bindButtonPress(".revive-button", this.revive);
  this.bindButtonPress(".sound-button", this.toggleSound);

  // Respond to swipe events anywhere on the screen. Preventing the default
  // on touchstart keeps the page from scrolling and stops the browser from
  // synthesizing a click, so buttons fire once (from their touchend binding)
  var touchStartClientX, touchStartClientY;
  var swipeActive = false;
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
    }
  });
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

KeyboardInputManager.prototype.keepPlaying = function (event) {
  event.preventDefault();
  this.emit("keepPlaying");
};

// "Clear tiles" button: ask the game to remove the smallest tiles
KeyboardInputManager.prototype.clearTiles = function (event) {
  event.preventDefault();
  this.emit("clearTiles");
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

KeyboardInputManager.prototype.bindButtonPress = function (selector, fn) {
  var self    = this;
  var button  = document.querySelector(selector);
  var handler = fn.bind(this);

  button.addEventListener("click", handler);

  // A touch counts as a press only if the finger is lifted on the button;
  // a swipe that merely started on it must not trigger it
  button.addEventListener(this.eventTouchend, function (event) {
    if (self.isReleasedOn(event, button)) handler(event);
  });
};
