/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import { LinkedAudioOriginalSourceReader } from '../src/common/editor/storage/linked-audio-original-source-reader.ts';
import {
	LinkedOriginalResolver,
	type LinkedOriginalPort,
} from '../src/common/editor/storage/linked-original-resolver.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const LOCATOR_ID = 'locator_audio_range_00000001';
const LOCATOR_REVISION = 'snapshot_audio_range_000001';
const MAXIMUM_RANGE_BYTES = 4 * 1024 * 1024;

test('linked WAV reads verify and decode through bounded exact ranges without another whole Blob', async () => {
	const frameCount = 1_100_000;
	const samples = new Float32Array(frameCount);
	samples[65_536] = 0.25;
	samples[65_537] = -0.5;
	const body = waveBlob([samples]);
	assert.ok(body.size > MAXIMUM_RANGE_BYTES);
	const fixture = await rangeFixture(body, audioSource({ frameCount }));

	const chunk = await fixture.reader.chunk('physical-audio', 1);

	assert.equal(fixture.materializedLoads, 1, 'only initial binding may materialize the WAV');
	assert.deepEqual([...chunk.channels[0].slice(0, 2)], [0.25, -0.5]);
	assert.equal(fixture.releases, 1);
	assert.deepEqual(fixture.ranges.slice(0, 2), [
		{ offset: 0, length: MAXIMUM_RANGE_BYTES },
		{ offset: MAXIMUM_RANGE_BYTES, length: body.size - MAXIMUM_RANGE_BYTES },
	], 'the complete digest must precede WAV parsing in bounded ranges');
	assert.ok(fixture.ranges.every(({ length }) => length <= MAXIMUM_RANGE_BYTES));
});

test('linked WAV range sessions release exactly once when sequential reading ends early', async () => {
	const body = waveBlob([Float32Array.of(-1, -0.5, 0, 0.5, 1)]);
	const fixture = await rangeFixture(body, audioSource({ frameCount: 5, chunkFrames: 2 }));
	const iterator = fixture.reader.chunks('physical-audio')[Symbol.asyncIterator]();

	assert.deepEqual(chunkShape((await iterator.next()).value), { index: 0, frames: 2 });
	await iterator.return?.(undefined);

	assert.equal(fixture.releases, 1);
	assert.equal(fixture.materializedLoads, 1);
});

test('a binding replacement during the PCM range read rejects stale samples and releases once', async () => {
	const body = waveBlob([Float32Array.of(-1, 0, 1)]);
	let replaceBinding: (() => Promise<boolean>) | null = null;
	let replaced = false;
	const fixture = await rangeFixture(body, audioSource(), {
		async afterRange({ offset }) {
			if (offset !== 44 || replaced) return;
			replaced = true;
			assert.equal(await replaceBinding?.(), true);
		},
	});
	replaceBinding = fixture.replaceBinding;

	await assert.rejects(
		fixture.reader.chunk('physical-audio', 0),
		/binding.*changed|changed.*binding/iu,
	);

	assert.equal(replaced, true, 'the binding must change after verification at the PCM read boundary');
	assert.equal(fixture.releases, 1);
	assert.equal(fixture.materializedLoads, 1);
});

test('a real RF64 integer-PCM body inspects and decodes end-to-end through ranges', async () => {
	const body = rf64Int16WaveBlob([-32_768, -16_384, 0, 16_384, 32_767]);
	const fixture = await rangeFixture(body, audioSource({
		mimeType: 'audio/rf64',
		frameCount: 5,
		chunkFrames: 2,
	}));

	const chunk = await fixture.reader.chunk('physical-audio', 2);

	assert.deepEqual([...chunk.channels[0]], [32_767 / 32_768]);
	assert.equal(fixture.materializedLoads, 1);
	assert.equal(fixture.releases, 1);
	assert.ok(fixture.ranges.some(({ offset }) => offset === 88), 'RF64 PCM must be read after ds64 inspection');
	assert.ok(fixture.ranges.every(({ length }) => length <= MAXIMUM_RANGE_BYTES));
});

