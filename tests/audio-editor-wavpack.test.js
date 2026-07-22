import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { auditWavPackWasm } from '../scripts/audit-wavpack-wasm.mjs';
import {
	PCM_CONTAINER_FOOTER_BYTES,
	PCM_CONTAINER_HEADER_BYTES,
	PCM_ENCODING_RAW_F32LE,
	PCM_ENCODING_WAVPACK_F32_V1,
	PcmContainerWriter,
	crc32,
	encodePcmAdaptively,
	loadWavPackWasm,
	packPlanarFloat32,
	parsePcmContainerIndex,
	readPcmContainerPayload,
	unpackPlanarFloat32,
} from '../src/common/editor/wavpack/index.js';

const WASM_PATH = new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url);

test('the pinned WavPack artifact has the audited narrow ABI and memory budget', async () => {
	const audit = await auditWavPackWasm();
	assert.deepEqual(audit.findings, []);
	assert.equal(audit.ok, true);
	assert.equal(audit.wasmSha256, 'c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908');
	assert.ok(audit.wasmBytes > 0 && audit.wasmBytes < 1024 * 1024);
});

test('WavPack preserves float32 sample bits for edge values and 1/2/8/64-channel chunks', async () => {
	const runtime = await loadRuntime();
	for (const channelCount of [1, 2, 8]) {
		const frames = 65_536;
		const raw = structuredPcm(frames, channelCount);
		const encoded = encodePcmAdaptively(raw, {
			frames,
			channelCount,
			sampleRate: 48_000,
			runtime,
		});
		assert.equal(encoded.encoding, PCM_ENCODING_WAVPACK_F32_V1);
		const decoded = runtime.decode(encoded.payload, { frames, channelCount, sampleRate: 48_000 });
		assert.deepEqual(new Uint32Array(decoded), new Uint32Array(raw));
	}

	const frames = 65_536;
	const channelCount = 64;
	const raw = new ArrayBuffer(frames * channelCount * 4);
	const encoded = encodePcmAdaptively(raw, {
		frames,
		channelCount,
		sampleRate: 48_000,
		runtime,
	});
	assert.equal(encoded.encoding, PCM_ENCODING_WAVPACK_F32_V1);
	assert.ok(encoded.payload.byteLength < raw.byteLength / 1000);
	assert.deepEqual(
		new Uint32Array(runtime.decode(encoded.payload, { frames, channelCount, sampleRate: 48_000 })),
		new Uint32Array(raw),
	);
	assert.ok(runtime.memory.buffer.byteLength <= 128 * 1024 * 1024);

	const shortFrames = 4_097;
	const seeded = new ArrayBuffer(shortFrames * 2 * Float32Array.BYTES_PER_ELEMENT);
	const seededSamples = new Float32Array(seeded);
	let state = 0x6d2b79f5;
	for (let index = 0; index < seededSamples.length; index += 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		seededSamples[index] = ((state >>> 28) - 8) / 8;
	}
	const shortEncoded = encodePcmAdaptively(seeded, {
		frames: shortFrames,
		channelCount: 2,
		sampleRate: 44_100,
		runtime,
	});
	assert.equal(shortEncoded.encoding, PCM_ENCODING_WAVPACK_F32_V1);
	assert.deepEqual(
		new Uint32Array(runtime.decode(shortEncoded.payload, {
			frames: shortFrames,
			channelCount: 2,
			sampleRate: 44_100,
		})),
		new Uint32Array(seeded),
	);
});

test('adaptive encoding keeps tiny and incompressible PCM raw', async () => {
	const runtime = await loadRuntime();
	const tiny = packPlanarFloat32([Float32Array.of(-0, 1, -1, Number.NaN)]);
	const tinyResult = encodePcmAdaptively(tiny, {
		frames: 4,
		channelCount: 1,
		sampleRate: 48_000,
		runtime,
	});
	assert.equal(tinyResult.encoding, PCM_ENCODING_RAW_F32LE);
	assert.deepEqual(new Uint32Array(tinyResult.payload), new Uint32Array(tiny));

	const frames = 65_536;
	const noise = new ArrayBuffer(frames * 4);
	const bits = new Uint32Array(noise);
	let state = 0x9e3779b9;
	for (let index = 0; index < bits.length; index += 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		bits[index] = state >>> 0;
	}
	const noiseResult = encodePcmAdaptively(noise, {
		frames,
		channelCount: 1,
		sampleRate: 48_000,
		runtime,
	});
	assert.equal(noiseResult.encoding, PCM_ENCODING_RAW_F32LE);
	assert.strictEqual(noiseResult.payload, noise);
});

