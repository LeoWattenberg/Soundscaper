/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { unzipSync } from 'fflate';

import {
	commitPreparedDirectStemArchiveDestination,
	prepareDirectStemArchiveDestination,
	streamDirectStemArchive,
} from '../src/common/editor/controller/direct-stem-archive-export.ts';
import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';
import { inspectZip32Layout } from '../src/common/editor/controller/zip32.ts';

test('streams a reconstructible two-stem ZIP, closes it, and only then commits it', async () => {
	const plan = eligiblePlan();
	const events: string[] = [];
	const stagedCleanups: string[] = [];
	const prepared = preparedStream({ events });
	const preparation = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => prepared }, plan, null, new AbortController().signal,
	);
	assert.ok(preparation.destination);

	const result = await streamDirectStemArchive({
		destination: preparation.destination,
		plan,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		async renderStem(output, index) {
			events.push(`render:${output.fileName}`);
			return {
				bytes: stemBytes(index),
				cleanup: async () => { stagedCleanups.push(output.fileName); },
			};
		},
		onStemComplete: (progress) => { events.push(`progress:${progress}`); },
	});
	assert.equal(result.byteLength, plan.archive.expectedByteLength);
	assert.equal(result.mimeType, 'application/zip');
	assert.deepEqual(stagedCleanups, ['01-dialogue.wav', '02-music.wav']);
	assert.ok(events.indexOf('open') < events.indexOf('render:01-dialogue.wav'));
	assert.equal(events.at(-1), 'close');

	const archiveBytes = prepared.bytes();
	const entries = unzipSync(archiveBytes);
	assert.deepEqual(Object.keys(entries), ['01-dialogue.wav', '02-music.wav']);
	assert.deepEqual(entries['01-dialogue.wav'], stemBytes(0));
	assert.deepEqual(entries['02-music.wav'], stemBytes(1));

	const published = await commitPreparedDirectStemArchiveDestination(
		preparation.destination, plan, result.byteLength, () => { events.push('current'); },
	);
	assert.equal(published.size, plan.archive.expectedByteLength);
	assert.ok(events.indexOf('close') < events.indexOf('commit'));
});

test('render failure and cancellation clean staged stems and abort the unpublished target', async () => {
	for (const cancelled of [false, true]) {
		const plan = eligiblePlan();
		const events: string[] = [];
		const prepared = preparedStream({ events });
		const controller = new AbortController();
		const preparation = await prepareDirectStemArchiveDestination(
			{ prepareSave: () => prepared }, plan, null, controller.signal,
		);
		assert.ok(preparation.destination);
		let cleanups = 0;
		await assert.rejects(streamDirectStemArchive({
			destination: preparation.destination,
			plan,
			signal: controller.signal,
			assertCurrent: () => undefined,
			async renderStem(_output, index) {
				if (index === 1 && !cancelled) throw new Error('render failed');
				if (index === 1) controller.abort();
				return {
					bytes: stemBytes(index),
					cleanup: async () => { cleanups += 1; },
				};
			},
		}), cancelled ? /abort/iu : /render failed/iu);
		assert.equal(cleanups, cancelled ? 2 : 1);
		assert.equal(events.filter((event) => event === 'abort').length, 1);
		assert.equal(events.includes('commit'), false);
	}
});

test('destination write failures abort once, clean the staged stem, and retain cleanup failure context', async () => {
	for (const abortFails of [false, true]) {
		const plan = eligiblePlan();
		const prepared = preparedStream({
			writeError: new Error('destination write failed'),
			abortError: abortFails ? new Error('destination abort failed') : undefined,
		});
		const preparation = await prepareDirectStemArchiveDestination(
			{ prepareSave: () => prepared }, plan, null, new AbortController().signal,
		);
		assert.ok(preparation.destination);
		let cleanups = 0;
		const error = await streamDirectStemArchive({
			destination: preparation.destination,
			plan,
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			renderStem: async (_output, index) => ({
				bytes: stemBytes(index),
				cleanup: async () => { cleanups += 1; },
			}),
		}).then(() => null, (caught: unknown) => caught);
		assert.ok(error instanceof Error);
		assert.match(String(error), /destination write failed/iu);
		assert.equal(cleanups, 1);
		assert.equal(prepared.aborts(), 1);
		assert.equal(prepared.commits(), 0);
		if (abortFails) {
			assert.ok(error instanceof AggregateError);
			assert.match(flattenErrorMessages(error).join(' '), /destination abort failed/iu);
		}
	}
});

