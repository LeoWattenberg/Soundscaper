/* SPDX-License-Identifier: AGPL-3.0-only */
// Run: node --import tsx scripts/performance/measure-editing-kernels.mjs [repository-root]
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { baselinePink, baselineGain, baselineTone, baselineLinkedDynamics } from './editing-kernel-baselines.mjs';

const root = resolve(process.argv[2] ?? process.cwd());
const editor = resolve(root, 'src/common/editor');
const importSource = path => import(pathToFileURL(resolve(editor, path)).href);
const { generateAudioEditorSignal } = await importSource('generators.js');
const { multiplyChannel } = await importSource('audacity-effects/basic-channel-math.js');
const { applyLinkedDynamics } = await importSource('audacity-effects/basic-dynamics.js');

function checkExact(left, right) {
	assert.equal(left.length, right.length);
	for (let channel = 0; channel < left.length; channel += 1) assert.deepEqual(left[channel], right[channel]);
	return left.reduce((sum, pcm) => sum + pcm.length, 0);
}
function bench(name, run) {
	run();
	const milliseconds = [];
	for (let trial = 0; trial < 5; trial += 1) {
		const start = performance.now();
		run();
		milliseconds.push(performance.now() - start);
	}
	const ordered = milliseconds.slice().sort((a, b) => a - b);
	return { name, medianMs: ordered[2], milliseconds };
}

const pinkOptions = { color: 'pink', durationSeconds: 30, channelCount: 2 };
const pinkCurrent = generateAudioEditorSignal('noise', pinkOptions).channels;
const pinkSamples = checkExact(baselinePink(pinkOptions), pinkCurrent);
const pcm = pinkCurrent[0];
const gainSamples = checkExact([baselineGain(pcm, .8)], [multiplyChannel(pcm, .8)]);
const toneOptions = { durationSeconds: 30, channelCount: 1 };
const toneSamples = checkExact(baselineTone(toneOptions), generateAudioEditorSignal('tone', toneOptions).channels);
const dynamicsFrames = 48_000 * 10;
const dynamicsChannels = Array.from({ length: 8 }, (_, channel) => Float32Array.from({ length: dynamicsFrames }, (_, frame) => .8 * Math.sin(frame * .037 + channel)));
const settings = { ratio: 4, kneeWidthDb: 6, attackMs: 10, releaseMs: 100, thresholdDb: -18, makeupGainDb: 3, lookaheadMs: 1 };
const dynamicsSamples = checkExact(baselineLinkedDynamics(dynamicsChannels, 48_000, settings), applyLinkedDynamics(dynamicsChannels, 48_000, settings));
const result = {
	node: process.version,
	baselineRevision: '25d7cbdb4',
	method: 'Frozen baseline arithmetic compared with current application helpers. One warm-up per case, five measurements; fixture construction and full numerical parity checks outside timed intervals. Local kernel measurements, not end-to-end Electron performance or guaranteed speedups. Tone retains its original phase arithmetic.',
	parity: { pinkSamples, gainSamples, toneSamples, dynamicsSamples, unequalSamples: 0 },
	cases: [
		bench('pink-baseline-30s-stereo', () => baselinePink(pinkOptions)),
		bench('pink-current-30s-stereo', () => generateAudioEditorSignal('noise', pinkOptions)),
		bench('gain-baseline-30s-mono', () => baselineGain(pcm, .8)),
		bench('gain-current-30s-mono', () => multiplyChannel(pcm, .8)),
		bench('tone-baseline-30s-mono', () => baselineTone(toneOptions)),
		bench('tone-current-30s-mono', () => generateAudioEditorSignal('tone', toneOptions)),
		bench('destructive-linked-compressor-baseline-10s-eight-channels', () => baselineLinkedDynamics(dynamicsChannels, 48_000, settings)),
		bench('destructive-linked-compressor-current-10s-eight-channels', () => applyLinkedDynamics(dynamicsChannels, 48_000, settings)),
	],
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
