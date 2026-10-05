import { describe, expect, it } from "vitest";

describe("web test framework", () => {
  it("runs a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("has a DOM available", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    document.body.appendChild(el);
    expect(el.textContent).toBe("hello");
    document.body.removeChild(el);
  });
});