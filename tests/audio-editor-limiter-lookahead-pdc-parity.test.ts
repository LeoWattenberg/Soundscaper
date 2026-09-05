/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DynamicsProcessor } from '../src/common/editor/dynamics-worklet.js';
import { effectLatencyFrames } from '../src/common/editor/engine/effect-rack.ts';

const RENDER_QUANTUM = 128;

interface LookaheadCase {
	readonly sampleRate: number;
	readonly lookahead: number;
	readonly plannedFrames: number;
}

/**
 * Both cases are reachable from the lookahead knob, which quantises to 0.001 s
 * steps: 0.003 s at 44.1 kHz lands mid-frame (132.3), and 0.017 s at 48 kHz is a
 * whole 816 frames in exact arithmetic but 816.0000000000001 in binary floating
 * point, so the plan's ceil claims 817.
 */
const CASES: readonly LookaheadCase[] = [
	{ sampleRate: 44_100, lookahead: 0.003, plannedFrames: 133 },
	{ sampleRate: 48_000, lookahead: 0.017, plannedFrames: 817 },
];

function limiterImpulseDelayFrames(lookahead: number, blocks: number): number {
	const limiter = new DynamicsProcessor({
		processorOptions: { type: 'limiter', params: { lookahead, ceiling: 0, release: 0.1 } },
	});
	for (let block = 0; block < blocks; block += 1) {
		const input = new Float32Array(RENDER_QUANTUM);
		if (block === 0) input[0] = 0.5;
		const channels = [new Float32Array(RENDER_QUANTUM)];
		limiter.process([[input]], [channels]);
		for (let frame = 0; frame < RENDER_QUANTUM; frame += 1) {
			if (channels[0]![frame] !== 0) return (block * RENDER_QUANTUM) + frame;
		}
	}
	return -1;
}

test('the limiter worklet delays by exactly the frames the PDC plan compensates', () => {
	const runtimeGlobal = globalThis as typeof globalThis & { sampleRate?: number };
	const previousSampleRate = runtimeGlobal.sampleRate;
	try {
		for (const { sampleRate, lookahead, plannedFrames } of CASES) {
			runtimeGlobal.sampleRate = sampleRate;
			const planned = effectLatencyFrames(
				{ id: 'limit', type: 'limiter', enabled: true, bypassed: false, params: { lookahead } },
				sampleRate,
			);
			assert.equal(planned, plannedFrames, `plan latency for ${lookahead} s at ${sampleRate} Hz`);
			const blocks = Math.ceil((planned + 2) / RENDER_QUANTUM) + 1;
			assert.equal(
				limiterImpulseDelayFrames(lookahead, blocks),
				planned,
				`worklet delay for ${lookahead} s at ${sampleRate} Hz must match the compensated plan`,
			);
		}
	} finally {
		if (previousSampleRate === undefined) delete runtimeGlobal.sampleRate;
		else runtimeGlobal.sampleRate = previousSampleRate;
	}
});
