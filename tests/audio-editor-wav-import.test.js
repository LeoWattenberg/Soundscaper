import assert from 'node:assert/strict';
import test from 'node:test';

import {
	inspectWavBlobPcm,
	streamWavBlobPcm,
} from '../src/lib/tools/audio-editor/wav-import.js';

test('incremental WAV import parses padded RIFF chunks and emits ordered planar packets with backpressure', async () => {
	const blob = createWaveBlob({
		channelCount: 2,
		bitDepth: 16,
		frames: [
			[-32_768, -16_384, 0, 16_384, 32_767],
			[32_767, 16_384, 0, -16_384, -32_768],
		],
		beforeFormat: [{ id: 'JUNK', bytes: Uint8Array.of(1, 2, 3) }],
	});
	const tracked = createTrackingBlob(blob);
	const descriptor = await inspectWavBlobPcm(tracked);

	assert.equal(descriptor.container, 'wav');
	assert.equal(descriptor.encoding, 'pcm-integer');
	assert.equal(descriptor.sampleFormat, 'int16');
	assert.equal(descriptor.sampleRate, 48_000);
	assert.equal(descriptor.channelCount, 2);
	assert.equal(descriptor.frameCount, 5);
	assert.equal(descriptor.blockAlign, 4);
	assert.equal(descriptor.dataByteLength, 20);
	assert.equal(Object.isFrozen(descriptor), true);
	assert.ok(tracked.reads.every(({ byteLength }) => byteLength <= 16));

	let consumers = 0;
	let maximumConsumers = 0;
	const chunks = [];
	const details = [];
	const result = await streamWavBlobPcm(tracked, {
		descriptor,
		chunkFrames: 2,
		onChunk: async (channels, info) => {
			consumers += 1;
			maximumConsumers = Math.max(maximumConsumers, consumers);
			await new Promise((resolve) => setImmediate(resolve));
			chunks.push(channels);
			details.push(info);
			consumers -= 1;
		},
	});

	assert.equal(maximumConsumers, 1);
	assert.deepEqual(chunks.map((channels) => channels[0].length), [2, 2, 1]);
	assert.deepEqual(flattenChannel(chunks, 0), [-1, -0.5, 0, 0.5, 32_767 / 32_768]);
	assert.deepEqual(flattenChannel(chunks, 1), [32_767 / 32_768, 0.5, 0, -0.5, -1]);
	assert.deepEqual(details.map(({ index, frameOffset, frames, final }) => ({ index, frameOffset, frames, final })), [
		{ index: 0, frameOffset: 0, frames: 2, final: false },
		{ index: 1, frameOffset: 2, frames: 2, final: false },
		{ index: 2, frameOffset: 4, frames: 1, final: true },
	]);
	assert.equal(details.every((info) => info.descriptor === descriptor), true);
	assert.equal(result.chunkFrames, 2);
	assert.equal(result.chunkCount, 3);
	assert.equal(Object.isFrozen(result), true);
	const dataReads = tracked.reads.filter(({ start }) => start >= descriptor.dataOffset);
	assert.deepEqual(dataReads.map(({ byteLength }) => byteLength), [8, 8, 4]);
	assert.ok(tracked.reads.every(({ byteLength }) => byteLength < blob.size));
});

