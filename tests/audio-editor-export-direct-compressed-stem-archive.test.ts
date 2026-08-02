/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	captureDirectCompressedStemArchiveContract,
	DIRECT_COMPRESSED_STEM_MINIMUM_ENTRY_BYTES,
} from '../src/common/editor/controller/direct-compressed-stem-archive-plan.ts';
import {
	directStemArchiveTemporaryBytes,
	prepareDirectStemArchiveDestination,
} from '../src/common/editor/controller/direct-stem-archive-export.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { inspectZip32Layout } from '../src/common/editor/controller/zip32.ts';

const FORMAT_CASES = Object.freeze([
	{ format: 'mp3', extension: 'mp3', options: { bitRate: 320 } },
	{ format: 'flac', extension: 'flac', options: { sampleFormat: 'int16', compressionLevel: 8 } },
	{ format: 'ogg-vorbis', extension: 'ogg', options: { quality: -1 } },
	{ format: 'opus', extension: 'opus', options: { bitRate: 320 } },
	{ format: 'wavpack', extension: 'wv', options: { sampleFormat: 'int32', compressionLevel: 5 } },
	{ format: 'mp2', extension: 'mp2', options: { bitRate: 384 } },
	{ format: 'aac-m4a', extension: 'm4a', options: { bitRate: 320 } },
]);

test('all canonical realtime compressed stem plans open one maximum ZIP target', async () => {
	for (const entry of FORMAT_CASES) {
		const plan = actualPlan(entry.format, entry.options);
		const contract = captureDirectCompressedStemArchiveContract(plan);
		assert.ok(contract, entry.format);
		assert.equal(contract.format, entry.format);
		assert.equal(contract.entryMaximumByteLength, DIRECT_COMPRESSED_STEM_MINIMUM_ENTRY_BYTES);
		assert.equal(contract.stagingByteLength, plan.outputBytesPerRender);
		assert.equal(contract.outputs.length, 2);
		assert.equal(contract.outputs.every(({ fileName }) => fileName.endsWith(`.${entry.extension}`)), true);
		assert.deepEqual(contract.maximumZip32, inspectZip32Layout(contract.outputs.map(({ fileName }) => ({
			fileName,
			byteLength: DIRECT_COMPRESSED_STEM_MINIMUM_ENTRY_BYTES,
		}))));

		const opened: Array<readonly [number, string]> = [];
		const requests: Array<Readonly<Record<string, unknown>>> = [];
		const prepared = preparedStream(opened);
		const signal = new AbortController().signal;
		const result = await prepareDirectStemArchiveDestination({
			prepareSave(request) { requests.push(request); return prepared; },
		}, plan, null, signal);
		assert.ok(result.destination, entry.format);
		assert.deepEqual(opened, [[contract.maximumZip32.archiveByteLength, 'maximum']], entry.format);
		assert.equal(requests[0]?.suggestedName, plan.archive.fileName, entry.format);
		assert.equal(requests[0]?.mimeType, 'application/zip', entry.format);
		assert.equal(directStemArchiveTemporaryBytes(plan), plan.outputBytesPerRender, entry.format);
		await result.destination.abort();
	}
});

