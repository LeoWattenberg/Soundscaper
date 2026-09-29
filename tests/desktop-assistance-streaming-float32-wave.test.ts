/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createNodeAssistanceFloat32WaveStorageV1 } from
	'../desktop/assistance-streaming-float32-wave.ts';
import type { AssistanceRuntimeFamilyInputGrantV1, AssistanceRuntimeFamilyOutputGrantV1 } from
	'../desktop/assistance-runtime-family-job-contract.ts';
import { nativeChildFileIdentityFromStat } from '../desktop/native-child-file-identity.ts';
import { createWavHeader } from '../src/common/editor/wav.js';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('rollback preserves an assistance WAV after its publication was committed', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-wave-commit-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputPath = join(await realpath(root), 'output.wav');
	await writeFile(outputPath, new Uint8Array());
	const metadata = await stat(outputPath, { bigint: true });
	const output: AssistanceRuntimeFamilyOutputGrantV1 = Object.freeze({
		claimId: '1'.repeat(40), role: 'enhanced-audio', mediaType: 'audio/wav',
		path: outputPath, maximumByteLength: 1_024, initialByteLength: 0,
		initialSha256: EMPTY_SHA256,
		identity: nativeChildFileIdentityFromStat(metadata),
	});
	const geometry = Object.freeze({
		sampleRate: 48_000, channelCount: 1, frameCount: 2, byteLength: 52,
	});
	const sink = await createNodeAssistanceFloat32WaveStorageV1().openSink(output, geometry);
	await sink.writeFrames([Float32Array.of(0.25, -0.5)]);
	await sink.seal();
	await sink.publish();
	await sink.commit();
	const committed = await readFile(outputPath);

	await sink.rollback();

	assert.equal(committed.byteLength, geometry.byteLength);
	assert.deepEqual(await readFile(outputPath), committed);
});

test('assistance WAV publication rejects cancellation at its final write', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-wave-cancel-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputPath = join(await realpath(root), 'output.wav');
	await writeFile(outputPath, new Uint8Array());
	const metadata = await stat(outputPath, { bigint: true });
	const output: AssistanceRuntimeFamilyOutputGrantV1 = Object.freeze({
		claimId: '1'.repeat(40), role: 'enhanced-audio', mediaType: 'audio/wav',
		path: outputPath, maximumByteLength: 1_024, initialByteLength: 0,
		initialSha256: EMPTY_SHA256,
		identity: nativeChildFileIdentityFromStat(metadata),
	});
	const geometry = Object.freeze({
		sampleRate: 48_000, channelCount: 1, frameCount: 2, byteLength: 52,
	});
	const controller = new AbortController();
	const reason = new DOMException('Publication cancelled.', 'AbortError');
	let publicationWrites = 0;
	const sink = await createNodeAssistanceFloat32WaveStorageV1((event) => {
		if (event.kind !== 'publication-write') return;
		publicationWrites += 1;
		controller.abort(reason);
	}).openSink(output, geometry);
	await sink.writeFrames([Float32Array.of(0.25, -0.5)]);
	await sink.seal();
	await assert.rejects(sink.publish(controller.signal), (error: unknown) => error === reason);
	await sink.rollback();
	assert.equal(publicationWrites, 1);
	assert.equal((await stat(outputPath)).size, 0);
});

test('assistance WAV reads reject cancellation at their final range read', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-wave-read-cancel-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const inputPath = join(await realpath(root), 'input.wav');
	const bytes = new Uint8Array(52);
	bytes.set(createWavHeader({ sampleRate: 48_000, channelCount: 1, totalFrames: 2,
		bitDepth: 32, float: true, dither: false }));
	const view = new DataView(bytes.buffer);
	view.setFloat32(44, 0.25, true);
	view.setFloat32(48, -0.5, true);
	await writeFile(inputPath, bytes);
	const metadata = await stat(inputPath, { bigint: true });
	const input: AssistanceRuntimeFamilyInputGrantV1 = Object.freeze({
		claimId: '2'.repeat(40), role: 'audio', mediaType: 'audio/wav',
		path: inputPath, byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: nativeChildFileIdentityFromStat(metadata),
	});
	const controller = new AbortController();
	const reason = new DOMException('Read cancelled.', 'AbortError');
	const source = await createNodeAssistanceFloat32WaveStorageV1((event) => {
		if (event.kind === 'input-read' && event.position === 44) controller.abort(reason);
	}).openSource(input, 48_000);
	try {
		await assert.rejects(source.readFrames({ startFrame: 0, frameCount: 2,
			channelStart: 0, channelCount: 1 }, controller.signal),
		(error: unknown) => error === reason);
	} finally {
		await source.close();
	}
});
