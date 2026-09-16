/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { closeDesktopAudioStreamHelperResources, runDesktopAudioStreamHelperJob } from '../desktop/audio-codec-stream-helper.ts';
import { bundledAudioCodecSpec, type BundledAudioCodecHelperConfiguration } from '../desktop/bundled-audio-codec-helper-configuration.ts';
import { validateStreamedAudioOutput } from '../src/common/editor/browser-streamed-audio-output-validation.ts';
import { createDesktopAudioStreamService } from '../desktop/desktop-audio-stream-service.ts';
import { encodeDesktopAudioStreamFile } from '../src/common/editor/desktop-audio-stream-encoder.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const frameCount = 40_000; const pcm = new Uint8Array(frameCount * 8);
for (let frame = 0; frame < frameCount; frame++) {
	new DataView(pcm.buffer).setFloat32(frame * 8, Math.sin(frame / 31) * .25, true);
	new DataView(pcm.buffer).setFloat32(frame * 8 + 4, Math.sin(frame / 43) * .25, true);
}

test('utility cleanup attempts every resource and preserves the encoding failure before close failures', async () => {
	const primary = new Error('encode failed'); const sessionError = new Error('session close failed'); const outputError = new Error('output close failed');
	const closed: string[] = [];
	await assert.rejects(() => closeDesktopAudioStreamHelperResources([
		{ close() { closed.push('session'); throw sessionError; } },
		{ close: async () => { closed.push('output'); throw outputError; } },
		{ close: async () => { closed.push('input'); } },
	], [primary]), (error: unknown) => error instanceof AggregateError && error.cause === primary
		&& error.errors[0] === primary && error.errors[1] === sessionError && error.errors[2] === outputError);
	assert.deepEqual(closed, ['session', 'output', 'input']);
});

test('desktop utility authenticates PCM, streams native FLAC scratch, and patches exact final geometry', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-real-audio-stream-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const runtimeRoot = resolve('.'); const spec = bundledAudioCodecSpec('flac');
	const payload = await readFile(join(runtimeRoot, spec.wasmFile));
	const configuration: BundledAudioCodecHelperConfiguration = { contractVersion: 1, target: 'linux-x64', codec: 'flac', runtimeRoot,
		moduleBytes: 1000, moduleSha256: 'a'.repeat(64), dependencies: spec.dependencies.map((path) => ({ path, byteLength: 1000, sha256: 'b'.repeat(64) })),
		wasmBytes: payload.byteLength, wasmSha256: digest(payload) };
	const inputPath = join(root, 'input.pcm'); const outputPath = join(root, 'output.flac'); await writeFile(inputPath, pcm, { flag: 'wx' });
	const job = { schemaVersion: 1, type: 'audio-stream-job', inputPath, outputPath, inputSha256: digest(pcm),
		plan: { schemaVersion: 1, frameCount, maximumOutputBytes: 1_000_000,
			tuple: { operation: 'audio-encode', format: 'flac', sampleRate: 48000, channelCount: 2, settings: { compressionLevel: 5, bitDepth: 24 } } } };
	const progress: number[] = [];
	await assert.rejects(() => runDesktopAudioStreamHelperJob(configuration, { ...job, inputSha256: '0'.repeat(64) }), /PCM digest/u);
	const result = await runDesktopAudioStreamHelperJob(configuration, job, (frames, total) => { assert.equal(total, frameCount); progress.push(frames); });
	const encoded = await readFile(outputPath); assert.equal(result.outputBytes, encoded.length);
	assert.equal(progress[0], 0); assert.equal(progress.at(-1), frameCount); assert.ok(progress.some((frames) => frames > 0 && frames < frameCount));
	await validateStreamedAudioOutput(new Blob([encoded]), { format: 'flac', frameCount, channelCount: 2, sampleRate: 48000 });
	await assert.rejects(() => runDesktopAudioStreamHelperJob(configuration, { ...job, outputPath: join(root, 'sixteen.flac'),
		plan: { ...job.plan, tuple: { ...job.plan.tuple, settings: { compressionLevel: 5, bitDepth: 16 } } } }), /24-bit/u);
});

test('reviewed utility FLAC reaches renderer as a validated ranged native file through bounded main commands', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-reviewed-stream-adapter-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const runtimeRoot = resolve('.'); const spec = bundledAudioCodecSpec('flac');
	const payload = await readFile(join(runtimeRoot, spec.wasmFile));
	const configuration: BundledAudioCodecHelperConfiguration = { contractVersion: 1, target: 'linux-x64', codec: 'flac', runtimeRoot,
		moduleBytes: 1000, moduleSha256: 'a'.repeat(64), dependencies: spec.dependencies.map((path) => ({ path, byteLength: 1000, sha256: 'b'.repeat(64) })),
		wasmBytes: payload.byteLength, wasmSha256: digest(payload) };
	const service = createDesktopAudioStreamService({ scratchRoot: root,
		capabilities: async (query) => ({ schemaVersion: 2, capabilities: query.operations.map((tuple) => ({
			...tuple, available: true, provider: 'bundled', reason: null })) }),
		execute: async (job, _signal, onProgress) => (await runDesktopAudioStreamHelperJob(configuration, job, onProgress)).outputBytes });
	context.after(() => service.dispose());
	const file = new Blob([Uint8Array.from(encodeWav([new Float32Array(frameCount), new Float32Array(frameCount)], { sampleRate: 48000, bitDepth: 32, float: true }))]);
	const owner = {}; const result = await encodeDesktopAudioStreamFile({ file,
		plan: { schemaVersion: 1, frameCount, maximumOutputBytes: 1_000_000,
			tuple: { operation: 'audio-encode', format: 'flac', sampleRate: 48000, channelCount: 2, settings: { compressionLevel: 5, bitDepth: 24 } } },
		channelMapping: 'preserve', extension: '.flac', mimeType: 'audio/flac', settings: {},
	}, (command) => service.command(owner, command));
	assert.equal(result.bytes, null); assert.ok(result.blob.size > 0);
	assert.deepEqual(new Uint8Array(await result.blob.slice(0, 4).arrayBuffer()), new Uint8Array([102, 76, 97, 67]));
	await result.cleanup(); await assert.rejects(() => result.blob.slice(0, 4).arrayBuffer(), /released/u);
});