test('the indexed PCM container validates geometry, CRCs, truncation, and random payload bounds', async () => {
	const runtime = await loadRuntime();
	const writable = memoryWritable();
	const writer = new PcmContainerWriter(writable, {
		channelCount: 2,
		sampleRate: 48_000,
		chunkFrames: 65_536,
	});
	const first = structuredPcm(65_536, 2);
	const firstStored = encodePcmAdaptively(first, {
		frames: 65_536,
		channelCount: 2,
		sampleRate: 48_000,
		runtime,
	});
	const second = packPlanarFloat32([
		Float32Array.of(0.25, -0),
		Float32Array.of(-0.25, 1),
	]);
	await writer.write({ ...firstStored, frames: 65_536 });
	await writer.write({
		encoding: PCM_ENCODING_RAW_F32LE,
		payload: second,
		frames: 2,
		pcmCrc32: crc32(second),
	});
	const statistics = await writer.close();
	assert.equal(statistics.wavpackChunkCount, 1);
	assert.equal(statistics.rawChunkCount, 1);
	const file = writable.file();
	const index = await parsePcmContainerIndex(file, {
		expectedChannelCount: 2,
		expectedSampleRate: 48_000,
		expectedChunkFrames: 65_536,
		expectedChunkCount: 2,
		expectedFrameCount: 65_538,
	});
	assert.equal(index.entries.length, 2);
	assert.equal(index.entries[0].offset, PCM_CONTAINER_HEADER_BYTES);
	const randomPayload = await readPcmContainerPayload(file, index.entries[1]);
	assert.deepEqual(
		unpackPlanarFloat32(randomPayload, 2, 2).map((channel) => [...channel]),
		[[0.25, -0], [-0.25, 1]],
	);

	const original = new Uint8Array(await file.arrayBuffer());
	for (const mutation of [
		(bytes) => { bytes[0] ^= 1; },
		(bytes) => { bytes[bytes.length - PCM_CONTAINER_FOOTER_BYTES] ^= 1; },
		(bytes) => { bytes[bytes.length - PCM_CONTAINER_FOOTER_BYTES - 1] ^= 1; },
	]) {
		const corrupted = original.slice();
		mutation(corrupted);
		await assert.rejects(parsePcmContainerIndex(new Blob([corrupted])), /container|CRC|magic/i);
	}
	await assert.rejects(
		parsePcmContainerIndex(file.slice(0, file.size - 1)),
		/truncated|footer|bounds/i,
	);

	const footerOffset = original.byteLength - PCM_CONTAINER_FOOTER_BYTES;
	const footerView = new DataView(original.buffer, footerOffset, PCM_CONTAINER_FOOTER_BYTES);
	const indexOffset = Number(footerView.getBigUint64(16, true));
	const invalidOffset = original.slice();
	const invalidOffsetView = new DataView(invalidOffset.buffer);
	invalidOffsetView.setBigUint64(indexOffset, BigInt(PCM_CONTAINER_HEADER_BYTES + 1), true);
	refreshContainerChecksums(invalidOffset, indexOffset, footerOffset);
	await assert.rejects(
		parsePcmContainerIndex(new Blob([invalidOffset])),
		/index entry|contiguous|bounds/i,
	);

	const oversizedDeclaration = original.slice();
	const oversizedFooter = new DataView(
		oversizedDeclaration.buffer,
		footerOffset,
		PCM_CONTAINER_FOOTER_BYTES,
	);
	oversizedFooter.setUint32(12, 0xffffffff, true);
	oversizedFooter.setUint32(
		28,
		crc32(oversizedDeclaration.subarray(footerOffset, footerOffset + 28)),
		true,
	);
	await assert.rejects(
		parsePcmContainerIndex(new Blob([oversizedDeclaration])),
		/index bounds/i,
	);

	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		parsePcmContainerIndex(file, { signal: controller.signal }),
		{ name: 'AbortError' },
	);
});

test('corrupted WavPack blocks and invalid declarations fail closed', async () => {
	const runtime = await loadRuntime();
	const frames = 65_536;
	const raw = structuredPcm(frames, 2);
	const encoded = encodePcmAdaptively(raw, {
		frames,
		channelCount: 2,
		sampleRate: 48_000,
		runtime,
	});
	const corrupted = new Uint8Array(encoded.payload.slice(0));
	corrupted[Math.floor(corrupted.length / 2)] ^= 0x40;
	assert.throws(
		() => runtime.decode(corrupted, { frames, channelCount: 2, sampleRate: 48_000 }),
		/WavPack|checksum|invalid/i,
	);
	assert.throws(
		() => runtime.decode(encoded.payload, {
			frames,
			channelCount: 1,
			sampleRate: 48_000,
		}),
		/geometry|channel|WavPack/i,
	);
	assert.throws(
		() => runtime.encode(raw, {
			frames: 65_537,
			channelCount: 2,
			sampleRate: 48_000,
			maximumOutputBytes: raw.byteLength,
		}),
		/frames/i,
	);
});

let runtimePromise;

function loadRuntime() {
	runtimePromise ||= readFile(WASM_PATH).then((bytes) => loadWavPackWasm(bytes));
	return runtimePromise;
}

function structuredPcm(frames, channelCount) {
	const raw = new ArrayBuffer(frames * channelCount * 4);
	const bits = new Uint32Array(raw);
	const edgeBits = [
		0x00000000,
		0x80000000,
		0x00000001,
		0x80000001,
		0x007fffff,
		0x807fffff,
		0x7f800000,
		0xff800000,
		0x7fc12345,
	];
	for (let channel = 0; channel < channelCount; channel += 1) {
		for (let frame = 0; frame < frames; frame += 1) {
			const index = channel * frames + frame;
			if (frame < edgeBits.length) bits[index] = edgeBits[frame];
			else if (frame % 256 === 0) {
				bits[index] = new Uint32Array(Float32Array.of(
					Math.sin(2 * Math.PI * frame / 257) * (channel + 1) / channelCount,
				).buffer)[0];
			}
		}
	}
	return raw;
}

function memoryWritable() {
	const parts = [];
	let closed = false;
	return {
		async write(part) {
			assert.equal(closed, false);
			parts.push(part);
		},
		async close() {
			closed = true;
		},
		file() {
			assert.equal(closed, true);
			return new Blob(parts);
		},
	};
}

function refreshContainerChecksums(bytes, indexOffset, footerOffset) {
	const footer = new DataView(bytes.buffer, footerOffset, PCM_CONTAINER_FOOTER_BYTES);
	footer.setUint32(24, crc32(bytes.subarray(indexOffset, footerOffset)), true);
	footer.setUint32(28, crc32(bytes.subarray(footerOffset, footerOffset + 28)), true);
}