test('integer PCM and IEEE float container widths decode to finite Float32 planar samples', async (t) => {
	const fixtures = [
		{ name: 'unsigned 8-bit PCM', formatTag: 1, bitDepth: 8, raw: [0, 128, 255], expected: [-1, 0, 127 / 128], sampleFormat: 'uint8' },
		{ name: 'signed 16-bit PCM', formatTag: 1, bitDepth: 16, raw: [-32_768, -1, 32_767], expected: [-1, -1 / 32_768, 32_767 / 32_768], sampleFormat: 'int16' },
		{ name: 'signed 24-bit PCM', formatTag: 1, bitDepth: 24, raw: [-8_388_608, -1, 8_388_607], expected: [-1, -1 / 8_388_608, 8_388_607 / 8_388_608], sampleFormat: 'int24' },
		{ name: 'signed 32-bit PCM', formatTag: 1, bitDepth: 32, raw: [-2_147_483_648, -1, 2_147_483_647], expected: [-1, -1 / 2_147_483_648, 2_147_483_647 / 2_147_483_648], sampleFormat: 'int32' },
		{ name: '32-bit IEEE float', formatTag: 3, bitDepth: 32, raw: [-1.25, 0.5, Infinity], expected: [-1.25, 0.5, 0], sampleFormat: 'float32' },
		{ name: '64-bit IEEE float', formatTag: 3, bitDepth: 64, raw: [-2.5, 0.1, NaN], expected: [-2.5, Math.fround(0.1), 0], sampleFormat: 'float64' },
	];
	for (const fixture of fixtures) {
		await t.test(fixture.name, async () => {
			const blob = createWaveBlob({
				formatTag: fixture.formatTag,
				bitDepth: fixture.bitDepth,
				frames: [fixture.raw],
			});
			const chunks = [];
			const result = await streamWavBlobPcm(blob, {
				chunkFrames: 2,
				onChunk: (channels) => { chunks.push(channels); },
			});
			assert.equal(result.sampleFormat, fixture.sampleFormat);
			assert.equal(result.encoding, fixture.formatTag === 3 ? 'ieee-float' : 'pcm-integer');
			assert.equal(result.chunkCount, 2);
			assertFloatArray(flattenChannel(chunks, 0), fixture.expected);
		});
	}
});

test('WAVE_FORMAT_EXTENSIBLE accepts canonical PCM and float GUIDs and preserves layout metadata', async () => {
	const pcm = createWaveBlob({
		formatTag: 0xfffe,
		subFormatTag: 1,
		bitDepth: 24,
		validBitsPerSample: 20,
		channelMask: 0x3,
		frames: [[-8_388_608, 8_388_607], [0, -1]],
	});
	const pcmDescriptor = await inspectWavBlobPcm(pcm);
	assert.equal(pcmDescriptor.formatTag, 0xfffe);
	assert.equal(pcmDescriptor.subFormatTag, 1);
	assert.equal(pcmDescriptor.validBitsPerSample, 20);
	assert.equal(pcmDescriptor.channelMask, 0x3);

	const float = createWaveBlob({
		formatTag: 0xfffe,
		subFormatTag: 3,
		bitDepth: 32,
		channelMask: 0x4,
		frames: [[-1.5, 1.5]],
	});
	const chunks = [];
	const floatResult = await streamWavBlobPcm(float, { onChunk: (channels) => { chunks.push(channels); } });
	assert.equal(floatResult.sampleFormat, 'float32');
	assert.equal(floatResult.subFormatTag, 3);
	assert.equal(floatResult.channelMask, 0x4);
	assert.deepEqual(flattenChannel(chunks, 0), [-1.5, 1.5]);
});

test('data chunks before fmt chunks are discovered without reading their payload during inspection', async () => {
	const blob = createWaveBlob({
		bitDepth: 8,
		frames: [[0, 128, 255]],
		dataBeforeFormat: true,
	});
	const tracked = createTrackingBlob(blob);
	const descriptor = await inspectWavBlobPcm(tracked);
	assert.equal(descriptor.dataByteLength, 3);
	assert.equal(tracked.reads.some(({ start }) => start === descriptor.dataOffset), false);

	const chunks = [];
	await streamWavBlobPcm(tracked, {
		descriptor,
		onChunk: (channels) => { chunks.push(channels); },
	});
	assert.deepEqual(flattenChannel(chunks, 0), [-1, 0, 127 / 128]);
});

