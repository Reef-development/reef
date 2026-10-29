/**
 * Runs before every test file.
 *
 * Adds @testing-library/jest-dom's matchers (toBeInTheDocument, toHaveTextContent, and
 * the rest) to vitest's expect. Without this, a test that asserts on a rendered element
 * fails with "matcher not found".
 */
import "@testing-library/jest-dom/vitest";

/**
 * jsdom does not implement ResizeObserver, which Radix UI needs to render overlay
 * components like Select. A no-op stand-in is enough for the tests, which never
 * inspect measured sizes.
 */
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/**
 * jsdom does not implement PointerEvent capture. Radix UI's Select calls
 * hasPointerCapture on the pointer target when it opens. A no-op that returns false
 * keeps the open path working.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

/**
 * jsdom does not implement scrollIntoView, which Radix calls on the highlighted option
 * when a Select opens.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}