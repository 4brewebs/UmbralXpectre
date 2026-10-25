import { angDist, luminance, searchPriors, addScaled, dirFromTheta, ANCHOR } from "./space";
import { answer, createSession, stimulusOf, type Judgment, type Session } from "./session";

function play(judge: (session: Session) => Judgment): Session {
  let session = createSession(1);
  let guard = 0;
  while (!session.complete && guard < 240) {
    const stim = stimulusOf(session);
    const judgment = stim?.catch ? "same" : judge(session);
    session = answer(session, judgment, guard + 2);
    guard += 1;
  }
  return session;
}

function assert(cond: boolean, message: string, errors: string[]) {
  if (!cond) errors.push(message);
}

export function runSelfCheck(): string[] {
  const errors: string[] = [];
  const priors = searchPriors();
  assert(priors.length === 4, "expected 4 priors", errors);
  assert(priors[0].key === "s", "blue-yellow prior should run first", errors);

  for (const p of priors) {
    const sample = addScaled([ANCHOR, ANCHOR, ANCHOR], p.dir, p.maxS * 0.5);
    const yErr = Math.abs(luminance(sample) - ANCHOR);
    assert(yErr < 1e-6, `luminance drift on ${p.key}: ${yErr}`, errors);
    assert(p.maxS > 0.08, `gamut too small on ${p.key}`, errors);
  }

  const normal = play((session) => {
    const axis = session.axes.find((a) => a.id === session.activeId);
    if (!axis) return "different";
    return axis.cursor < 0.015 ? "same" : "different";
  });
  assert(normal.complete, "normal session did not finish", errors);
  assert(normal.catchMisses === 0 && normal.catchHits >= 4, `catches ${normal.catchHits}/${normal.catchMisses}`, errors);
  assert(
    normal.log.some((trial) => trial.axisId === "catch" && trial.reference.join() === trial.comparison.join()),
    "a catch pair was not identical",
    errors,
  );
  assert(
    normal.axes.filter((axis) => axis.priorKey !== "refine").every((axis) => axis.thresholdKind === "upper-bound"),
    "normal axes should close as upper bounds",
    errors,
  );
  assert(normal.axes.some((axis) => axis.id === "red-end"), "missing the last red", errors);
  assert(normal.axes.some((axis) => axis.id === "blue-end"), "missing the first blue", errors);
  assert(!normal.axes.some((a) => a.priorKey === "refine"), "normal session should not refine", errors);

  const sTheta = priors.find((p) => p.key === "s")!.theta;
  const blueOk = play((session) => {
    const axis = session.axes.find((a) => a.id === session.activeId);
    if (!axis) return "different";
    const onBlue = angDist(axis.theta, sTheta) < 0.2;
    const thresh = onBlue ? 0.085 : 0.8;
    return axis.cursor / axis.maxS < thresh ? "same" : "different";
  });
  assert(blueOk.complete, "mixed session did not finish", errors);
  const blueAxis = blueOk.axes.find((a) => a.id === "s");
  assert(blueAxis?.thresholdKind === "upper-bound", "intact blue axis was not closed", errors);
  const blueTrials = blueOk.log.filter((t) => t.axisId === "s").length;
  assert(blueTrials === 5, `blue axis kept going: ${blueTrials} trials`, errors);
  const open = blueOk.axes.filter((a) => a.priorKey !== "s" && a.priorKey !== "refine" && a.thresholdKind === "estimate");
  assert(open.length >= 1, "expected a measured non-blue axis", errors);

  const peak = priors.find((p) => p.key === "l")!.theta + 0.36;
  const shifted = play((session) => {
    const axis = session.axes.find((a) => a.id === session.activeId);
    if (!axis) return "different";
    const d = angDist(axis.theta, peak);
    const thresh = 0.08 + 0.7 * Math.exp(-(d * d) / (2 * 0.16 * 0.16));
    return axis.cursor / axis.maxS < thresh ? "same" : "different";
  });
  assert(shifted.complete, "shifted session did not finish", errors);
  const estimates = shifted.axes.filter((a) => a.thresholdKind === "estimate" && a.threshold != null);
  const worst = estimates.reduce((a, b) => {
    const an = (a.threshold ?? 0) / a.maxS;
    const bn = (b.threshold ?? 0) / b.maxS;
    return an >= bn ? a : b;
  });
  const miss = angDist(worst.theta, peak);
  assert(miss < 0.45, `fitted angle missed the peak by ${miss}`, errors);
  assert(
    shifted.axes.some((a) => a.priorKey === "refine"),
    "shifted confusion should spawn neighbor probes",
    errors,
  );

  const dir = dirFromTheta(peak);
  assert(Math.abs(luminance(dir)) < 1e-6, "direction not constant-Y", errors);
  return errors;
}