test('all centrally admitted offline compressed stem plans open one bounded-staging ZIP target', async () => {
	for (const entry of FORMAT_CASES) {
		const plan = actualPlan(entry.format, {
			...entry.options,
			livePcmBytes: 0,
			channelMapping: entry.format === 'mp3' ? 'mono' : 'preserve',
		});
		assert.equal(record(plan.render).strategy, 'offline', entry.format);
		const contract = captureDirectCompressedStemArchiveContract(plan);
		assert.ok(contract, entry.format);
		assert.equal(contract.renderStrategy, 'offline', entry.format);
		const encoding = record(plan.encoding);
		const bytesPerSample = entry.format === 'flac' ? Number(encoding.bitDepth) / 8 : 4;
		const offlineStagingBytes = Number(plan.outputFrames)
			* Number(encoding.inputChannelCount) * bytesPerSample;
		const boundedStagingBytes = Math.max(offlineStagingBytes, plan.outputBytesPerRender);
		assert.equal(contract.stagingByteLength, boundedStagingBytes, entry.format);
		assert.equal(
			contract.entryMaximumByteLength,
			Math.max(boundedStagingBytes, DIRECT_COMPRESSED_STEM_MINIMUM_ENTRY_BYTES),
			entry.format,
		);
		assert.equal(
			plan.requiredTemporaryBytes,
			plan.outputBytesPerRender * records(plan.outputs).length,
			entry.format,
		);

		const opened: Array<readonly [number, string]> = [];
		const result = await prepareDirectStemArchiveDestination({
			prepareSave: () => preparedStream(opened),
		}, plan, null, new AbortController().signal);
		assert.ok(result.destination, entry.format);
		assert.deepEqual(opened, [[contract.maximumZip32.archiveByteLength, 'maximum']], entry.format);
		assert.equal(directStemArchiveTemporaryBytes(plan), boundedStagingBytes, entry.format);
		await result.destination.abort();
	}
});

test('compressed stem entry acceptance grows with raw render payload above its fixed minimum', () => {
	const plan = actualPlan('mp3', { bitRate: 320 }, 300_000);
	const contract = captureDirectCompressedStemArchiveContract(plan);
	assert.ok(contract);
	assert.ok(plan.outputBytesPerRender > DIRECT_COMPRESSED_STEM_MINIMUM_ENTRY_BYTES);
	assert.equal(contract.entryMaximumByteLength, plan.outputBytesPerRender);
	assert.equal(contract.maximumZip32.localByteLength > plan.outputBytesPerRender * 2, true);
});

test('offline compressed entry acceptance follows its input-width staging payload', () => {
	const plan = actualPlan('mp3', {
		bitRate: 320, livePcmBytes: 0, channelMapping: 'mono',
	}, 300_000);
	const contract = captureDirectCompressedStemArchiveContract(plan);
	assert.ok(contract);
	assert.equal(record(plan.render).strategy, 'offline');
	assert.ok(contract.stagingByteLength > plan.outputBytesPerRender);
	assert.equal(contract.entryMaximumByteLength, contract.stagingByteLength);
});

test('offline compressed stereo upmix admission bounds its wider realtime retry staging', () => {
	const plan = actualPlan('mp3', {
		bitRate: 320, livePcmBytes: 0, channelMapping: 'stereo',
	}, 300_000, 2, 1);
	const contract = captureDirectCompressedStemArchiveContract(plan);
	assert.ok(contract);
	assert.equal(record(plan.encoding).inputChannelCount, 1);
	assert.equal(plan.channelCount, 2);
	assert.equal(contract.stagingByteLength, 300_000 * 2 * Float32Array.BYTES_PER_ELEMENT);
	assert.equal(contract.entryMaximumByteLength, contract.stagingByteLength);
	assert.equal(directStemArchiveTemporaryBytes(plan), contract.stagingByteLength);
});

