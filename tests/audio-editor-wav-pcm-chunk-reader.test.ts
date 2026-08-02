import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import {
	createWavBlobPcmChunkReader,
	type WavBlobPcmSource,
} from '../src/common/editor/wav-pcm-chunk-reader.ts';

interface BlobRead {
	readonly start: number;
	readonly end: number;
	readonly byteLength: number;
}

interface TrackingSource extends WavBlobPcmSource {
	readonly reads: BlobRead[];
}

type SampleValue = number;

test('random-access WAV PCM reads are exact, out of order, and bounded to one chunk', async () => {
	const blob = createWaveBlob({
		bitDepth: 16,
		channels: [
			[-32_768, -16_384, 0, 16_384, 32_767],
			[32_767, 16_384, 0, -16_384, -32_768],
		],
	});
	const descriptor = await inspectWavBlobPcm(blob);
	const source = trackingSource(blob);
	const reader = createWavBlobPcmChunkReader(source, { descriptor, chunkFrames: 2 });

	assert.equal(reader.descriptor, descriptor);
	assert.equal(reader.chunkFrames, 2);
	assert.equal(reader.chunkCount, 3);
	assert.equal(Object.isFrozen(reader), true);

	const final = await reader.readChunk(2);
	const first = await reader.readChunk(0);
	const middle = await reader.readChunk(1);
	assert.deepEqual(chunkDetails(final), { index: 2, frameOffset: 4, frames: 1, final: true });
	assert.deepEqual(chunkDetails(first), { index: 0, frameOffset: 0, frames: 2, final: false });
	assert.deepEqual(chunkDetails(middle), { index: 1, frameOffset: 2, frames: 2, final: false });
	assert.equal(final.descriptor, descriptor);
	assertFloatArray(final.channels[0], [32_767 / 32_768]);
	assertFloatArray(final.channels[1], [-1]);
	assertFloatArray(first.channels[0], [-1, -0.5]);
	assertFloatArray(middle.channels[1], [0, -0.5]);
	assert.deepEqual(source.reads.map(({ start, byteLength }) => ({ start, byteLength })), [
		{ start: descriptor.dataOffset + 16, byteLength: 4 },
		{ start: descriptor.dataOffset, byteLength: 8 },
		{ start: descriptor.dataOffset + 8, byteLength: 8 },
	]);
	assert.ok(source.reads.every(({ byteLength }) => byteLength < blob.size));

	await assert.rejects(reader.readChunk(3), /chunk index.*0.*2/iu);
	assert.equal(source.reads.length, 3);
});

test('random-access decoding preserves maintained integer and IEEE float sample formats', async (t) => {
	const fixtures = [
		{ name: 'unsigned 8-bit PCM', formatTag: 1, bitDepth: 8, raw: [0, 128, 255], expected: [-1, 0, 127 / 128] },
		{ name: 'signed 16-bit PCM', formatTag: 1, bitDepth: 16, raw: [-32_768, -1, 32_767], expected: [-1, -1 / 32_768, 32_767 / 32_768] },
		{ name: 'signed 20-bit PCM container', formatTag: 1, bitDepth: 20, raw: [-8_388_608, -1, 8_388_607], expected: [-1, -1 / 8_388_608, 8_388_607 / 8_388_608] },
		{ name: 'signed 24-bit PCM', formatTag: 1, bitDepth: 24, raw: [-8_388_608, -1, 8_388_607], expected: [-1, -1 / 8_388_608, 8_388_607 / 8_388_608] },
		{ name: 'signed 32-bit PCM', formatTag: 1, bitDepth: 32, raw: [-2_147_483_648, -1, 2_147_483_647], expected: [-1, -1 / 2_147_483_648, 2_147_483_647 / 2_147_483_648] },
		{ name: '32-bit IEEE float', formatTag: 3, bitDepth: 32, raw: [-1.25, 0.5, Infinity], expected: [-1.25, 0.5, 0] },
		{ name: '64-bit IEEE float', formatTag: 3, bitDepth: 64, raw: [-2.5, 0.1, Number.NaN], expected: [-2.5, Math.fround(0.1), 0] },
	] as const;
	for (const fixture of fixtures) {
		await t.test(fixture.name, async () => {
			const blob = createWaveBlob({
				formatTag: fixture.formatTag,
				bitDepth: fixture.bitDepth,
				channels: [[...fixture.raw]],
			});
			const descriptor = await inspectWavBlobPcm(blob);
			const reader = createWavBlobPcmChunkReader(blob, { descriptor, chunkFrames: 2 });
			const first = await reader.readChunk(0);
			const final = await reader.readChunk(1);
			assertFloatArray([...first.channels[0], ...final.channels[0]], fixture.expected);
			assert.equal(final.frames, 1);
			assert.equal(final.final, true);
		});
	}
});

