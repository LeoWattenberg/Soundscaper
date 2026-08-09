/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	probeVideoTiming,
	type VideoTimingProbePort,
} from '../src/common/editor/video-timing-probe.ts';

const cfr: VideoTimingProbePort = {
	id: 'webcodecs',
	async probe() {
		return {
			timescale: 90_000,
			presentationTicks: [0n, 3_003n, 6_006n],
			finalFrameDurationTicks: 3_003n,
			nominalRate: { num: 30_000, den: 1_001 },
		};
	},
};

test('supported probes preserve exact CFR rational rates and per-frame ticks', async () => {
	const result = await probeVideoTiming(new Blob(['cfr']), { probes: [cfr] });
	assert.equal(result.decision, 'timing-asset');
	if (result.decision !== 'timing-asset') return;
	assert.equal(result.backend, 'webcodecs');
	assert.deepEqual(result.nominalRate, { num: 30_000, den: 1_001 });
	assert.deepEqual(result.timing.presentationTicks, [0n, 3_003n, 6_006n]);
});

test('VFR probe results retain unequal frame durations instead of fabricating CFR', async () => {
	const result = await probeVideoTiming(new Blob(['vfr']), { probes: [{
		id: 'ffmpeg',
		async probe() {
			return {
				timescale: 1_000_000,
				presentationTicks: [0n, 33_333n, 83_333n, 116_666n],
				finalFrameDurationTicks: 41_667n,
				nominalRate: { num: 24, den: 1 },
			};
		},
	}] });
	assert.equal(result.decision, 'timing-asset');
	if (result.decision !== 'timing-asset') return;
	assert.deepEqual(result.timing.presentationTicks, [0n, 33_333n, 83_333n, 116_666n]);
	assert.equal(result.timing.endTicks, 158_333n);
});

test('unavailable probing records a deterministic conform-at-ingest decision', async () => {
	const result = await probeVideoTiming(new Blob(['unsupported']), {
		probes: [{ id: 'webcodecs', async probe() { throw new Error('unsupported container'); } }],
		fallbackRate: { num: 25, den: 1 },
	});
	assert.deepEqual(result, {
		decision: 'conform-cfr-at-ingest',
		rate: { num: 25, den: 1 },
		reason: 'timing-probe-unavailable',
		failures: [{ backend: 'webcodecs', message: 'unsupported container' }],
	});
});
