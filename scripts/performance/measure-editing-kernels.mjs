/* SPDX-License-Identifier: AGPL-3.0-only */
// Run: node --import tsx scripts/performance/measure-editing-kernels.mjs [repository-root]
// Isolated in-memory prototypes; this does not modify application files.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const root = resolve(process.argv[2] ?? process.cwd());
const editor = resolve(root, 'src/common/editor');
const importSource = path => import(pathToFileURL(resolve(editor, path)).href);
const { generateAudioEditorSignal } = await importSource('generators.js');
const { multiplyChannel } = await importSource('audacity-effects/basic-channel-math.js');
const { applyLinkedDynamics } = await importSource('audacity-effects/basic-dynamics.js');
const moduleFromText = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
function checkedReplace(source, before, after) {
	assert.ok(source.includes(before), 'Prototype replacement must still match the audited implementation');
	return source.replace(before, after);
}
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
let generatorSource = await readFile(resolve(editor, 'generators.js'), 'utf8');
generatorSource = checkedReplace(generatorSource, "'./morse-code.ts'", JSON.stringify(pathToFileURL(resolve(editor, 'morse-code.ts')).href));
let pinkSource = checkedReplace(generatorSource, 'let counter = 0;', 'let counter = 0; let pinkTotal = 0;');
pinkSource = checkedReplace(pinkSource, 'if (zeroes < pinkBins.length) pinkBins[zeroes] = white;', 'if (zeroes < pinkBins.length) { pinkTotal -= pinkBins[zeroes]; pinkBins[zeroes] = white; pinkTotal += white; }');
pinkSource = checkedReplace(pinkSource, 'pinkBins.reduce((sum, bin) => sum + bin, 0)', 'pinkTotal');
const pinkPrototype = (await moduleFromText(pinkSource)).generateAudioEditorSignal;
let toneSource = checkedReplace(generatorSource, 'phase = (phase + step) % 1;', 'phase += step; if (phase >= 1) phase -= 1;');
const tonePrototype = (await moduleFromText(toneSource)).generateAudioEditorSignal;
function indexedGain(channel, gain) {
	const output = new Float32Array(channel.length);
	for (let frame = 0; frame < channel.length; frame += 1) output[frame] = channel[frame] * gain;
	return output;
}
let dynamicsSource = await readFile(resolve(editor, 'audacity-effects/basic-dynamics.js'), 'utf8');
for (const dependency of ['basic-channel-math.js', 'audacity-dynamics-lookahead.ts']) {
	dynamicsSource = checkedReplace(dynamicsSource, JSON.stringify('./' + dependency).replaceAll('"', "'"), JSON.stringify(pathToFileURL(resolve(editor, 'audacity-effects', dependency)).href));
}
const originalFill = `return channels.map((channel) => {\n\t\tconst output = new Float32Array(frameCount);\n\t\tfor (let index = 0; index < frameCount; index += 1) {\n\t\t\toutput[index] = channel[index] * dbToLinear(envelope[index] + settings.makeupGainDb);\n\t\t}\n\t\treturn output;\n\t});`;
const frameMajorFill = `const output = channels.map(() => new Float32Array(frameCount));
	for (let index = 0; index < frameCount; index += 1) {
		const gain = dbToLinear(envelope[index] + settings.makeupGainDb);
		for (let channel = 0; channel < channels.length; channel += 1) output[channel][index] = channels[channel][index] * gain;
	}
	return output;`;
dynamicsSource = checkedReplace(dynamicsSource, originalFill, frameMajorFill);
const dynamicsPrototype = (await moduleFromText(dynamicsSource)).applyLinkedDynamics;
const pinkOptions = { color: 'pink', durationSeconds: 30, channelCount: 2 };
const pinkCurrent = generateAudioEditorSignal('noise', pinkOptions).channels;
const pinkSamples = checkExact(pinkCurrent, pinkPrototype('noise', pinkOptions).channels);
const pcm = pinkCurrent[0];
const gainSamples = checkExact([multiplyChannel(pcm, .8)], [indexedGain(pcm, .8)]);
const toneOptions = { durationSeconds: 30, channelCount: 1 };
const toneSamples = checkExact(generateAudioEditorSignal('tone', toneOptions).channels, tonePrototype('tone', toneOptions).channels);
const dynamicsFrames = 48_000 * 10;
const dynamicsChannels = Array.from({ length: 8 }, (_, channel) => Float32Array.from({ length: dynamicsFrames }, (_, frame) => .8 * Math.sin(frame * .037 + channel)));
const settings = { ratio: 4, kneeWidthDb: 6, attackMs: 10, releaseMs: 100, thresholdDb: -18, makeupGainDb: 3, lookaheadMs: 1 };
const dynamicsSamples = checkExact(applyLinkedDynamics(dynamicsChannels, 48_000, settings), dynamicsPrototype(dynamicsChannels, 48_000, settings));
const result = {
	node: process.version,
	method: 'One warm-up per case, five measurements; fixture construction and full numerical parity checks outside timed intervals. Local kernel measurements, not end-to-end Electron performance or guaranteed speedups.',
	parity: { pinkSamples, gainSamples, toneSamples, dynamicsSamples, unequalSamples: 0 },
	cases: [
		bench('pink-current-30s-stereo', () => generateAudioEditorSignal('noise', pinkOptions)),
		bench('pink-running-total-prototype-30s-stereo', () => pinkPrototype('noise', pinkOptions)),
		bench('gain-current-30s-mono', () => multiplyChannel(pcm, .8)),
		bench('gain-indexed-fill-prototype-30s-mono', () => indexedGain(pcm, .8)),
		bench('tone-current-30s-mono', () => generateAudioEditorSignal('tone', toneOptions)),
		bench('tone-wrap-only-prototype-30s-mono', () => tonePrototype('tone', toneOptions)),
		bench('destructive-linked-compressor-current-10s-eight-channels', () => applyLinkedDynamics(dynamicsChannels, 48_000, settings)),
		bench('destructive-linked-compressor-frame-major-gain-prototype-10s-eight-channels', () => dynamicsPrototype(dynamicsChannels, 48_000, settings)),
	],
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