test('a real BW64 body in a canonical WAV file inspects and decodes through ranges', async () => {
	const body = bw64Int16WaveBlob([-1, -0.5, 0, 0.5, 32_767 / 32_768]);
	const fixture = await rangeFixture(body, audioSource({ frameCount: 5, chunkFrames: 2 }));

	const chunk = await fixture.reader.chunk('physical-audio', 2);

	assert.deepEqual([...chunk.channels[0]], [32_767 / 32_768]);
	assert.equal(fixture.materializedLoads, 1);
	assert.equal(fixture.releases, 1);
	assert.ok(fixture.ranges.some(({ offset }) => offset === 88), 'BW64 PCM must be read after ds64 inspection');
	assert.ok(fixture.ranges.every(({ length }) => length <= MAXIMUM_RANGE_BYTES));
});

test('an available range port fails closed and releases once for unavailable or corrupt snapshots', async (context) => {
	await context.test('unavailable exact revision', async () => {
		const body = waveBlob([Float32Array.of(-1, 0, 1)]);
		const fixture = await rangeFixture(body, audioSource(), { unavailable: true });

		await assert.rejects(
			fixture.reader.chunk('physical-audio', 0),
			/unavailable|changed/iu,
		);
		assert.equal(fixture.materializedLoads, 1, 'range unavailability must not fall back to a whole Blob');
		assert.equal(fixture.releases, 0, 'an unavailable lease owns no resource');
	});

	await context.test('digest mismatch', async () => {
		const body = waveBlob([Float32Array.of(-1, 0, 1)]);
		const corruptBytes = new Uint8Array(await body.arrayBuffer());
		corruptBytes[corruptBytes.length - 1] ^= 0xff;
		const corrupt = new Blob([corruptBytes], { type: body.type });
		const fixture = await rangeFixture(body, audioSource(), { rangeBody: corrupt });

		await assert.rejects(
			fixture.reader.chunk('physical-audio', 0),
			/SHA-256|digest/iu,
		);
		assert.equal(fixture.releases, 1);
		assert.equal(fixture.materializedLoads, 1);
	});
});

