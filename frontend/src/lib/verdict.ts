import { ApplyOutcome } from "../types";

// One state, one sentence.
//
// The verdict is written in two places — the panel that shows the working, and
// the button that turns into the result — and they had drifted: the same
// outcome read "Applied, not verified" in one and "Applied, unverified" in the
// other. Two names for one state is how a reader starts wondering whether they
// are two states.
export function verdictLabel(verdict: ApplyOutcome["verdict"]): string {
  return verdict === "verified"
    ? "Applied, verified"
    : verdict === "failed"
    ? "Applied, not working"
    : "Applied, not verified";
}
