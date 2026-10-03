/**
 * Runs before every test file.
 *
 * Adds @testing-library/jest-dom's matchers (toBeInTheDocument, toHaveTextContent, and
 * the rest) to vitest's expect. Without this, a test that asserts on a rendered element
 * fails with "matcher not found".
 */
import "@testing-library/jest-dom/vitest";