test('range verification cancellation preserves the reason and releases exactly once', async () => {
	const body = waveBlob([Float32Array.of(-1, 0, 1)]);
	const controller = new AbortController();
	const reason = new Error('cancel linked WAV range verification');
	const fixture = await rangeFixture(body, audioSource(), {
		afterRange: () => controller.abort(reason),
	});

	await assert.rejects(
		fixture.reader.chunk('physical-audio', 0, { signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.equal(fixture.releases, 1);
	assert.equal(fixture.materializedLoads, 1);
});

async function rangeFixture(
	materializedBody: Blob,
	source: ReturnType<typeof audioSource>,
	options: Readonly<{
		afterRange?: (
			request: Readonly<{ offset: number; length: number }>,
		) => PromiseLike<void> | void;
		rangeBody?: Blob;
		unavailable?: boolean;
	}> = {},
) {
	const rangeBody = options.rangeBody ?? materializedBody;
	const rangeBytes = new Uint8Array(await rangeBody.arrayBuffer());
	const ranges: Array<{ offset: number; length: number }> = [];
	let materializedLoads = 0;
	let releases = 0;
	const port: LinkedOriginalPort = {
		load(_kind, _locatorId, { expectedRevision }) {
			materializedLoads += 1;
			return { blob: materializedBody, locatorRevision: expectedRevision ?? LOCATOR_REVISION };
		},
		leaseRange(_kind, _locatorId, { expectedRevision }) {
			if (options.unavailable) return null;
			return Object.freeze({
				locatorRevision: expectedRevision,
				byteLength: rangeBody.size,
				mimeType: rangeBody.type,
				async readRange(request: Readonly<{ offset: number; length: number }>) {
					ranges.push({ offset: request.offset, length: request.length });
					const bytes = rangeBytes.slice(request.offset, request.offset + request.length);
					await options.afterRange?.(request);
					return bytes;
				},
				release() { releases += 1; },
			});
		},
	};
	const memory = getMemoryDatabase(`linked-audio-range-${Date.now()}-${Math.random()}`);
	const bindings = new LinkedOriginalRepository({ memory, database: async () => null }, {
		now: () => new Date('2026-08-03T10:11:12.345Z'),
		createBindingToken: (() => {
			let token = 0;
			return () => `binding_audio_range_${String(++token).padStart(6, '0')}`;
		})(),
	});
	const resolver = new LinkedOriginalResolver(bindings, port);
	const binding = await resolver.bind('project-audio', source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
	});
	if (binding.kind !== 'audio') throw new Error('Expected one linked-audio binding fixture.');
	const reader = new LinkedAudioOriginalSourceReader({ bindings, resolver });
	return {
		reader,
		ranges,
		async replaceBinding(): Promise<boolean> {
			const { bindingToken, boundAt: _boundAt, ...input } = binding;
			return await bindings.putIfCurrent(input, bindingToken) !== null;
		},
		get materializedLoads() { return materializedLoads; },
		get releases() { return releases; },
	};
}

function waveBlob(channels: readonly Float32Array[]): Blob {
	const encoded = encodeWav(channels, {
		float: true,
		dither: false,
		sampleRate: 48_000,
	});
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	return new Blob([bytes], { type: 'audio/wav' });
}

function rf64Int16WaveBlob(samples: readonly number[]): Blob {
	const data = new Uint8Array(samples.length * 2);
	const dataView = new DataView(data.buffer);
	samples.forEach((sample, index) => dataView.setInt16(index * 2, sample, true));
	const bytes = new Uint8Array(80 + data.byteLength);
	const view = new DataView(bytes.buffer);
	writeAscii(bytes, 0, 'RF64');
	view.setUint32(4, 0xffff_ffff, true);
	writeAscii(bytes, 8, 'WAVE');
	writeAscii(bytes, 12, 'ds64');
	view.setUint32(16, 28, true);
	view.setBigUint64(20, BigInt(bytes.byteLength - 8), true);
	view.setBigUint64(28, BigInt(data.byteLength), true);
	view.setBigUint64(36, BigInt(samples.length), true);
	view.setUint32(44, 0, true);
	writeAscii(bytes, 48, 'fmt ');
	view.setUint32(52, 16, true);
	view.setUint16(56, 1, true);
	view.setUint16(58, 1, true);
	view.setUint32(60, 48_000, true);
	view.setUint32(64, 96_000, true);
	view.setUint16(68, 2, true);
	view.setUint16(70, 16, true);
	writeAscii(bytes, 72, 'data');
	view.setUint32(76, 0xffff_ffff, true);
	bytes.set(data, 80);
	return new Blob([bytes], { type: 'audio/rf64' });
}

function bw64Int16WaveBlob(samples: readonly number[]): Blob {
	const encoded = encodeWav([Float32Array.from(samples)], {
		container: 'bw64',
		bitDepth: 16,
		dither: 'none',
		sampleRate: 48_000,
	});
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	return new Blob([bytes], { type: 'audio/wav' });
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		bytes[offset + index] = value.charCodeAt(index);
	}
}

function audioSource(overrides: Readonly<Record<string, unknown>> = {}) {
	return Object.freeze({
		kind: 'audio' as const,
		id: 'source-audio',
		storageKey: 'physical-audio',
		mimeType: 'audio/wav',
		frameCount: 3,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32' as const,
		chunkFrames: 65_536,
		...overrides,
	});
}

function chunkShape(value: unknown): Readonly<{ index: unknown; frames: unknown }> {
	const chunk = value as Readonly<{ index?: unknown; frames?: unknown }>;
	return { index: chunk.index, frames: chunk.frames };
}
