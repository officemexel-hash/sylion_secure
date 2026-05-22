import assert from "node:assert/strict";
import test from "node:test";
import { pixelVisualVerdictFromStats } from "../../../scripts/live-factual-workload-audit.mjs";

test("Step 3.70 Pixel visual evidence accepts rendered noVNC canvas", () => {
  const verdict = pixelVisualVerdictFromStats({
    meanLuma: 214.04,
    lumaStdDev: 72.97,
    colorBuckets: 394,
    darkRatio: 0.0032,
    whiteRatio: 0.781
  });
  assert.equal(verdict.rendered, true);
  assert.equal(verdict.blocker, null);
});

test("Step 3.70 Pixel visual evidence rejects noVNC loading screen", () => {
  const verdict = pixelVisualVerdictFromStats({
    meanLuma: 21.4,
    lumaStdDev: 12.13,
    colorBuckets: 36,
    darkRatio: 0.978,
    whiteRatio: 0.0013
  });
  assert.equal(verdict.rendered, false);
  assert.equal(verdict.loadingLike, true);
  assert.equal(verdict.blocker, "pixel_stream_loading_or_disconnected");
});

test("Step 3.70 Pixel visual evidence rejects blank gateway error page", () => {
  const verdict = pixelVisualVerdictFromStats({
    meanLuma: 254.61,
    lumaStdDev: 9.24,
    colorBuckets: 16,
    darkRatio: 0.0011,
    whiteRatio: 0.9979
  });
  assert.equal(verdict.rendered, false);
  assert.equal(verdict.blankLike, true);
  assert.equal(verdict.blocker, "pixel_stream_blank_or_gateway_error");
});
