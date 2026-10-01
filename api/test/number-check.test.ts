import { describe, expect, it } from "vitest";
import { numbersIn, unverifiedNumbers } from "../src/services/number-check.js";


const allowed = [
  "Tons produced 12480.00",
  "Cost per ton R 214.36",
  "Downtime hours 37.50",
  "Fixed costs R 1250000.00",
  "2026-08-01 to 2026-08-31",
];

describe("unverifiedNumbers", () => {
  it("catches a figure that is not in the records", () => {
    const written =
      "Plant A produced 12480.00 tons at R 214.36 per ton, and lost 91 hours to downtime.";
    expect(unverifiedNumbers(written, allowed)).toEqual(["91"]);
  });

  it("passes an answer built only from the figures it was given", () => {
    const written =
      "Plant A produced 12480.00 tons between 2026-08-01 and 2026-08-31 at R 214.36 per ton, " +
      "losing 37.50 hours to downtime.";
    expect(unverifiedNumbers(written, allowed)).toEqual([]);
  });

  it("allows a figure rounded for readability", () => {
    expect(unverifiedNumbers("About R 214 per ton.", allowed)).toEqual([]);
    expect(unverifiedNumbers("Downtime was 38 hours.", allowed)).toEqual([]);
  });

  it("catches a percentage worked out along the way", () => {
    // Arithmetic nobody recorded is still a figure the records do not contain.
    expect(unverifiedNumbers("Downtime was 5% of the month.", allowed)).toEqual(["5"]);
  });

  it("does not treat a date or a year as a figure", () => {
    expect(unverifiedNumbers("Between 2026-08-01 and 2026-08-31 it ran.", allowed)).toEqual([]);
  });

  it("reads a number written with spaces or commas as one number", () => {
    expect(numbersIn("1 250 000").map((n) => n.value)).toEqual([1250000]);
    expect(numbersIn("1,250,000").map((n) => n.value)).toEqual([1250000]);
    expect(numbersIn("214.36").map((n) => n.value)).toEqual([214.36]);
  });

  it("is not fooled by an invented number that shares digits with a real one", () => {
    expect(unverifiedNumbers("The site produced 1 248 tons.", allowed)).toEqual(["1 248"]);
  });
});