test('large WAV input is sliced by packet size rather than materialized as one ArrayBuffer', async () => {
	const frameCount = 200_003;
	const frames = [
		Int16Array.from({ length: frameCount }, (_, index) => (index % 65_536) - 32_768),
		Int16Array.from({ length: frameCount }, (_, index) => 32_767 - (index % 65_536)),
	];
	const blob = createWaveBlob({ channelCount: 2, bitDepth: 16, frames });
	const tracked = createTrackingBlob(blob);
	const packetFrames = 4_096;
	let outputFrames = 0;
	let packetCount = 0;
	const result = await streamWavBlobPcm(tracked, {
		chunkFrames: packetFrames,
		onChunk(channels) {
			assert.equal(channels.length, 2);
			assert.ok(channels[0].length <= packetFrames);
			outputFrames += channels[0].length;
			packetCount += 1;
		},
	});

	assert.equal(outputFrames, frameCount);
	assert.equal(packetCount, Math.ceil(frameCount / packetFrames));
	assert.equal(result.chunkCount, packetCount);
	const dataReads = tracked.reads.filter(({ start }) => start >= result.dataOffset);
	assert.equal(dataReads.length, packetCount);
	assert.ok(dataReads.every(({ byteLength }) => byteLength <= packetFrames * result.blockAlign));
	assert.equal(Math.max(...tracked.reads.map(({ byteLength }) => byteLength)), packetFrames * result.blockAlign);
	assert.ok(Math.max(...tracked.reads.map(({ byteLength }) => byteLength)) < blob.size / 10);
});

test('AbortSignal cancellation stops inspection and streaming without reading another packet', async () => {
	const blob = createWaveBlob({ bitDepth: 16, frames: [Int16Array.from({ length: 10 }, (_, index) => index)] });
	const beforeStart = new AbortController();
	beforeStart.abort('cancel before inspection');
	const unread = createTrackingBlob(blob);
	await assert.rejects(
		inspectWavBlobPcm(unread, { signal: beforeStart.signal }),
		(error) => error.name === 'AbortError' && /cancel before inspection/.test(error.message),
	);
	assert.equal(unread.reads.length, 0);

	const controller = new AbortController();
	const tracked = createTrackingBlob(blob);
	let emitted = 0;
	await assert.rejects(
		streamWavBlobPcm(tracked, {
			chunkFrames: 2,
			signal: controller.signal,
			onChunk() {
				emitted += 1;
				controller.abort(new Error('stop after packet'));
			},
		}),
		(error) => error.name === 'AbortError' && /stop after packet/.test(error.message),
	);
	assert.equal(emitted, 1);
	const descriptor = await inspectWavBlobPcm(blob);
	assert.equal(tracked.reads.filter(({ start }) => start >= descriptor.dataOffset).length, 1);
});

test('format and chunk consumers are awaited and failures prevent later PCM reads', async () => {
	const blob = createWaveBlob({ bitDepth: 16, frames: [[1, 2, 3, 4, 5, 6]] });
	const descriptor = await inspectWavBlobPcm(blob);
	const formatFailure = new Error('storage preflight failed');
	const formatTracked = createTrackingBlob(blob);
	await assert.rejects(
		streamWavBlobPcm(formatTracked, {
			descriptor,
			onFormat: async () => { throw formatFailure; },
			onChunk() { assert.fail('PCM must not be emitted'); },
		}),
		formatFailure,
	);
	assert.equal(formatTracked.reads.length, 0);

	const sinkFailure = new Error('disk write failed');
	const sinkTracked = createTrackingBlob(blob);
	await assert.rejects(
		streamWavBlobPcm(sinkTracked, {
			descriptor,
			chunkFrames: 2,
			onChunk: async () => { throw sinkFailure; },
		}),
		sinkFailure,
	);
	assert.equal(sinkTracked.reads.filter(({ start }) => start >= descriptor.dataOffset).length, 1);
});

