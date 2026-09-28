/**
 * Throttle function using requestAnimationFrame for smooth 60fps updates
 * @param {Function} fn - Function to throttle
 * @returns {Function} Throttled function
 */
export function throttleRaf(fn) {
  let rafId = null;
  let lastArgs = null;

  return function throttled(...args) {
    lastArgs = args;
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        fn.apply(this, lastArgs);
        rafId = null;
      });
    }
  };
}

/**
 * Standard throttle with time delay
 * @param {Function} fn - Function to throttle
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(fn, delay = 100) {
  let timeoutId = null;
  let lastArgs = null;

  return function throttled(...args) {
    lastArgs = args;
    if (timeoutId === null) {
      timeoutId = setTimeout(() => {
        fn.apply(this, lastArgs);
        timeoutId = null;
      }, delay);
    }
  };
}
