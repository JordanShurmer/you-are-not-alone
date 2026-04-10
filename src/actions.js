// actions.js — minimal action queue used by input/network -> update.

const queue = [];

/**
 * Enqueue a new action object for processing next frame.
 * @param {Object} action
 */
export function enqueueAction(action) {
  queue.push(action);
}

/**
 * Drain and return all currently queued actions.
 * @returns {Array<Object>}
 */
export function drainActions() {
  if (queue.length === 0) return [];
  return queue.splice(0, queue.length);
}