test('RF64 integer and IEEE float descriptors drive the same bounded random-access reader', async (t) => {
	for (const fixture of [
		{ name: 'integer PCM', formatTag: 1, bitDepth: 24, raw: [-8_388_608, 0, 8_388_607], expected: [-1, 0, 8_388_607 / 8_388_608] },
		{ name: 'IEEE float', formatTag: 3, bitDepth: 32, raw: [-0.25, 0.5, 1.25], expected: [-0.25, 0.5, 1.25] },
	] as const) {
		await t.test(fixture.name, async () => {
			const blob = createWaveBlob({
				container: 'rf64',
				formatTag: fixture.formatTag,
				bitDepth: fixture.bitDepth,
				channels: [[...fixture.raw]],
			});
			const descriptor = await inspectWavBlobPcm(blob);
			const source = trackingSource(blob);
			const reader = createWavBlobPcmChunkReader(source, { descriptor, chunkFrames: 2 });
			const final = await reader.readChunk(1);
			const first = await reader.readChunk(0);
			assertFloatArray([...first.channels[0], ...final.channels[0]], fixture.expected);
			assert.deepEqual(source.reads.map(({ byteLength }) => byteLength), [descriptor.blockAlign, descriptor.blockAlign * 2]);
		});
	}
});

test('descriptor reuse rejects source and geometry drift before any PCM read', async () => {
	const blob = createWaveBlob({ bitDepth: 16, channels: [[-1, 0, 1]] });
	const descriptor = await inspectWavBlobPcm(blob);
	const source = trackingSource(blob);

	assert.throws(
		() => createWavBlobPcmChunkReader({ ...source, size: source.size + 1 }, { descriptor }),
		/different-sized Blob/,
	);
	assert.throws(
		() => createWavBlobPcmChunkReader(source, { descriptor: { ...descriptor, frameCount: 4 } }),
		/descriptor data range is invalid/,
	);
	assert.throws(
		() => createWavBlobPcmChunkReader(source, { descriptor: { ...descriptor, blockAlign: 1 } }),
		/descriptor data range is invalid/,
	);
	assert.throws(
		() => createWavBlobPcmChunkReader(source, { descriptor, chunkFrames: 65_537 }),
		/chunkFrames/,
	);
	assert.equal(source.reads.length, 0);
});

test('random-access reads observe AbortSignal before and after a pending slice', async () => {
	const blob = createWaveBlob({ bitDepth: 16, channels: [[-1, 0, 1]] });
	const descriptor = await inspectWavBlobPcm(blob);
	const before = new AbortController();
	const beforeReason = new DOMException('cancel before read', 'AbortError');
	before.abort(beforeReason);
	const source = trackingSource(blob);
	const reader = createWavBlobPcmChunkReader(source, { descriptor });
	await assert.rejects(reader.readChunk(0, { signal: before.signal }), (error: unknown) => error === beforeReason);
	assert.equal(source.reads.length, 0);

	let release!: () => void;
	let markStarted!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const started = new Promise<void>((resolve) => { markStarted = resolve; });
	const pendingSource = delayedSource(blob, gate, markStarted);
	const pendingReader = createWavBlobPcmChunkReader(pendingSource, { descriptor });
	const during = new AbortController();
	const duringReason = new DOMException('cancel pending read', 'AbortError');
	const pending = pendingReader.readChunk(0, { signal: during.signal });
	await started;
	during.abort(duringReason);
	release();
	await assert.rejects(pending, (error: unknown) => error === duringReason);
	assert.equal(pendingSource.reads.length, 1);
});

function chunkDetails(chunk: Readonly<{ index: number; frameOffset: number; frames: number; final: boolean }>) {
	return { index: chunk.index, frameOffset: chunk.frameOffset, frames: chunk.frames, final: chunk.final };
}