test('malformed, compressed, truncated, and unsafe WAV structures fail with actionable errors', async (t) => {
	await assert.rejects(inspectWavBlobPcm(null), /Blob or File/);
	await assert.rejects(inspectWavBlobPcm(new Blob([Uint8Array.of(1, 2, 3)])), /too small/);

	const valid = new Uint8Array(await createWaveBlob({ frames: [[0, 1]] }).arrayBuffer());
	await t.test('container signatures', async () => {
		const notRiff = valid.slice();
		writeAscii(notRiff, 0, 'NOPE');
		await assert.rejects(inspectWavBlobPcm(new Blob([notRiff])), /not a RIFF WAV/);
		const rf64 = valid.slice();
		writeAscii(rf64, 0, 'RF64');
		await assert.rejects(inspectWavBlobPcm(new Blob([rf64])), /RF64 WAV files are not supported/);
		const notWave = valid.slice();
		writeAscii(notWave, 8, 'AVI ');
		await assert.rejects(inspectWavBlobPcm(new Blob([notWave])), /not a WAVE/);
	});
	await t.test('missing and truncated chunks', async () => {
		await assert.rejects(inspectWavBlobPcm(createRiffBlob([])), /no format chunk/);
		await assert.rejects(inspectWavBlobPcm(createRiffBlob([{ id: 'fmt ', bytes: createFormatBytes({}) }])), /no data chunk/);
		await assert.rejects(inspectWavBlobPcm(new Blob([valid.subarray(0, valid.length - 1)])), /RIFF payload is truncated/);
		const partialFrame = createRiffBlob([
			{ id: 'fmt ', bytes: createFormatBytes({ channelCount: 2, bitDepth: 16 }) },
			{ id: 'data', bytes: Uint8Array.of(0, 0, 0) },
		]);
		await assert.rejects(inspectWavBlobPcm(partialFrame), /inside an interleaved PCM frame/);
	});
	await t.test('unsupported sample encodings and inconsistent geometry', async () => {
		await assert.rejects(inspectWavBlobPcm(createWaveBlob({ formatTag: 6, bitDepth: 8, frames: [[0]] })), /compressed or unsupported/);
		await assert.rejects(inspectWavBlobPcm(createWaveBlob({ bitDepth: 12, frames: [[0]] })), /bit depth 12 is unsupported/);
		await assert.rejects(inspectWavBlobPcm(createWaveBlob({ blockAlign: 8, frames: [[0]] })), /block alignment/);
		await assert.rejects(inspectWavBlobPcm(createWaveBlob({ byteRate: 1, frames: [[0]] })), /byte rate/);
	});
	await t.test('invalid extensible metadata', async () => {
		const badGuid = new Uint8Array(await createWaveBlob({ formatTag: 0xfffe, subFormatTag: 1, frames: [[0]] }).arrayBuffer());
		const formatOffset = findAscii(badGuid, 'fmt ') + 8;
		badGuid[formatOffset + 39] ^= 0xff;
		await assert.rejects(inspectWavBlobPcm(new Blob([badGuid])), /subformat GUID is unsupported/);
		await assert.rejects(
			inspectWavBlobPcm(createWaveBlob({ formatTag: 0xfffe, subFormatTag: 1, bitDepth: 16, validBitsPerSample: 17, frames: [[0]] })),
			/valid-bits field/,
		);
	});
	await t.test('inspection and packet limits', async () => {
		const manyChunks = createWaveBlob({
			frames: [[0]],
			beforeFormat: [{ id: 'JUNK', bytes: new Uint8Array() }, { id: 'JUNK', bytes: new Uint8Array() }],
		});
		await assert.rejects(inspectWavBlobPcm(manyChunks, { maxRiffChunks: 2 }), /2-chunk inspection limit/);
		await assert.rejects(streamWavBlobPcm(manyChunks, { chunkFrames: 65_537, onChunk() {} }), /chunkFrames/);
		await assert.rejects(streamWavBlobPcm(manyChunks), /onChunk/);
	});
});

test('descriptor reuse validates source size and PCM geometry before reading', async () => {
	const blob = createWaveBlob({ frames: [[0, 1, 2]] });
	const descriptor = await inspectWavBlobPcm(blob);
	await assert.rejects(
		streamWavBlobPcm(new Blob([await blob.arrayBuffer(), Uint8Array.of(0)]), { descriptor, onChunk() {} }),
		/different-sized Blob/,
	);
	await assert.rejects(
		streamWavBlobPcm(blob, { descriptor: { ...descriptor, frameCount: 4 }, onChunk() {} }),
		/descriptor data range is invalid/,
	);
});

