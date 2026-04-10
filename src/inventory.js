// inventory.js — Local player hotbar inventory (Phase 5).

export const HOTBAR_SLOTS = 5;

// Each slot: { tileType: number, count: number }
// tileType 0 = empty
const _slots = Array.from({ length: HOTBAR_SLOTS }, () => ({ tileType: 0, count: 0 }));

let _selectedSlot = 0;

/**
 * Add one item of the given tileType to the first available matching slot,
 * or the first empty slot. Returns true if added, false if hotbar is full.
 * @param {number} tileType
 * @returns {boolean}
 */
export function addToInventory(tileType) {
  // First try to stack in an existing slot of the same type
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    if (_slots[i].tileType === tileType && _slots[i].count > 0) {
      _slots[i].count++;
      return true;
    }
  }
  // Then find an empty slot
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    if (_slots[i].count === 0) {
      _slots[i].tileType = tileType;
      _slots[i].count = 1;
      return true;
    }
  }
  return false; // hotbar full
}

/** Returns the slots array (read-only intent). */
export function getSlots() { return _slots; }

/** Returns the currently selected slot index (0-based). */
export function getSelectedSlot() { return _selectedSlot; }

/**
 * @param {number} i  0-based index
 */
export function setSelectedSlot(i) {
  _selectedSlot = Math.max(0, Math.min(HOTBAR_SLOTS - 1, i));
}

/**
 * Returns the item in the currently selected slot, or null if empty.
 * @returns {{ tileType: number, count: number }|null}
 */
export function getSelectedItem() {
  const s = _slots[_selectedSlot];
  return s.count > 0 ? s : null;
}

/**
 * Consume one item from the currently selected slot.
 * @returns {number|null} tileType consumed, or null if slot was empty
 */
export function consumeSelected() {
  const s = _slots[_selectedSlot];
  if (s.count <= 0) return null;
  const type = s.tileType;
  s.count--;
  if (s.count === 0) s.tileType = 0;
  return type;
}