function createWaveBlob(options: Readonly<{
	container?: 'riff' | 'rf64';
	formatTag?: 1 | 3;
	bitDepth?: 8 | 16 | 20 | 24 | 32 | 64;
	channels: readonly (readonly SampleValue[])[];
}>): Blob {
	const container = options.container ?? 'riff';
	const formatTag = options.formatTag ?? 1;
	const bitDepth = options.bitDepth ?? 16;
	const channelCount = options.channels.length;
	const frameCount = options.channels[0]?.length ?? 0;
	if (!channelCount || !frameCount || options.channels.some((channel) => channel.length !== frameCount)) {
		throw new Error('Invalid WAV fixture geometry.');
	}
	const bytesPerSample = Math.ceil(bitDepth / 8);
	const blockAlign = channelCount * bytesPerSample;
	const format = new Uint8Array(16);
	const formatView = new DataView(format.buffer);
	formatView.setUint16(0, formatTag, true);
	formatView.setUint16(2, channelCount, true);
	formatView.setUint32(4, 48_000, true);
	formatView.setUint32(8, 48_000 * blockAlign, true);
	formatView.setUint16(12, blockAlign, true);
	formatView.setUint16(14, bitDepth, true);
	const data = encodeSamples(options.channels, bitDepth, formatTag);
	const ds64Bytes = container === 'rf64' ? 36 : 0;
	const byteLength = 12 + ds64Bytes + 8 + format.byteLength + 8 + data.byteLength + (data.byteLength & 1);
	const bytes = new Uint8Array(byteLength);
	const view = new DataView(bytes.buffer);
	writeAscii(bytes, 0, container === 'rf64' ? 'RF64' : 'RIFF');
	view.setUint32(4, container === 'rf64' ? 0xffff_ffff : byteLength - 8, true);
	writeAscii(bytes, 8, 'WAVE');
	let offset = 12;
	if (container === 'rf64') {
		writeAscii(bytes, offset, 'ds64');
		view.setUint32(offset + 4, 28, true);
		view.setBigUint64(offset + 8, BigInt(byteLength - 8), true);
		view.setBigUint64(offset + 16, BigInt(data.byteLength), true);
		view.setBigUint64(offset + 24, BigInt(frameCount), true);
		view.setUint32(offset + 32, 0, true);
		offset += 36;
	}
	writeAscii(bytes, offset, 'fmt ');
	view.setUint32(offset + 4, format.byteLength, true);
	bytes.set(format, offset + 8);
	offset += 8 + format.byteLength;
	writeAscii(bytes, offset, 'data');
	view.setUint32(offset + 4, container === 'rf64' ? 0xffff_ffff : data.byteLength, true);
	bytes.set(data, offset + 8);
	return new Blob([bytes], { type: 'audio/wav' });
}

function encodeSamples(
	channels: readonly (readonly SampleValue[])[],
	bitDepth: 8 | 16 | 20 | 24 | 32 | 64,
	formatTag: 1 | 3,
): Uint8Array {
	const bytesPerSample = Math.ceil(bitDepth / 8);
	const bytes = new Uint8Array(channels[0].length * channels.length * bytesPerSample);
	const view = new DataView(bytes.buffer);
	let offset = 0;
	for (let frame = 0; frame < channels[0].length; frame += 1) {
		for (const channel of channels) {
			const value = channel[frame];
			if (formatTag === 3 && bitDepth === 32) view.setFloat32(offset, value, true);
			else if (formatTag === 3 && bitDepth === 64) view.setFloat64(offset, value, true);
			else if (bitDepth === 8) view.setUint8(offset, value);
			else if (bitDepth === 16) view.setInt16(offset, value, true);
			else if (bitDepth === 20 || bitDepth === 24) {
				view.setUint8(offset, value & 0xff);
				view.setUint8(offset + 1, (value >> 8) & 0xff);
				view.setUint8(offset + 2, (value >> 16) & 0xff);
			} else view.setInt32(offset, value, true);
			offset += bytesPerSample;
		}
	}
	return bytes;
}

function trackingSource(blob: Blob): TrackingSource {
	const reads: BlobRead[] = [];
	return {
		size: blob.size,
		reads,
		slice(start, end) {
			const part = blob.slice(start, end);
			return {
				async arrayBuffer() {
					const buffer = await part.arrayBuffer();
					reads.push({ start, end, byteLength: buffer.byteLength });
					return buffer;
				},
			};
		},
	};
}

function delayedSource(blob: Blob, gate: Promise<void>, markStarted: () => void): TrackingSource {
	const reads: BlobRead[] = [];
	return {
		size: blob.size,
		reads,
		slice(start, end) {
			const part = blob.slice(start, end);
			return {
				async arrayBuffer() {
					markStarted();
					await gate;
					const buffer = await part.arrayBuffer();
					reads.push({ start, end, byteLength: buffer.byteLength });
					return buffer;
				},
			};
		},
	};
}

function assertFloatArray(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 1e-7): void {
	assert.equal(actual.length, expected.length);
	for (let index = 0; index < expected.length; index += 1) {
		assert.ok(Math.abs(actual[index] - expected[index]) <= tolerance, `${actual[index]} != ${expected[index]} at ${index}`);
	}
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}
