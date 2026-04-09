// actions.js — The action queue.
//
// All input into the game — keyboard, mouse, touch, or network — is expressed
// as a plain action object and pushed into this queue.  The game loop drains
// the queue once per frame and hands the actions to the update system.
//
// This single chokepoint means:
//   • Local keyboard input and remote network messages travel the same path.
//   • Replaying or recording a session is trivial (just replay the queue).
//   • Systems that produce input (input.js, network.js) are fully decoupled
//     from systems that consume it (update.js).
//
// Action shapes (Phase 1):
//
//   { type: 'KEY_DOWN', entityId: number, direction: 'up'|'down'|'left'|'right' }
//   { type: 'KEY_UP',   entityId: number, direction: 'up'|'down'|'left'|'right' }
//
// Additional action types will be added in later phases (e.g. SPAWN_PLAYER,
// BREAK_BLOCK, PLACE_BLOCK) without changing anything here.

/** @type {Array<Object>} Pending actions waiting to be processed this frame. */
const _queue = [];

/**
 * Push a new action onto the queue.
 *
 * Any system may call this — input handlers, network receivers, AI, etc.
 * The action is processed during the next game-loop tick.
 *
 * @param {Object} action - A plain object describing the action.
 * @param {string} action.type - The action type identifier (e.g. 'KEY_DOWN').
 */
export function enqueueAction(action) {
  _queue.push(action);
}

/**
 * Remove and return all queued actions, leaving the queue empty.
 *
 * Called once per frame by the game loop.  Systems that process input should
 * call this exactly once and iterate the returned array — never read _queue
 * directly.
 *
 * @returns {Array<Object>} The actions that were queued since the last drain.
 */
export function drainActions() {
  // splice(0) is faster than creating a new array and reassigning the module-
  // level reference, because callers already hold a reference to _queue and
  // a reassignment wouldn't affect them anyway.
  return _queue.splice(0, _queue.length);
}

/**
 * Return the number of actions currently waiting in the queue.
 * Useful for debugging and tests.
 *
 * @returns {number}
 */
export function queueLength() {
  return _queue.length;
}