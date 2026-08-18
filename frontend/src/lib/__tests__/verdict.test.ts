import { verdictLabel } from "../verdict";

// The verdict is the product's one claim, and it is shown in two places at once:
// the panel that lists the evidence and the button that becomes the result. They
// had drifted to "Applied, not verified" and "Applied, unverified" — the same
// state under two names, on the same screen. Both now ask this function, so the
// wording is a fact rather than a coincidence.
describe("verdictLabel", () => {
  it("names each state once", () => {
    expect(verdictLabel("verified")).toBe("Applied, verified");
    expect(verdictLabel("failed")).toBe("Applied, not working");
    expect(verdictLabel("unverified")).toBe("Applied, not verified");
  });

  it("lets exactly one of the three read as success", () => {
    const all = ["verified", "failed", "unverified"] as const;
    expect(all.map(verdictLabel).filter((l: string) => !/not/.test(l))).toEqual([
      "Applied, verified",
    ]);
  });

  it("distinguishes not-working from not-checked, which are different answers", () => {
    expect(verdictLabel("failed")).not.toBe(verdictLabel("unverified"));
  });
});
