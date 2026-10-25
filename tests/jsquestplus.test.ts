import { test } from "node:test";
import assert from "node:assert/strict";

// Humo: ejemplo {1,1,2} de Watson (2017), tal como lo reproduce la demo oficial
// demos/Example_1stim_1psy_2resp_Watson(2017).html de jsQuestPlus.
test("jsQuestPlus vendorizado reproduce el ejemplo {1,1,2} de Watson (2017)", async () => {
  const { default: Q } = await import("../src/vendor/jsquestplus/jsQuestPlus.module.js");
  const r0 = (s: number, t: number, b: number, g: number, l: number) => Q.weibull(s, t, b, g, l);
  const r1 = (s: number, t: number, b: number, g: number, l: number) => 1 - r0(s, t, b, g, l);
  const q = new Q({
    psych_func: [r0, r1],
    stim_samples: [Q.linspace(-40, 0)],
    psych_samples: [Q.linspace(-40, 0), [3.5], [0.5], [0.02]],
  });
  const answers = [1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const stims = [-18, -22, -25, -28, -30, -22, -13, -15, -16, -18, -19, -20, -21, -22, -23, -19, -20, -20, -18, -18, -19, -17, -17, -18, -18, -18, -19, -19, -19, -19, -19, -19];
  answers.forEach((a, i) => {
    const c = q.getStimParams();
    assert.equal(c, stims[i], `ensayo ${i + 1}`);
    q.update(c, a);
  });
  assert.equal(q.getEstimates()[0], -20);
});

test("jsQuestPlus lanza Error en vez de alert()", async () => {
  const { default: Q } = await import("../src/vendor/jsquestplus/jsQuestPlus.module.js");
  assert.throws(() => Q.set_prior([[0.2, 0.2]]));
});
