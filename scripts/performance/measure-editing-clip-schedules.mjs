/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildClipSchedulePlans } from '../../src/common/editor/engine/clip-schedule-plan.ts';

// Compare the preserved uncached public path with the retained immutable path.
// Track membership is deliberately mutable, matching normal resolved projections.
const count = 10_000;
const clips = Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({ id: `clip-${index}`,
	sourceId: 'audio', timelineStartFrame: index * 40, durationFrames: 60, sourceStartFrame: 0, sourceDurationFrames: 60 })));
const track = { id: 'track', type: 'audio', clipIds: clips.map((clip) => clip.id).reverse() };
const project = Object.freeze({ clips, tracks: Object.freeze([track]) });
const baselineProject = { ...project };
const source = { length: 100, sampleRate: 48000, getChannelData: () => new Float32Array(100) };
const options = { sources: new Map([['audio', source]]), trackInputs: new Map([['track', {}]]), sampleRate: 48000,
	fromFrame: 200019, toFrame: 200029 };
for (const first of [0, 39, 200019, 399950, 399999, 400000]) {
	const range = { ...options, fromFrame: first, toFrame: first + 10 };
	assert.deepEqual(buildClipSchedulePlans({ ...range, project }), buildClipSchedulePlans({ ...range, project: baselineProject }));
}
function median(values) { return values.sort((left, right) => left - right)[Math.floor(values.length / 2)]; }
function measure(owner) {
	for (let index = 0; index < 3; index++) buildClipSchedulePlans({ ...options, project: owner });
	const samples = [];
	for (let index = 0; index < 9; index++) { const start = performance.now(); buildClipSchedulePlans({ ...options, project: owner }); samples.push(performance.now() - start); }
	return median(samples);
}
console.log(JSON.stringify({ fixture: { clips: count, tracks: 1, requestedFrames: 10, membership: 'mutable', warmups: 3, samples: 9 },
	parity: 'exact plans at six ranges', uncachedMedianMs: measure(baselineProject), retainedMedianMs: measure(project) }, null, 2));
