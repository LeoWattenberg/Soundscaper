/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	ASSISTANCE_WAVE_MAXIMUM_FILE_READ_BYTES,
	openAssistanceFloat32MonoWaveFileV1,
} from '../desktop/assistance-float32-mono-wave-file-reader.ts';
import { createWavHeader, encodeWav } from '../src/common/editor/wav.js';

test('the Float32 WAV file reader preserves exact samples through bounded positioned reads', async (context) => {
	const samples = Float32Array.from({ length: 400_000 }, (_, index) => Math.fround(
		Math.sin(index / 100) * 0.5,
	));
	const bytes = encodeWav([samples], {
		sampleRate: 32_000, bitDepth: 32, float: true, dither: false,
	});
	const path = await writeFixture(context, bytes);
	const source = await openAssistanceFloat32MonoWaveFileV1(path, 32_000, bytes.byteLength);
	context.after(() => source.close());

	assert.equal(source.sampleCount, samples.length);
	assert.deepEqual(await source.readSamples(123_456, 131_072), samples.slice(123_456, 254_528));
	assert.ok(source.maximumObservedFileReadBytes <= ASSISTANCE_WAVE_MAXIMUM_FILE_READ_BYTES);
});

test('the Float32 WAV file reader opens sparse authority beyond ten minutes without reading its body', async (context) => {
	const sampleRate = 22_050;
	const sampleCount = 11 * 60 * sampleRate;
	const header = createWavHeader({ sampleRate, channelCount: 1, totalFrames: sampleCount,
		bitDepth: 32, float: true });
	const byteLength = 44 + sampleCount * 4;
	const path = join(tmpdir(), `soundscaper-sparse-wave-${crypto.randomUUID()}.wav`);
	context.after(() => rm(path, { force: true }));
	const handle = await open(path, 'wx', 0o600);
	try {
		await handle.write(header, 0, header.byteLength, 0);
		await handle.truncate(byteLength);
	} finally { await handle.close(); }

	const source = await openAssistanceFloat32MonoWaveFileV1(path, sampleRate, byteLength);
	context.after(() => source.close());
	assert.equal(source.sampleCount, sampleCount);
	assert.equal(source.maximumObservedFileReadBytes, 16);
	assert.deepEqual(await source.readSamples(sampleCount - 1_024, 1_024), new Float32Array(1_024));
	assert.ok(source.maximumObservedFileReadBytes <= ASSISTANCE_WAVE_MAXIMUM_FILE_READ_BYTES);
});

async function writeFixture(context: TestContext, bytes: Uint8Array): Promise<string> {
	const path = join(tmpdir(), `soundscaper-wave-reader-${crypto.randomUUID()}.wav`);
	context.after(() => rm(path, { force: true }));
	const handle = await open(path, 'wx', 0o600);
	try { await handle.writeFile(bytes); } finally { await handle.close(); }
	return path;
}
