/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	commitPreparedDirectStemArchiveDestination,
	prepareDirectStemArchiveDestination,
	streamDirectStemArchive,
} from '../src/common/editor/controller/direct-stem-archive-export.ts';
import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';
import { createSevenZipStemArchivePlan } from '../src/common/editor/controller/stem-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const FINAL_PREFIX_BYTES = 32;
const DIRECT_SEVEN_ZIP_GOLDEN_BASE64 =
	'N3q8ryccAARrA3b2CAAAAAAAAABvAAAAAAAAAIRX/YkBAgMEBQYHCAEEBgACCQQECgHN+zy2aU2NUwAHCwIAAQEAAQEADAQECgHN+zy2aU2NUwAIAAAFAhE7ADAAMQAtAGQAaQBhAGwAbwBnAHUAZQAuAHcAYQB2AAAAMAAyAC0AbQB1AHMAaQBjAC4AdwBhAHYAAAAAAA==';

test('direct native stems stream a golden 7z through a sealed final-prefix destination', async () => {
	const plan = directSevenZipPlan();
	const events: string[] = [];
	const requests: Array<Readonly<Record<string, unknown>>> = [];
	const target = preparedSevenZipTarget({ events });
	const preparation = await prepareDirectStemArchiveDestination({
		prepareSave(request) {
			requests.push(request);
			events.push('picker');
			return target;
		},
	}, plan, { saveTarget: 'chosen-target' }, new AbortController().signal);
	assert.ok(preparation.destination);
	assert.equal(requests.length, 1);
	const pickerRequest = requests[0];
	assert.ok(pickerRequest);
	const { signal: pickerSignal, ...pickerRequestFields } = pickerRequest;
	assert.ok(pickerSignal instanceof AbortSignal);
	assert.deepEqual(pickerRequestFields, {
		purpose: 'audio',
		suggestedName: 'session-stems.7z',
		mimeType: 'application/x-7z-compressed',
		target: 'chosen-target',
		types: [{
			description: '7z stem archive',
			accept: { 'application/x-7z-compressed': ['.7z'] },
		}],
		useFileSystemAccess: true,
	});
	assert.deepEqual(target.opened(), [[
		plan.archive.expectedByteLength,
		'exact',
		{ finalPrefixByteLength: FINAL_PREFIX_BYTES },
	]]);

	let retained = 0;
	let maximumRetained = 0;
	const cleanups = [0, 0];
	const result = await streamDirectStemArchive({
		destination: preparation.destination,
		plan,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		async renderStem(output, index) {
			assert.equal(target.appended()[0]?.byteLength, FINAL_PREFIX_BYTES);
			assert.deepEqual(target.appended()[0], new Uint8Array(FINAL_PREFIX_BYTES));
			events.push(`render:${output.fileName}`);
			assert.equal(retained, 0, 'only one complete stem may remain staged');
			retained += 1;
			maximumRetained = Math.max(maximumRetained, retained);
			return {
				bytes: stemBytes(index),
				cleanup: async () => {
					retained -= 1;
					cleanups[index] += 1;
					events.push(`cleanup:${output.fileName}`);
				},
			};
		},
	});
	assert.equal(result.byteLength, plan.archive.expectedByteLength);
	assert.equal(result.mimeType, 'application/x-7z-compressed');
	assert.equal(maximumRetained, 1);
	assert.equal(retained, 0);
	assert.deepEqual(cleanups, [1, 1]);
	assert.ok(events.indexOf('open') < events.indexOf('append:zero-prefix'));
	assert.ok(events.indexOf('append:zero-prefix') < events.indexOf('render:01-dialogue.wav'));
	assert.ok(events.indexOf('close') < events.indexOf('patch'));
	assert.equal(events.includes('commit'), false);

	const published = await commitPreparedDirectStemArchiveDestination(
		preparation.destination, plan, result.byteLength, () => { events.push('current:commit'); },
	);
	assert.equal(published.size, plan.archive.expectedByteLength);
	assert.ok(events.indexOf('patch') < events.indexOf('commit'));
	assert.equal(target.patches(), 1);
	assert.equal(target.aborts(), 0);
	const bytes = target.bytes();
	assert.equal(Buffer.from(bytes).toString('base64'), DIRECT_SEVEN_ZIP_GOLDEN_BASE64);
	assert.deepEqual(Array.from(bytes.subarray(0, 8)), [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]);
	assert.equal(readUint64(bytes, 12), 8);
	assert.deepEqual(bytes.subarray(32, 40), Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
});

test('export service directly publishes 7z with one-stem preflight and no Blob download', async () => {
	const fixture = serviceFixture();
	const NativeBlob = globalThis.Blob;
	let blobConstructions = 0;
	class ObservedBlob extends NativeBlob {
		constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
			blobConstructions += 1;
			super(parts, options);
		}
	}
	globalThis.Blob = ObservedBlob;
	let result: Readonly<Record<string, unknown>> | undefined;
	try {
		result = await createEditorExportService(fixture.runtime).handleExportAction(
			'export', { mode: 'stems', format: 'wav' },
		);
	} finally {
		globalThis.Blob = NativeBlob;
	}

	assert.equal(blobConstructions, 0);
	assert.equal(result?.mimeType, 'application/x-7z-compressed');
	assert.equal(result?.fileName, 'session-stems.7z');
	assert.equal(result?.size, fixture.plan.archive.expectedByteLength);
	assert.deepEqual(fixture.preflightBytes, [fixture.plan.outputFileBytesPerRender]);
	assert.equal(fixture.downloads.length, 0);
	assert.equal(fixture.events.includes('legacy-archive'), false);
	assert.ok(fixture.events.indexOf('append:zero-prefix') < fixture.events.indexOf('render:track-0'));
	assert.ok(fixture.events.indexOf('close') < fixture.events.indexOf('patch'));
	assert.ok(fixture.events.indexOf('patch') < fixture.events.indexOf('commit'));
	// The byte-for-byte golden lives on the low-level test above, which owns the
	// placeholder payload. This route delivers real WAV stems, because the export
	// service conforms every stem by reading it back before it joins the archive.
	const written = fixture.target.bytes();
	assert.deepEqual(
		written.subarray(0, 6),
		Uint8Array.of(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c),
		'a real 7z signature is written',
	);
	assert.equal(written.byteLength, fixture.plan.archive.expectedByteLength);
});

