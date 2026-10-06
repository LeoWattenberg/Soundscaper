/* SPDX-License-Identifier: AGPL-3.0-only */
// Run: node --import tsx scripts/performance/measure-editing-kernels.mjs [repository-root]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { baselineGain, baselineTone, baselineLinkedDynamics } from './editing-kernel-baselines.mjs';

const root = resolve(process.argv[2] ?? process.cwd());
const editor = resolve(root, 'src/common/editor');
const importSource = path => import(pathToFileURL(resolve(editor, path)).href);
const { generateAudioEditorSignal } = await importSource('generators.js');
const { multiplyChannel } = await importSource('audacity-effects/basic-channel-math.js');
const { applyLinkedDynamics } = await importSource('audacity-effects/basic-dynamics.js');
const baselineRevisions = {
	pink: '9c6d928634b2f20f40d3ad145a0991099db1e26a',
	gain: '25d7cbdb45045405670bfab37c833240b0b880ab',
	tone: '25d7cbdb45045405670bfab37c833240b0b880ab',
	linkedDynamics: '25d7cbdb45045405670bfab37c833240b0b880ab',
};
// Main corrected pink's audible spectrum and RNG sequence after the historical audit.
const pinnedSource = execFileSync('git', ['show', `${baselineRevisions.pink}:src/common/editor/generators.js`], { cwd: root, encoding: 'utf8' });
const pinnedMorse = execFileSync('git', ['show', `${baselineRevisions.pink}:src/common/editor/morse-code.ts`], { cwd: root, encoding: 'utf8' });
assert.equal(await readFile(resolve(editor, 'morse-code.ts'), 'utf8'), pinnedMorse, 'The pink reference resolves an unchanged pinned Morse helper.');
const { build } = createRequire(pathToFileURL(resolve(root, 'package.json')))('esbuild');
const bundled = await build({ stdin: { contents: pinnedSource, resolveDir: editor,
	sourcefile: 'main-reference-generators.js', loader: 'js' }, bundle: true, format: 'esm', platform: 'node', write: false });
const reference = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const baselinePink = options => reference.generateAudioEditorSignal('noise', options).channels;

function checkExact(left, right) {
	assert.equal(left.length, right.length);
	for (let channel = 0; channel < left.length; channel += 1) assert.deepEqual(left[channel], right[channel]);
	return left.reduce((sum, pcm) => sum + pcm.length, 0);
}
function bench(name, run, baselineRevision) {
	run();
	const milliseconds = [];
	for (let trial = 0; trial < 5; trial += 1) {
		const start = performance.now();
		run();
		milliseconds.push(performance.now() - start);
	}
	const ordered = milliseconds.slice().sort((a, b) => a - b);
	return { name, baselineRevision, medianMs: ordered[2], milliseconds };
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
	baselineRevisions,
	pinkReference: {
		generatorSourceSha256: createHash('sha256').update(pinnedSource).digest('hex'),
		unchangedMorseHelperSha256: createHash('sha256').update(pinnedMorse).digest('hex'),
	},
	method: 'Pink compares current helpers with the independently bundled pinned main generator, including its corrected sample-rate-dependent spectrum and RNG sequence. Gain, Tone and linked dynamics retain frozen 25d arithmetic; the historical baseline module and prior measurements remain unchanged. These are mixed per-case baselines, not an all-25d comparison. Git reads and bundling, fixture construction and exact parity checks occur outside timing; one warm-up and five measurements per case. Local kernel measurements, not end-to-end Electron performance or guaranteed speedups. Tone retains its original phase arithmetic.',
	parity: { pinkSamples, gainSamples, toneSamples, dynamicsSamples, unequalSamples: 0 },
	cases: [
		bench('pink-baseline-30s-stereo', () => baselinePink(pinkOptions), baselineRevisions.pink),
		bench('pink-current-30s-stereo', () => generateAudioEditorSignal('noise', pinkOptions), baselineRevisions.pink),
		bench('gain-baseline-30s-mono', () => baselineGain(pcm, .8), baselineRevisions.gain),
		bench('gain-current-30s-mono', () => multiplyChannel(pcm, .8), baselineRevisions.gain),
		bench('tone-baseline-30s-mono', () => baselineTone(toneOptions), baselineRevisions.tone),
		bench('tone-current-30s-mono', () => generateAudioEditorSignal('tone', toneOptions), baselineRevisions.tone),
		bench('destructive-linked-compressor-baseline-10s-eight-channels', () => baselineLinkedDynamics(dynamicsChannels, 48_000, settings), baselineRevisions.linkedDynamics),
		bench('destructive-linked-compressor-current-10s-eight-channels', () => applyLinkedDynamics(dynamicsChannels, 48_000, settings), baselineRevisions.linkedDynamics),
	],
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