test('stem commit refuses a lost renderer owner before publication and aborts once', async () => {
	const plan = eligiblePlan();
	const events: string[] = [];
	const prepared = preparedStream({ events });
	const preparation = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => prepared }, plan, null, new AbortController().signal,
	);
	assert.ok(preparation.destination);
	const result = await streamDirectStemArchive({
		destination: preparation.destination,
		plan,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderStem: async (_output, index) => ({ bytes: stemBytes(index), cleanup: async () => undefined }),
	});

	const loss = new Error('stale renderer owner');
	await assert.rejects(
		() => commitPreparedDirectStemArchiveDestination(
			preparation.destination, plan, result.byteLength, () => { throw loss; },
		),
		(error: unknown) => error === loss,
	);
	assert.equal(prepared.commits(), 0, 'a lost owner cannot cross the commit boundary');

	await preparation.destination.abort(loss);
	await preparation.destination.abort(loss);
	assert.equal(prepared.aborts(), 1, 'rollback after the refusal aborts exactly once');
	assert.equal(prepared.commits(), 0);
});

test('plan and encoded-input drift refuse publication', async () => {
	const inputDrift = eligiblePlan();
	const inputTarget = preparedStream();
	const inputPreparation = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => inputTarget }, inputDrift, null, new AbortController().signal,
	);
	assert.ok(inputPreparation.destination);
	let inputCleanup = 0;
	await assert.rejects(streamDirectStemArchive({
		destination: inputPreparation.destination,
		plan: inputDrift,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderStem: async () => ({
			bytes: Uint8Array.of(1, 2, 3),
			cleanup: async () => { inputCleanup += 1; },
		}),
	}), /input byte length.*plan/iu);
	assert.equal(inputCleanup, 1);
	assert.equal(inputTarget.commits(), 0);
	assert.equal(inputTarget.aborts(), 1);

	const planDrift = eligiblePlan();
	const planTarget = preparedStream();
	const planPreparation = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => planTarget }, planDrift, null, new AbortController().signal,
	);
	assert.ok(planPreparation.destination);
	const result = await streamDirectStemArchive({
		destination: planPreparation.destination,
		plan: planDrift,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderStem: async (_output, index) => ({ bytes: stemBytes(index) }),
	});
	planDrift.outputs.reverse();
	planDrift.archive.entries.reverse();
	await assert.rejects(
		async () => commitPreparedDirectStemArchiveDestination(
			planPreparation.destination!, planDrift, result.byteLength, () => undefined,
		),
		/plan changed.*destination/iu,
	);
	assert.equal(planTarget.commits(), 0);
	await planPreparation.destination.abort();
	assert.equal(planTarget.aborts(), 1);
});

test('export service opens the direct ZIP before render without an archive Blob or download', async () => {
	const fixture = serviceFixture('stream');
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
	assert.equal(result?.mimeType, 'application/zip');
	assert.equal(result?.size, fixture.plan.archive.expectedByteLength);
	assert.deepEqual(fixture.preflightBytes, [4]);
	assert.ok(fixture.events.indexOf('open') < fixture.events.indexOf('render:track-0'));
	assert.ok(fixture.events.indexOf('close') < fixture.events.indexOf('commit'));
	assert.equal(fixture.events.some((event) => event.startsWith('legacy-archive:')), false);
	assert.equal(fixture.downloads.length, 0);
	assert.deepEqual(Object.keys(unzipSync(fixture.target.bytes())), [
		'01-dialogue.wav', '02-music.wav',
	]);
});

test('export service preserves picker cancellation and the prepared-Blob legacy route', async () => {
	const cancelled = serviceFixture('cancelled');
	const cancellation = await createEditorExportService(cancelled.runtime).handleExportAction(
		'export', { mode: 'stems', format: 'wav' },
	);
	assert.equal(cancellation.cancelled, true);
	assert.deepEqual(cancelled.preflightBytes, []);
	assert.equal(cancelled.events.some((event) => event.startsWith('render:')), false);
	assert.equal(cancelled.downloads.length, 0);

	const legacy = serviceFixture('blob');
	const result = await createEditorExportService(legacy.runtime).handleExportAction(
		'export', { mode: 'stems', format: 'wav' },
	);
	assert.equal(result.mimeType, 'application/zip');
	assert.deepEqual(legacy.preflightBytes, [legacy.plan.requiredTemporaryBytes]);
	assert.equal(legacy.events.includes('legacy-archive:create'), true);
	assert.deepEqual(legacy.events.filter((event) => event.startsWith('legacy-archive:add:')), [
		'legacy-archive:add:01-dialogue.wav',
		'legacy-archive:add:02-music.wav',
	]);
	assert.equal(legacy.downloads.length, 1);
	assert.ok(legacy.downloads[0]?.blob instanceof Blob);
});

test('export service keeps nested destination abort idempotent after a ZIP write failure', async () => {
	for (const abortFails of [false, true]) {
		const fixture = serviceFixture('stream', {
			writeError: new Error('service destination write failed'),
			abortError: abortFails ? new Error('service destination abort failed') : undefined,
		});
		const result = await createEditorExportService(fixture.runtime).handleExportAction(
			'export', { mode: 'stems', format: 'wav' },
		);
		assert.equal(result, undefined);
		assert.equal(fixture.target.aborts(), 1);
		assert.equal(fixture.target.commits(), 0);
		assert.equal(fixture.downloads.length, 0);
		assert.match(flattenErrorMessages(fixture.errors[0]).join(' '), /service destination write failed/iu);
		if (abortFails) {
			assert.match(flattenErrorMessages(fixture.errors[0]).join(' '), /service destination abort failed/iu);
		}
	}
});