test('render and entry-size failures clean staged stems and abort exactly once', async () => {
	for (const failure of ['render', 'entry-size'] as const) {
		const plan = directSevenZipPlan();
		const target = preparedSevenZipTarget();
		const preparation = await prepareDirectStemArchiveDestination(
			{ prepareSave: () => target }, plan, null, new AbortController().signal,
		);
		assert.ok(preparation.destination);
		const cleanups = [0, 0];
		await assert.rejects(streamDirectStemArchive({
			destination: preparation.destination,
			plan,
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			async renderStem(_output, index) {
				if (failure === 'render' && index === 1) throw new Error('second render failed');
				return {
					bytes: failure === 'entry-size' && index === 0
						? Uint8Array.of(1, 2, 3)
						: stemBytes(index),
					cleanup: async () => { cleanups[index] += 1; },
				};
			},
		}), failure === 'render' ? /second render failed/u : /byte length.*plan/iu);
		assert.deepEqual(cleanups, failure === 'render' ? [1, 0] : [1, 0]);
		await preparation.destination.abort();
		assert.equal(target.aborts(), 1, failure);
		assert.equal(target.commits(), 0, failure);
		assert.equal(target.patches(), 0, failure);
	}
});

test('plan drift after sealing refuses the final prefix and publication', async () => {
	const plan = directSevenZipPlan();
	const cleanups = [0, 0];
	const target = preparedSevenZipTarget({
		onClose() { plan.outputs.reverse(); },
	});
	const preparation = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => target }, plan, null, new AbortController().signal,
	);
	assert.ok(preparation.destination);
	await assert.rejects(streamDirectStemArchive({
		destination: preparation.destination,
		plan,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderStem: async (_output, index) => ({
			bytes: stemBytes(index),
			cleanup: async () => { cleanups[index] += 1; },
		}),
	}), /plan changed.*destination/iu);
	await preparation.destination.abort();
	assert.deepEqual(cleanups, [1, 1]);
	assert.equal(target.aborts(), 1);
	assert.equal(target.patches(), 0);
	assert.equal(target.commits(), 0);
});

test('a failed final-prefix patch preserves cleanup context and aborts only once', async () => {
	const plan = directSevenZipPlan();
	const cleanups = [0, 0];
	const target = preparedSevenZipTarget({ patchError: new Error('prefix patch failed') });
	const preparation = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => target }, plan, null, new AbortController().signal,
	);
	assert.ok(preparation.destination);
	await assert.rejects(streamDirectStemArchive({
		destination: preparation.destination,
		plan,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderStem: async (_output, index) => ({
			bytes: stemBytes(index),
			cleanup: async () => { cleanups[index] += 1; },
		}),
	}), /prefix patch failed/u);
	await preparation.destination.abort();
	await preparation.destination.abort();
	assert.deepEqual(cleanups, [1, 1]);
	assert.equal(target.patches(), 1);
	assert.equal(target.aborts(), 1);
	assert.equal(target.commits(), 0);
});