test('noncanonical and forged compressed stem routes remain direct-ineligible', async () => {
	const realtime = actualPlan('mp3', { bitRate: 320 });
	const offline = actualPlan('mp3', { bitRate: 320, livePcmBytes: 0 });
	assert.equal(record(offline.render).strategy, 'offline');
	const cases: Array<Readonly<{ label: string; plan: unknown }>> = [
		changedPlan(offline, 'forged offline admission', (plan) => {
			const admission = record(record(plan.render).offlineRenderAdmission);
			admission.peakUsefulBinaryBytes = Number(admission.peakUsefulBinaryBytes) + 1;
		}),
		{
			label: 'custom',
			plan: actualPlan('custom-ffmpeg', {
				extension: 'foo', mimeType: 'audio/x-foo', customArguments: ['-c:a', 'copy'],
			}),
		},
		changedPlan(realtime, '7z', (plan) => { record(plan.archive).format = '7z'; }),
		changedPlan(realtime, 'archive MIME', (plan) => { record(plan.archive).mimeType = 'application/octet-stream'; }),
		changedPlan(realtime, 'archive size claim', (plan) => { record(plan.archive).expectedByteLength = 1; }),
		changedPlan(realtime, 'archive layout claim', (plan) => { record(plan.archive).zip32 = {}; }),
		changedPlan(realtime, 'archive extra field', (plan) => { record(plan.archive).unexpected = true; }),
		changedPlan(realtime, 'archive delete character', (plan) => {
			record(plan.archive).fileName = 'session\u007f.zip';
		}),
		changedPlan(realtime, 'archive staging', (plan) => {
			record(plan.archive).requiredTemporaryBytes = Number(record(plan.archive).requiredTemporaryBytes) + 1;
		}),
		changedPlan(realtime, 'archive fallback staging', (plan) => {
			record(plan.archive).fallbackRequiredTemporaryBytes =
				Number(record(plan.archive).fallbackRequiredTemporaryBytes) + 1;
		}),
		changedPlan(realtime, 'entry size claim', (plan) => {
			record(records(record(plan.archive).entries)[0]).expectedByteLength = 1;
		}),
		changedPlan(realtime, 'entry order', (plan) => { records(record(plan.archive).entries).reverse(); }),
		changedPlan(realtime, 'output kind', (plan) => { record(records(plan.outputs)[0]).kind = 'mix'; }),
		changedPlan(realtime, 'included master', (plan) => { record(records(plan.outputs)[0]).includeMaster = true; }),
		changedPlan(realtime, 'mute and solo', (plan) => { record(records(plan.outputs)[0]).respectMuteSolo = true; }),
		changedPlan(realtime, 'empty track', (plan) => { record(records(plan.outputs)[0]).trackId = ''; }),
		changedPlan(realtime, 'wrong extension', (plan) => {
			record(records(plan.outputs)[0]).fileName = 'voice.wav';
			record(records(record(plan.archive).entries)[0]).fileName = 'voice.wav';
		}),
		changedPlan(realtime, 'output and entry mismatch', (plan) => {
			record(records(record(plan.archive).entries)[0]).fileName = 'different.mp3';
		}),
		changedPlan(realtime, 'duplicate filename', (plan) => {
			const first = String(record(records(plan.outputs)[0]).fileName);
			record(records(plan.outputs)[1]).fileName = first;
			record(records(record(plan.archive).entries)[1]).fileName = first;
		}),
		changedPlan(realtime, 'unsafe entry', (plan) => { record(records(plan.outputs)[0]).fileName = '../voice.mp3'; }),
		changedPlan(realtime, 'control character entry', (plan) => {
			record(records(plan.outputs)[0]).fileName = 'voice\n.mp3';
			record(records(record(plan.archive).entries)[0]).fileName = 'voice\n.mp3';
		}),
		changedPlan(realtime, 'duplicate track', (plan) => {
			record(records(plan.outputs)[1]).trackId = record(records(plan.outputs)[0]).trackId;
		}),
		changedPlan(realtime, 'aggregate staging', (plan) => { plan.requiredTemporaryBytes = 1; }),
		changedPlan(realtime, 'unknown reason', (plan) => { record(plan.render).reason = 'manual'; }),
		changedPlan(realtime, 'render extra field', (plan) => { record(plan.render).unexpected = true; }),
	];
	for (const entry of cases) {
		let pickers = 0;
		const preparation = await prepareDirectStemArchiveDestination({
			prepareSave() { pickers += 1; return preparedStream([]); },
		}, entry.plan as never, null, new AbortController().signal);
		assert.equal(captureDirectCompressedStemArchiveContract(entry.plan as never), null, entry.label);
		assert.equal(directStemArchiveTemporaryBytes(entry.plan as never), null, entry.label);
		assert.equal(preparation.destination, null, entry.label);
		assert.equal(pickers, 0, entry.label);
	}
});

test('a synthetic maximum beyond ZIP32 remains direct-ineligible without opening a picker', async () => {
	const plan = actualPlan('mp3', { bitRate: 320 }, 1, 4096);
	assert.equal(records(plan.outputs).length, 4096);
	assert.equal(captureDirectCompressedStemArchiveContract(plan as never), null);
	assert.equal(directStemArchiveTemporaryBytes(plan), null);
	let pickers = 0;
	const preparation = await prepareDirectStemArchiveDestination({
		prepareSave() { pickers += 1; return preparedStream([]); },
	}, plan, null, new AbortController().signal);
	assert.equal(preparation.destination, null);
	assert.equal(pickers, 0);
});

