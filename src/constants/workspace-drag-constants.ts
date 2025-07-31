/**
 * Constants for workspace drag-and-drop functionality
 */

// Workspace item dimensions
export const WORKSPACE_ITEM = {
  PADDING_VERTICAL: 10,
  PADDING_HORIZONTAL: 12,
  GAP: 4,
  TOTAL_HEIGHT: 44, // Total height including padding and gap
} as const;

// Auto-scroll configuration
export const WORKSPACE_DRAG_SCROLL = {
  ZONE_SIZE: 50, // Size of scroll zones at top/bottom of container
  BASE_SPEED: 5, // Base scroll speed (was 5 in code)
  MAX_SPEED: 20, // Maximum scroll speed
  SPEED_MULTIPLIER: 2, // Speed calculation multiplier
  INTERVAL_MS: 20, // Scroll interval in milliseconds
} as const;

// Animation durations
export const WORKSPACE_ANIMATIONS = {
  TRANSITION_DURATION: 200, // milliseconds for position transitions
  OPACITY_DRAGGING: 0.5, // opacity when dragging
  OPACITY_NORMAL: 1, // normal opacity
} as const;

// Transform values for drag animations
export const WORKSPACE_TRANSFORMS = {
  MOVE_UP: `translateY(-${WORKSPACE_ITEM.TOTAL_HEIGHT}px)`,
  MOVE_DOWN: `translateY(${WORKSPACE_ITEM.TOTAL_HEIGHT}px)`,
  NO_TRANSFORM: 'translateY(0)',
} as const;