function directSevenZipPlan() {
	const entries = [
		{ fileName: '01-dialogue.wav', expectedByteLength: 4 },
		{ fileName: '02-music.wav', expectedByteLength: 4 },
	];
	return {
		mode: 'stems',
		format: 'wav',
		mimeType: 'audio/wav',
		outputFileBytesPerRender: 4,
		outputs: entries.map(({ fileName }, index) => ({ fileName, trackId: `track-${index}` })),
		archive: createSevenZipStemArchivePlan('session-stems', entries),
	};
}

/**
 * A real one-frame WAV: the service route conforms every delivered stem by
 * reading it back, so a placeholder byte string claiming to be a WAV is the
 * writer fault that conformance exists to refuse.
 */
function serviceStemBytes(index: number): Uint8Array {
	return encodeWav([Float32Array.of(index === 0 ? 0 : 0.5)], {
		sampleRate: 48_000, bitDepth: 16, float: false, dither: 'none',
	});
}

function servicePlan() {
	const stemByteLength = serviceStemBytes(0).byteLength;
	const entries = [
		{ fileName: '01-dialogue.wav', expectedByteLength: stemByteLength },
		{ fileName: '02-music.wav', expectedByteLength: stemByteLength },
	];
	const plan = {
		mode: 'stems',
		format: 'wav',
		mimeType: 'audio/wav',
		outputFileBytesPerRender: stemByteLength,
		outputs: entries.map(({ fileName }, index) => ({ fileName, trackId: `track-${index}` })),
		archive: createSevenZipStemArchivePlan('session-stems', entries),
	};
	return {
		...plan,
		outputBytesPerRender: plan.outputFileBytesPerRender,
		requiredTemporaryBytes: plan.archive.requiredTemporaryBytes,
		sampleRate: 48_000,
		channelCount: 1,
		encoding: { bitDepth: 16, floatingPoint: false, sampleFormat: 'int16' },
		ditherMode: 'none',
		render: { strategy: 'offline' },
		range: { startFrame: 0, endFrame: 1, durationFrames: 1 },
		tailFrames: 0,
		outputFrames: 1,
		channelMapping: null,
		metadata: {},
	};
}

function serviceFixture() {
	const events: string[] = [];
	const downloads: Array<Readonly<Record<string, unknown>>> = [];
	const preflightBytes: number[] = [];
	const errors: unknown[] = [];
	const plan = servicePlan();
	const target = preparedSevenZipTarget({ events });
	const project = {
		id: 'project', title: 'Session', sampleRate: 48_000, masterChannels: 1,
		tracks: [], clips: [{ id: 'clip', kind: 'audio', sourceId: 'source' }], sources: [],
	};
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
	const throwIfAborted = (signal?: AbortSignal | null) => {
		if (signal?.aborted) throw abortError();
	};
	const runtime: ExportServiceRuntime = {
		abortError,
		applyMediaChannelMapping: (channels: readonly Float32Array[]) => channels,
		audioBufferChannels: (audio: Readonly<{ channels: readonly Float32Array[] }>) => audio.channels,
		cloneProject: (value: typeof project) => structuredClone(value),
		copy: {
			localSourcesMissing: 'missing', rendering: 'rendering', encoding: 'encoding', done: 'done',
			largeProjectRealtimeExport: 'realtime', realtimeExportFallback: 'fallback',
			realtimeStorageRequired: 'storage',
		},
		createAiffStreamEncoder: () => { throw new Error('unexpected AIFF stream encoder'); },
		createCacheAwareRenderEngine: () => { throw new Error('unexpected realtime renderer'); },
		createExportPlan: () => plan,
		createStableId: () => 'stable',
		createStreamingStemArchive: async () => {
			events.push('legacy-archive');
			throw new Error('unexpected legacy archive');
		},
		createStreamingWindowedSincResampler: () => null,
		createTemporaryFileSink: async () => { throw new Error('unexpected temporary sink'); },
		createWavStreamEncoder: () => { throw new Error('unexpected WAV stream encoder'); },
		encodeAiff: () => { throw new Error('unexpected AIFF encoder'); },
		encodeWav: (channels: readonly Float32Array[]) => serviceStemBytes(channels[0]?.[0] === 0 ? 0 : 1),
		ffmpeg: { dispose: () => undefined },
		fileService: {
			prepareSave: () => target,
			createDownload: async (request: Readonly<Record<string, unknown>>) => {
				downloads.push(request);
				throw new Error('unexpected Blob download');
			},
		},
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask: () => {
				const controller = new AbortController();
				return { signal: controller.signal, assertCurrent: () => undefined, finish: () => undefined };
			},
			cancelTask: () => undefined,
		},
		normalizeExportSettings: (settings: unknown) => settings,
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: {
			renderSnapshot: async (snapshot: Readonly<{ activeStem?: string }>) => {
				events.push(`render:${snapshot.activeStem}`);
				return {
					sampleRate: 48_000, length: 1, numberOfChannels: 1,
					channels: [Float32Array.of(snapshot.activeStem === 'track-0' ? 0 : 1)],
				};
			},
		},
		playbackProjects: null,
		preflightStorage: async (bytes: number) => { preflightBytes.push(bytes); },
		prepareCommittedTimePitchCaches: async () => undefined,
		productName: 'Soundscaper',
		getProject: () => project,
		projectGeneration: { capture: () => 'token', assertCurrent: () => undefined },
		publishDocumentSnapshot: () => undefined,
		resampleBuffer: async () => { throw new Error('unexpected resample'); },
		setStatus: () => undefined,
		sourceBuffers: new Map(),
		state,
		stemProject: (value: typeof project, trackId: string) => ({ ...structuredClone(value), activeStem: trackId }),
		store: {},
		taskProgress: {
			begin: () => ({ setPhase: () => true, finish: () => true }),
			setActivePhase: () => true,
		},
		throwIfAborted,
		toggleExport: () => undefined,
		updateExportProgress: () => undefined,
		verifyProjectFallbackIntegrity: async () => { throw new Error('unexpected fallback verification'); },
	};
	return { downloads, errors, events, plan, preflightBytes, runtime, state, target };
}