test('native PCM stems remain on their existing exact direct route', async () => {
	const plan = actualPlan('wav');
	assert.equal(captureDirectCompressedStemArchiveContract(plan as never), null);
	const opened: Array<readonly [number, string]> = [];
	const preparation = await prepareDirectStemArchiveDestination({
		prepareSave: () => preparedStream(opened),
	}, plan, null, new AbortController().signal);
	assert.ok(preparation.destination);
	assert.deepEqual(opened, [[record(plan.archive).expectedByteLength, 'exact']]);
	assert.equal(directStemArchiveTemporaryBytes(plan), plan.outputFileBytesPerRender);
	await preparation.destination.abort();
});

test('offline-memory refusal must remain exact and route hooks never run', () => {
	const plan = actualPlan('mp3', { bitRate: 320, livePcmBytes: 0 }, 33_685_504);
	assert.equal(record(plan.render).reason, 'offline-render-output-memory');
	assert.ok(captureDirectCompressedStemArchiveContract(plan as never));

	const drifted = structuredClone(plan);
	const refusal = record(record(drifted.render).offlineRenderAdmission);
	refusal.peakUsefulBinaryBytes = Number(refusal.peakUsefulBinaryBytes) + 1;
	assert.equal(captureDirectCompressedStemArchiveContract(drifted as never), null);

	let calls = 0;
	const hooked = structuredClone(plan);
	Object.setPrototypeOf(record(hooked.render), {
		toJSON() { calls += 1; throw new Error('render hook ran'); },
	});
	assert.equal(captureDirectCompressedStemArchiveContract(hooked as never), null);
	assert.equal(calls, 0);
});

test('compressed stem routing rejects accessors without invoking caller code', async () => {
	const cases: Array<Readonly<{
		label: string;
		mutate(plan: Record<string, unknown>, called: () => void): void;
	}>> = [
		{
			label: 'top-level format',
			mutate(plan, called) {
				Object.defineProperty(plan, 'format', {
					enumerable: true,
					get() { called(); throw new Error('format getter ran'); },
				});
			},
		},
		{
			label: 'top-level archive',
			mutate(plan, called) {
				Object.defineProperty(plan, 'archive', {
					enumerable: true,
					get() { called(); throw new Error('archive getter ran'); },
				});
			},
		},
		{
			label: 'nested output',
			mutate(plan, called) {
				Object.defineProperty(records(plan.outputs)[0]!, 'fileName', {
					enumerable: true,
					get() { called(); throw new Error('output getter ran'); },
				});
			},
		},
		{
			label: 'nested archive entry',
			mutate(plan, called) {
				Object.defineProperty(records(record(plan.archive).entries)[0]!, 'fileName', {
					enumerable: true,
					get() { called(); throw new Error('entry getter ran'); },
				});
			},
		},
	];
	for (const entry of cases) {
		const plan = structuredClone(actualPlan('mp3', { bitRate: 320 }));
		let calls = 0;
		entry.mutate(plan, () => { calls += 1; });
		assert.equal(captureDirectCompressedStemArchiveContract(plan as never), null, entry.label);
		assert.equal(directStemArchiveTemporaryBytes(plan), null, entry.label);
		let pickers = 0;
		const preparation = await prepareDirectStemArchiveDestination({
			prepareSave() { pickers += 1; return preparedStream([]); },
		}, plan, null, new AbortController().signal);
		assert.equal(preparation.destination, null, entry.label);
		assert.equal(pickers, 0, entry.label);
		assert.equal(calls, 0, entry.label);
	}
});