function createWaveBlob(options = {}) {
	const channelCount = options.channelCount ?? options.frames?.length ?? 1;
	const bitDepth = options.bitDepth ?? 16;
	const formatTag = options.formatTag ?? 1;
	const frames = options.frames ?? [Int16Array.of(0)];
	if (frames.length !== channelCount) throw new Error('Fixture channel count mismatch.');
	const frameCount = frames[0].length;
	if (frames.some((channel) => channel.length !== frameCount)) throw new Error('Fixture frame count mismatch.');
	const format = createFormatBytes({
		formatTag,
		subFormatTag: options.subFormatTag,
		channelCount,
		sampleRate: options.sampleRate,
		bitDepth,
		validBitsPerSample: options.validBitsPerSample,
		channelMask: options.channelMask,
		blockAlign: options.blockAlign,
		byteRate: options.byteRate,
	});
	const data = encodeFixtureSamples(frames, bitDepth, options.subFormatTag ?? formatTag);
	const formatChunk = { id: 'fmt ', bytes: format };
	const dataChunk = { id: 'data', bytes: data };
	const chunks = [
		...(options.beforeFormat || []),
		...(options.dataBeforeFormat ? [dataChunk, formatChunk] : [formatChunk, dataChunk]),
	];
	return createRiffBlob(chunks);
}

function createFormatBytes(options = {}) {
	const formatTag = options.formatTag ?? 1;
	const channelCount = options.channelCount ?? 1;
	const sampleRate = options.sampleRate ?? 48_000;
	const bitDepth = options.bitDepth ?? 16;
	const bytesPerSample = bitDepth / 8;
	const blockAlign = options.blockAlign ?? channelCount * bytesPerSample;
	const byteRate = options.byteRate ?? sampleRate * blockAlign;
	const extensible = formatTag === 0xfffe;
	const bytes = new Uint8Array(extensible ? 40 : 16);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, formatTag, true);
	view.setUint16(2, channelCount, true);
	view.setUint32(4, sampleRate, true);
	view.setUint32(8, byteRate, true);
	view.setUint16(12, blockAlign, true);
	view.setUint16(14, bitDepth, true);
	if (extensible) {
		view.setUint16(16, 22, true);
		view.setUint16(18, options.validBitsPerSample ?? bitDepth, true);
		view.setUint32(20, options.channelMask ?? 0, true);
		view.setUint32(24, options.subFormatTag ?? 1, true);
		bytes.set([0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 28);
	}
	return bytes;
}

function encodeFixtureSamples(channels, bitDepth, formatTag) {
	const bytesPerSample = bitDepth / 8;
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
			else if (bitDepth === 24) {
				view.setUint8(offset, value & 0xff);
				view.setUint8(offset + 1, (value >> 8) & 0xff);
				view.setUint8(offset + 2, (value >> 16) & 0xff);
			} else if (bitDepth === 32) view.setInt32(offset, value, true);
			offset += bytesPerSample;
		}
	}
	return bytes;
}

function createRiffBlob(chunks) {
	const chunkBytes = chunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.byteLength + (chunk.bytes.byteLength & 1), 0);
	const bytes = new Uint8Array(12 + chunkBytes);
	const view = new DataView(bytes.buffer);
	writeAscii(bytes, 0, 'RIFF');
	view.setUint32(4, bytes.byteLength - 8, true);
	writeAscii(bytes, 8, 'WAVE');
	let offset = 12;
	for (const chunk of chunks) {
		writeAscii(bytes, offset, chunk.id);
		view.setUint32(offset + 4, chunk.bytes.byteLength, true);
		bytes.set(chunk.bytes, offset + 8);
		offset += 8 + chunk.bytes.byteLength + (chunk.bytes.byteLength & 1);
	}
	return new Blob([bytes], { type: 'audio/wav' });
}

function createTrackingBlob(blob) {
	const reads = [];
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

function flattenChannel(chunks, channel) {
	return chunks.flatMap((channels) => [...channels[channel]]);
}

function assertFloatArray(actual, expected, tolerance = 1e-7) {
	assert.equal(actual.length, expected.length);
	for (let index = 0; index < expected.length; index += 1) {
		assert.ok(Math.abs(actual[index] - expected[index]) <= tolerance, `${actual[index]} != ${expected[index]} at ${index}`);
	}
}

function writeAscii(bytes, offset, value) {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function findAscii(bytes, needle) {
	for (let offset = 0; offset <= bytes.length - needle.length; offset += 1) {
		if (needle.split('').every((character, index) => bytes[offset + index] === character.charCodeAt(0))) return offset;
	}
	return -1;
}