interface PreparedTargetOptions {
	readonly events?: string[];
	readonly onClose?: () => void;
	readonly patchError?: Error;
}

function preparedSevenZipTarget(options: PreparedTargetOptions = {}) {
	let bytes = new Uint8Array(0);
	let offset = 0;
	let sealed = false;
	let commitCount = 0;
	let abortCount = 0;
	let patchCount = 0;
	const appendedChunks: Uint8Array[] = [];
	const openedCalls: Array<readonly [number, string, Readonly<Record<string, unknown>>]> = [];
	return {
		mode: 'stream' as const,
		async createWritable(
			byteLength: number,
			sizeMode: string,
			writableOptions: Readonly<Record<string, unknown>> = {},
		) {
			openedCalls.push([byteLength, sizeMode, structuredClone(writableOptions)]);
			options.events?.push('open');
			bytes = new Uint8Array(byteLength);
			return new WritableStream<Uint8Array>({
				write(chunk) {
					const copy = chunk.slice();
					appendedChunks.push(copy);
					bytes.set(copy, offset);
					offset += copy.byteLength;
					options.events?.push(
						appendedChunks.length === 1
							&& copy.byteLength === FINAL_PREFIX_BYTES
							&& copy.every((value) => value === 0)
							? 'append:zero-prefix'
							: `append:${copy.byteLength}`,
					);
				},
				close() {
					sealed = true;
					options.events?.push('close');
					options.onClose?.();
				},
			});
		},
		async patchFinalPrefix(prefix: Uint8Array) {
			patchCount += 1;
			options.events?.push('patch');
			assert.equal(sealed, true, 'the append stream must be sealed before its prefix is patched');
			assert.equal(offset, bytes.byteLength, 'the complete exact archive must be appended before patching');
			if (options.patchError) throw options.patchError;
			bytes.set(prefix, 0);
		},
		bytesWritten: () => offset,
		commit() {
			commitCount += 1;
			options.events?.push('commit');
			return {
				method: 'memory', fileName: 'session-stems.7z', size: offset,
			};
		},
		abort: async () => {
			abortCount += 1;
			options.events?.push('abort');
		},
		opened: () => openedCalls,
		appended: () => appendedChunks,
		bytes: () => bytes.slice(),
		commits: () => commitCount,
		aborts: () => abortCount,
		patches: () => patchCount,
	};
}

function stemBytes(index: number): Uint8Array {
	return index === 0 ? Uint8Array.of(1, 2, 3, 4) : Uint8Array.of(5, 6, 7, 8);
}

function readUint64(bytes: Uint8Array, offset: number): number {
	return Number(new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true));
}
