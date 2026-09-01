/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createNodeAssistanceFloat32WaveStorageV1 } from
	'../desktop/assistance-streaming-float32-wave.ts';
import type { AssistanceRuntimeFamilyOutputGrantV1 } from
	'../desktop/assistance-runtime-family-job-contract.ts';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('rollback preserves an assistance WAV after its publication was committed', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-wave-commit-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputPath = join(await realpath(root), 'output.wav');
	await writeFile(outputPath, new Uint8Array());
	const metadata = await stat(outputPath);
	const output: AssistanceRuntimeFamilyOutputGrantV1 = Object.freeze({
		claimId: '1'.repeat(40), role: 'enhanced-audio', mediaType: 'audio/wav',
		path: outputPath, maximumByteLength: 1_024, initialByteLength: 0,
		initialSha256: EMPTY_SHA256,
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
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
