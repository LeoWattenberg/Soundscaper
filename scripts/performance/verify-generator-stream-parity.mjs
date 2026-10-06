/* SPDX-License-Identifier: AGPL-3.0-only */
// node --import tsx scripts/performance/verify-generator-stream-parity.mjs [worktree] [output]
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const worktree = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../..'));
const output = resolve(process.argv[3] ?? 'test-results/editing-performance/generator-independent-parity.json');
const require = createRequire(pathToFileURL(`${worktree}/package.json`));
const { build } = require('esbuild');
const { createAudioEditorSignalRenderer } = await import(pathToFileURL(`${worktree}/src/common/editor/signal-generator-renderer.ts`).href);
// Main's corrected pink/DTMF semantics supersede the historical 25d audit baseline.
const baselineRevision = '9c6d928634b2f20f40d3ad145a0991099db1e26a';
const source = execFileSync('git', ['show', `${baselineRevision}:src/common/editor/generators.js`], { cwd: worktree, encoding: 'utf8' });
const baselineMorse = execFileSync('git', ['show', `${baselineRevision}:src/common/editor/morse-code.ts`], { cwd: worktree, encoding: 'utf8' });
assert.equal(await readFile(`${worktree}/src/common/editor/morse-code.ts`, 'utf8'), baselineMorse, 'The Morse helper resolved by the baseline bundle must be unchanged.');
const bundled = await build({ stdin: { contents: source, resolveDir: `${worktree}/src/common/editor`, sourcefile: 'baseline-generators.js', loader: 'js' }, bundle: true, format: 'esm', platform: 'node', write: false });
const baseline = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
let state = 752342;
const random = () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 2 ** 32);
const digest = channels => {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
};
const cases = [];
let jobs = 0;
let samples = 0;
for (let iteration = 0; iteration < 24; iteration++) {
	const sampleRate = [8000, 11025, 44100, 48000][iteration % 4];
	const frames = iteration === 0 ? 1 : 1 + Math.floor(random() * 24000);
	const channelCount = [1, 2, 7, 32][iteration % 4];
	const base = { sampleRate, durationSeconds: frames / sampleRate, channelCount, amplitude: random() };
	const jobsToCheck = [
		['silence', base],
		['tone', { ...base, frequency: 0.01 + random() * (sampleRate / 2 - 0.01), waveform: ['sine', 'square', 'sawtooth'][iteration % 3] }],
		['chirp', { ...base, startFrequency: 0.01 + random() * (sampleRate / 2 - 0.01), endFrequency: 0.01 + random() * (sampleRate / 2 - 0.01), startAmplitude: random(), endAmplitude: random(), waveform: ['sine', 'square', 'sawtooth'][iteration % 3], interpolation: iteration % 2 ? 'linear' : 'logarithmic' }],
		['noise', { ...base, color: ['white', 'pink', 'brown'][iteration % 3], seed: [0, 1, 0x80000000, 0xffffffff, state][iteration % 5] }],
		['dtmf', { ...base, sequence: '11AB1#D', toneSeconds: (iteration % 2 ? 18000 : 1 + Math.floor(random() * 1000)) / sampleRate, silenceSeconds: Math.floor(random() * 200) / sampleRate }],
		['morse', { ...base, text: ['SOS', 'P0?', 'E EE', 'TEST 123'][iteration % 4], wordsPerMinute: 90 + random() * 30, frequency: 0.01 + random() * (sampleRate / 2 - 0.01) }],
	];
	for (const [type, options] of jobsToCheck) {
		const expected = baseline.generateAudioEditorSignal(type, options);
		const renderer = createAudioEditorSignalRenderer(type, options);
		assert.equal(renderer.frameCount, expected.frameCount);
		const result = expected.channels.map(channel => new Float32Array(channel.length));
		let offset = 0;
		for (let index = 0; ; index++) {
			const block = renderer.next([1, 127, 255, 4096, 65536][index % 5]);
			if (!block) break;
			const cloned = structuredClone(block, { transfer: block.map(channel => channel.buffer) });
			for (let channel = 0; channel < result.length; channel++) result[channel].set(cloned[channel], offset);
			offset += cloned[0].length;
		}
		assert.deepEqual(result, expected.channels, `${type}, iteration ${iteration}`);
		jobs++;
		samples += expected.frameCount * channelCount;
		cases.push({ iteration, type, options, frameCount: expected.frameCount, channelCount, samples: expected.frameCount * channelCount,
			baselineSha256: digest(expected.channels), streamedSha256: digest(result), exactFloat32Comparison: 'passed' });
	}
}
assert.equal(jobs, 144);
assert.equal(samples, 21_174_675);
const proof = {
	baselineRevision,
	baselineGeneratorSourceSha256: createHash('sha256').update(source).digest('hex'),
	unchangedMorseHelperSha256: createHash('sha256').update(baselineMorse).digest('hex'),
	reviewedRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).trim(),
	jobs,
	samples,
	exactFloat32Comparison: 'passed',
	transferredPriorBlocks: true,
	adaptiveBlockFrames: [1, 127, 255, 4096, 65536],
	seed: 752342,
	method: 'Compare each streamed channel byte-for-byte through assert.deepEqual against generators.js from the baseline Git revision with corrected current-main generator semantics, bundled with its unchanged Morse helper; transfer every emitted block before requesting the next.',
	reproductionCommand: 'node --import tsx scripts/performance/verify-generator-stream-parity.mjs',
	cases,
};
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, `${JSON.stringify(proof, null, 2)}\n`);
process.stdout.write(JSON.stringify({ output, baseline: baselineRevision, jobs, samples, exactFloat32Comparison: 'passed', transferredPriorBlocks: true }) + '\n');