test('offline compressed stem admission snapshots central evidence without invoking accessors', () => {
	const plan = structuredClone(actualPlan('mp3', { bitRate: 320, livePcmBytes: 0 }));
	let calls = 0;
	Object.defineProperty(record(record(plan.render).offlineRenderAdmission), 'peakUsefulBinaryBytes', {
		enumerable: true,
		get() { calls += 1; throw new Error('offline admission getter ran'); },
	});
	assert.equal(captureDirectCompressedStemArchiveContract(plan as never), null);
	assert.equal(directStemArchiveTemporaryBytes(plan), null);
	assert.equal(calls, 0);
});

test('offline compressed stem admission captures caller descriptors exactly once', () => {
	const source = structuredClone(actualPlan('mp3', { bitRate: 320, livePcmBytes: 0 }));
	const descriptorReads = new Map<PropertyKey, number>();
	const plan = new Proxy(source, {
		getOwnPropertyDescriptor(target, property) {
			descriptorReads.set(property, (descriptorReads.get(property) ?? 0) + 1);
			return Reflect.getOwnPropertyDescriptor(target, property);
		},
	});
	assert.ok(captureDirectCompressedStemArchiveContract(plan as never));
	assert.equal(descriptorReads.get('format'), 2, 'one envelope read and one owned field read');
	assert.equal(descriptorReads.get('aggregateStereoMinutes'), 1, 'one caller envelope read');
});

test('compressed stem picker cancellation and prepared Blob mode retain legacy routing', async () => {
	const plan = actualPlan('opus', { bitRate: 160 });
	const cancellation = Object.freeze({ mode: 'cancelled' as const, cancelled: true });
	const cancelled = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => cancellation }, plan, null, new AbortController().signal,
	);
	assert.strictEqual(cancelled.cancelled, cancellation);
	assert.equal(cancelled.destination, null);

	const blob = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => ({ mode: 'blob' }) }, plan, null, new AbortController().signal,
	);
	assert.equal(blob.cancelled, null);
	assert.equal(blob.destination, null);
});

function actualPlan(
	format: string,
	options: Readonly<Record<string, unknown>> = {},
	durationFrames = 1,
	trackCount = 2,
	masterChannels = 2,
) {
	return createExportPlan(projectFixture(durationFrames, trackCount, masterChannels), {
		mode: 'stems', format, includeTail: false, livePcmBytes: 2 * 1024 ** 3,
		date: '2026-08-02', ...options,
	}) as unknown as Record<string, unknown> & {
		archive: Readonly<Record<string, unknown>>;
		outputBytesPerRender: number;
	};
}

function changedPlan(
	base: unknown,
	label: string,
	change: (plan: Record<string, unknown>) => void,
): Readonly<{ label: string; plan: unknown }> {
	const plan = structuredClone(base) as Record<string, unknown>;
	change(plan);
	return { label, plan };
}

function preparedStream(opened: Array<readonly [number, string]>) {
	let bytes = 0;
	return {
		mode: 'stream' as const,
		async createWritable(byteLength: number, sizeMode: string) {
			opened.push([byteLength, sizeMode]);
			return new WritableStream<Uint8Array>({ write(chunk) { bytes += chunk.byteLength; } });
		},
		bytesWritten: () => bytes,
		commit: async () => ({ method: 'memory', fileName: 'stems.zip', size: bytes }),
		abort: async () => undefined,
	};
}

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
	assert.ok(Array.isArray(value));
	return value as Record<string, unknown>[];
}

function projectFixture(durationFrames: number, trackCount: number, masterChannels: number) {
	return {
		schemaVersion: 9, id: 'compressed-stems', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate: 48_000, masterChannels, metadata: {},
		selection: { startFrame: 0, endFrame: durationFrames },
		loop: { enabled: false, startFrame: 0, endFrame: durationFrames },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: durationFrames, channelCount: masterChannels, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames,
		}],
		tracks: Array.from({ length: trackCount }, (_value, index) => ({
			id: `track-${String(index + 1)}`,
			type: 'audio',
			name: index === 0 ? 'Voice' : index === 1 ? 'Music' : `Track ${String(index + 1)}`,
			clipIds: index === 0 ? ['clip'] : [],
			effectsActive: true,
			effects: [],
		})),
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}