function eligiblePlan() {
	const entries = [
		{ fileName: '01-dialogue.wav', expectedByteLength: 4 },
		{ fileName: '02-music.wav', expectedByteLength: 4 },
	];
	const zip32 = inspectZip32Layout(entries.map(({ fileName, expectedByteLength }) => ({
		fileName, byteLength: expectedByteLength,
	})));
	return {
		mode: 'stems',
		format: 'wav',
		mimeType: 'audio/wav',
		outputFileBytesPerRender: 4,
		outputs: entries.map(({ fileName }, index) => ({ fileName, trackId: `track-${index}` })),
		archive: {
			format: 'zip',
			fileName: 'session-stems.zip',
			mimeType: 'application/zip',
			expectedByteLength: zip32.archiveByteLength,
			requiredTemporaryBytes: zip32.archiveByteLength + 4,
			fallbackRequiredTemporaryBytes: 8,
			entries,
			zip32,
		},
	};
}

type PrepareMode = 'stream' | 'blob' | 'cancelled';

function serviceFixture(
	mode: PrepareMode,
	targetFailures: Readonly<{ writeError?: Error; abortError?: Error }> = {},
) {
	const events: string[] = [];
	const downloads: Array<Readonly<Record<string, unknown>>> = [];
	const preflightBytes: number[] = [];
	const errors: unknown[] = [];
	const plan = servicePlan();
	const target = preparedStream({ events, ...targetFailures });
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
			events.push('legacy-archive:create');
			return {
				add: async (fileName: string) => { events.push(`legacy-archive:add:${fileName}`); },
				finish: async () => ({
					blob: new Blob([Uint8Array.of(9)], { type: 'application/zip' }),
					cleanup: async () => { events.push('legacy-archive:cleanup'); },
				}),
				abort: async () => { events.push('legacy-archive:abort'); },
			};
		},
		createStreamingWindowedSincResampler: () => null,
		createTemporaryFileSink: async () => { throw new Error('unexpected temporary sink'); },
		createWavStreamEncoder: () => { throw new Error('unexpected WAV stream encoder'); },
		encodeAiff: () => { throw new Error('unexpected AIFF encoder'); },
		encodeWav: (channels: readonly Float32Array[]) => stemBytes(channels[0]?.[0] === 0 ? 0 : 1),
		ffmpeg: { dispose: () => undefined },
		fileService: {
			prepareSave: () => {
				events.push('picker');
				if (mode === 'stream') return target;
				if (mode === 'cancelled') return { mode: 'cancelled', cancelled: true };
				return { mode: 'blob' };
			},
			createDownload: async (request: Readonly<Record<string, unknown>>) => {
				downloads.push(request);
				return { cancelled: false, url: 'blob:legacy', method: 'memory', cleanup: async () => undefined };
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

function servicePlan() {
	const plan = eligiblePlan();
	return {
		...plan,
		outputBytesPerRender: 4,
		requiredTemporaryBytes: plan.archive.expectedByteLength + 4,
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

function stemBytes(index: number): Uint8Array {
	return index === 0 ? Uint8Array.of(1, 2, 3, 4) : Uint8Array.of(5, 6, 7, 8);
}

function preparedStream(options: Readonly<{
	events?: string[];
	writeError?: Error;
	abortError?: Error;
}> = {}) {
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	let commitCount = 0;
	let abortCount = 0;
	return {
		mode: 'stream' as const,
		async createWritable() {
			options.events?.push('open');
			return new WritableStream<Uint8Array>({
				write(chunk) {
					if (options.writeError) throw options.writeError;
					chunks.push(chunk.slice());
					byteLength += chunk.byteLength;
				},
				close() { options.events?.push('close'); },
			});
		},
		bytesWritten: () => byteLength,
		commit() {
			commitCount += 1;
			options.events?.push('commit');
			return { method: 'memory', fileName: 'session-stems.zip', size: byteLength };
		},
		abort: async () => {
			abortCount += 1;
			options.events?.push('abort');
			if (options.abortError) throw options.abortError;
		},
		bytes: () => {
			const result = new Uint8Array(byteLength);
			let offset = 0;
			for (const chunk of chunks) {
				result.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return result;
		},
		commits: () => commitCount,
		aborts: () => abortCount,
	};
}

function flattenErrorMessages(error: unknown): string[] {
	if (error instanceof AggregateError) {
		return [error.message, ...error.errors.flatMap(flattenErrorMessages)];
	}
	return [error instanceof Error ? error.message : String(error)];
}
