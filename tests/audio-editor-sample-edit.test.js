import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_SAMPLE_EDIT_MIN_PIXELS_PER_SAMPLE,
	canEditAudioSamplesAtZoom,
	createPencilSampleEdits,
	createSmoothSampleRange,
	persistImmutableSampleEdit,
	timelineFrameToSourceFrame,
} from '../src/common/editor/sample-edit.js';
import {
	audacityWaveformMode,
	audacityWaveformShowsPoints,
} from '../src/common/editor/audacity-waveform-renderer.js';
import { AUDIO_EDITOR_MAX_PIXELS_PER_SECOND } from '../src/common/editor/timeline-zoom-limits.ts';
import {
	createAddSourceCommand,
	createReplaceClipSourceCommand,
} from '../src/common/editor/commands.js';
import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createSampleEditService } from '../src/common/editor/controller/sample-edit-service.ts';
import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source-chunk-provider-registry.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { collectHistorySourceIds } from '../src/common/editor/retention.js';
import { createProjectStore } from '../src/common/editor/storage.js';

const SOURCE = Object.freeze({
	id: 'source-original',
	name: 'fixture.wav',
	mimeType: 'audio/wav',
	storageKey: 'source-original',
	frameCount: 65_540,
	channelCount: 1,
	sampleRate: 48_000,
	originalSampleRate: 48_000,
	sampleFormat: 'float32',
	chunkFrames: 65_536,
	opaqueExtensions: {},
});

const CLIP = Object.freeze({
	id: 'clip-sample-edit',
	sourceId: SOURCE.id,
	title: 'Fixture',
	timelineStartFrame: 100,
	sourceStartFrame: 1_000,
	sourceDurationFrames: 10_000,
	durationFrames: 5_000,
	reversed: false,
});

test('the deepest timeline zoom reaches stem rendering and the pencil', () => {
	// One pixel per sample used to be the ceiling, and the renderer still joins
	// samples with a line there, so neither stems nor the pencil were reachable.
	assert.equal(audacityWaveformMode(48_000 / 48_000), 'connecting-dots');
	assert.equal(canEditAudioSamplesAtZoom(48_000, 48_000), false);
	assert.equal(audacityWaveformMode(AUDIO_EDITOR_MAX_PIXELS_PER_SECOND / 48_000), 'stem');
	assert.equal(canEditAudioSamplesAtZoom(AUDIO_EDITOR_MAX_PIXELS_PER_SECOND, 48_000), true);
});

test('sample editing is exposed only once a sample is drawn as its own stem', () => {
	assert.equal(AUDIO_EDITOR_SAMPLE_EDIT_MIN_PIXELS_PER_SAMPLE, 4);
	// The pencil arrives exactly when the renderer starts drawing sample heads.
	assert.equal(audacityWaveformShowsPoints(AUDIO_EDITOR_SAMPLE_EDIT_MIN_PIXELS_PER_SAMPLE), true);
	assert.equal(canEditAudioSamplesAtZoom(191_999, 48_000), false);
	assert.equal(canEditAudioSamplesAtZoom(192_000, 48_000), true);
	assert.equal(canEditAudioSamplesAtZoom(384_000, 48_000), true);
	assert.equal(canEditAudioSamplesAtZoom(Infinity, 48_000), false);
});

test('timeline mapping and pencil interpolation honor stretched and reversed clips', () => {
	assert.equal(timelineFrameToSourceFrame(CLIP, SOURCE, 100), 1_000);
	assert.equal(timelineFrameToSourceFrame(CLIP, SOURCE, 101), 1_002);
	assert.equal(timelineFrameToSourceFrame(CLIP, SOURCE, 5_099), 10_998);

	const edits = createPencilSampleEdits({
		clip: CLIP,
		source: SOURCE,
		channel: 0,
		points: [
			{ timelineFrame: 100, value: -1 },
			{ timelineFrame: 102, value: 1 },
		],
	});
	assert.deepEqual(edits.map((edit) => edit.frame), [1_000, 1_001, 1_002, 1_003, 1_004]);
	assert.deepEqual(edits.map((edit) => edit.value), [-1, -0.5, 0, 0.5, 1]);

	const reversed = { ...CLIP, reversed: true };
	assert.equal(timelineFrameToSourceFrame(reversed, SOURCE, 100), 10_999);
	assert.equal(timelineFrameToSourceFrame(reversed, SOURCE, 101), 10_997);
	const reversedEdits = createPencilSampleEdits({
		clip: reversed,
		source: SOURCE,
		points: [
			{ timelineFrame: 100, value: 0 },
			{ timelineFrame: 101, value: 1 },
		],
	});
	assert.deepEqual(reversedEdits.map((edit) => edit.frame), [10_997, 10_998, 10_999]);
	assert.deepEqual(reversedEdits.map((edit) => edit.value), [1, 0.5, 0]);
});

test('smoothing ranges are clipped to the selected clip and mapped back to source order', () => {
	assert.deepEqual(createSmoothSampleRange({
		clip: CLIP,
		source: SOURCE,
		startFrame: 98,
		endFrame: 104,
	}), {
		startFrame: 1_000,
		endFrame: 1_007,
		channel: null,
	});
	assert.deepEqual(createSmoothSampleRange({
		clip: { ...CLIP, reversed: true },
		source: SOURCE,
		startFrame: 100,
		endFrame: 104,
		channel: 0,
	}), {
		startFrame: 10_993,
		endFrame: 11_000,
		channel: 0,
	});
	assert.throws(() => createSmoothSampleRange({
		clip: CLIP,
		source: SOURCE,
		startFrame: 0,
		endFrame: 10,
	}), /must overlap/);
});

test('persistent pencil and smoothing edits publish new immutable sources atomically', async () => {
	const input = new Float32Array(SOURCE.frameCount);
	input[65_535] = 1;
	const store = createSampleStore(SOURCE, [input.subarray(0, 65_536), input.subarray(65_536)]);
	const pencil = await persistImmutableSampleEdit({
		store,
		source: SOURCE,
		sourceId: 'source-pencil',
		edits: [
			{ channel: 0, frame: 2, value: -0.75 },
			{ channel: 0, frame: 65_538, value: 0.25 },
		],
	});
	assert.deepEqual(pencil.changedChunkIndices, [0, 1]);
	assert.equal(store.sample('source-original', 2), 0);
	assert.equal(store.sample('source-original', 65_538), 0);
	assert.equal(store.sample('source-pencil', 2), -0.75);
	assert.equal(store.sample('source-pencil', 65_538), 0.25);
	assert.equal(pencil.source.id, 'source-pencil');
	assert.equal(pencil.source.opaqueExtensions.sampleEditRevision, 1);

	const smoothed = await persistImmutableSampleEdit({
		store,
		source: pencil.source,
		sourceId: 'source-smoothed',
		smooth: { startFrame: 65_533, endFrame: 65_539 },
		radius: 2,
	});
	assert.deepEqual(smoothed.changedChunkIndices, [0, 1]);
	assert.equal(store.sample('source-original', 65_535), 1);
	assert.ok(store.sample('source-smoothed', 65_535) > 0);
	assert.ok(store.sample('source-smoothed', 65_535) < 1);
	assert.equal(smoothed.source.opaqueExtensions.sampleEditRevision, 2);

	await smoothed.rollback();
	await smoothed.rollback();
	assert.equal(store.hasSource('source-smoothed'), false);
	assert.equal(store.hasSource('source-pencil'), true);
});

test('smoothing clamps finite float PCM that exceeds the pencil-edit range', async () => {
	const input = new Float32Array(SOURCE.frameCount);
	input.fill(2, 0, 8);
	const store = createSampleStore(SOURCE, [input.subarray(0, 65_536), input.subarray(65_536)]);

	await persistImmutableSampleEdit({
		store,
		source: SOURCE,
		sourceId: 'source-smoothed-overshoot',
		smooth: { startFrame: 1, endFrame: 4 },
		radius: 2,
	});

	assert.equal(store.sample(SOURCE.id, 2), 2);
	assert.equal(store.sample('source-smoothed-overshoot', 2), 1);
});

test('the production store persists only touched sample-edit chunks as a copy-on-write overlay', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `sample-edit-cow-${Date.now()}-${Math.random()}`,
	});
	const writer = await store.beginSourceWrite(SOURCE.id, {
		name: SOURCE.name,
		mimeType: SOURCE.mimeType,
		sampleRate: SOURCE.sampleRate,
		channelCount: SOURCE.channelCount,
		chunkFrames: SOURCE.chunkFrames,
	});
	await writer.write([new Float32Array(65_536)]);
	await writer.write([new Float32Array(4)]);
	await writer.commit({ chunkFrames: SOURCE.chunkFrames });

	const result = await persistImmutableSampleEdit({
		store,
		source: SOURCE,
		sourceId: 'source-cow-pencil',
		edits: [{ channel: 0, frame: 65_538, value: 0.625 }],
	});
	assert.deepEqual(result.changedChunkIndices, [1]);
	assert.equal(result.metadata.storage, 'copy-on-write');
	assert.equal(result.metadata.overrideChunkCount, 1);
	assert.equal(result.metadata.baseSourceId, SOURCE.id);
	const chunks = [];
	for await (const chunk of store.readSourceChunks(result.source.id)) chunks.push(chunk);
	assert.equal(chunks[0].channels[0][100], 0);
	assert.equal(chunks[1].channels[0][2], 0.625);
});

test('failed source streams abort pending sample writes without publishing partial PCM', async () => {
	let aborted = 0;
	let committed = 0;
	const store = {
		async beginSourceWrite() {
			return {
				async write() {},
				async commit() { committed += 1; },
				async abort() { aborted += 1; },
			};
		},
		async *readSourceChunks() {
			yield { index: 0, frames: 65_536, channels: [new Float32Array(65_536)] };
			throw new Error('fixture read failed');
		},
		async deleteSource() {},
	};
	await assert.rejects(() => persistImmutableSampleEdit({
		store,
		source: SOURCE,
		sourceId: 'source-failed',
		edits: [{ channel: 0, frame: 4, value: 0.5 }],
	}), /fixture read failed/);
	assert.equal(aborted, 1);
	assert.equal(committed, 0);
});

test('clip source replacement is one undoable command and retains both immutable history roots', () => {
	const project = createCurrentAudioEditorProject({
		id: 'sample-edit-project',
		now: '2026-01-01T00:00:00.000Z',
		sources: [SOURCE],
		tracks: [{ type: 'audio', id: 'track-sample-edit', name: 'Audio', clipIds: [CLIP.id] }],
		clips: [{ ...CLIP, trimStartFrames: 0, trimEndFrames: 0 }],
	});
	const derived = { ...SOURCE, id: 'source-derived', storageKey: 'source-derived' };
	let history = createEditorHistory(project);
	history = executeEditorCommand(history, {
		type: 'batch',
		commands: [
			createAddSourceCommand(derived),
			createReplaceClipSourceCommand(CLIP.id, derived.id),
		],
	}, { now: '2026-01-01T00:00:01.000Z' });
	assert.equal(history.present.clips[0].sourceId, derived.id);
	assert.equal(history.present.clips[0].renderCacheRevision, 1);
	assert.deepEqual([...collectHistorySourceIds(history)].sort(), [derived.id, SOURCE.id]);

	history = undoEditorCommand(history, { now: '2026-01-01T00:00:02.000Z' });
	assert.equal(history.present.clips[0].sourceId, SOURCE.id);
	assert.deepEqual([...collectHistorySourceIds(history)].sort(), [derived.id, SOURCE.id]);
	history = redoEditorCommand(history, { now: '2026-01-01T00:00:03.000Z' });
	assert.equal(history.present.clips[0].sourceId, derived.id);
});

test('cancelled sample edit drains its provider before rolling back backing data', async () => {
	const cancellation = Object.assign(new Error('sample edit stopped'), { name: 'AbortError' });
	const fixture = sampleEditServiceFixture({ activationFailure: cancellation });
	const pending = fixture.service.applySamplePencil({ points: [] });
	await fixture.cleanupStarted;
	assert.equal(fixture.providers.has('sample-edit-source'), false);
	assert.deepEqual(fixture.events, ['provider-dispose-start', 'publish-engine-providers']);
	fixture.resolveCleanup();
	assert.equal(await pending, null);
	assert.deepEqual(fixture.events, [
		'provider-dispose-start',
		'publish-engine-providers',
		'provider-dispose-end',
		'analysis-delete',
		'backing-rollback',
	]);
	assert.equal(fixture.statuses.at(-1), 'cancelled');
});

test('sample edit failure preserves provider cleanup errors and leaves backing data intact', async () => {
	const primaryFailure = new Error('activation failed');
	const cleanupFailure = new Error('provider release failed');
	const fixture = sampleEditServiceFixture({ activationFailure: primaryFailure, cleanupFailure });
	const pending = fixture.service.applySamplePencil({ points: [] });
	await fixture.cleanupStarted;
	assert.deepEqual(fixture.events, ['provider-dispose-start', 'publish-engine-providers']);
	fixture.resolveCleanup();
	await assert.rejects(pending, (error) => {
		assert.ok(error instanceof AggregateError);
		assert.strictEqual(error.cause, primaryFailure);
		assert.deepEqual(error.errors, [primaryFailure, cleanupFailure]);
		return true;
	});
	assert.deepEqual(fixture.events, [
		'provider-dispose-start', 'publish-engine-providers', 'provider-dispose-end',
	]);
});

function sampleEditServiceFixture({ activationFailure, cleanupFailure = null }) {
	const derivedSourceId = 'sample-edit-source';
	const track = { id: 'track', displayMode: 'waveform', clipIds: [CLIP.id] };
	const project = {
		id: 'project',
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		sources: [SOURCE],
		clips: [CLIP],
		tracks: [track],
	};
	const providers = new SourceChunkProviderRegistry();
	const state = {
		selectedClipId: CLIP.id,
		timelineView: 'waveform',
		pixelsPerSecond: 48_000,
		sampleEditAbort: null,
		sampleEditProcessing: false,
	};
	const events = [];
	const statuses = [];
	let markCleanupStarted;
	const cleanupStarted = new Promise((resolve) => { markCleanupStarted = resolve; });
	let resolveCleanup;
	const cleanupGate = new Promise((resolve) => { resolveCleanup = resolve; });
	const persisted = {
		source: { ...SOURCE, id: derivedSourceId, storageKey: derivedSourceId },
		metadata: { id: derivedSourceId },
		async rollback() { events.push('backing-rollback'); },
	};
	const service = createSampleEditService({
		lifetime: new EditorControllerLifetime(),
		activeSelection: () => null,
		async activateStoredSource() {
			providers.set(derivedSourceId, {
				async dispose() {
					events.push('provider-dispose-start');
					markCleanupStarted();
					await cleanupGate;
					events.push('provider-dispose-end');
					if (cleanupFailure) throw cleanupFailure;
				},
			});
			if (activationFailure.name === 'AbortError') {
				state.sampleEditAbort.abort(activationFailure);
				return;
			}
			throw activationFailure;
		},
		canEditAudioSamplesAtZoom: () => true,
		commit: () => { throw new Error('A failed sample edit must not commit.'); },
		copy: {
			audioClipNotFound: 'Missing clip',
			sampleEditCancelled: 'cancelled',
			sampleEditDone: 'done',
			sampleEditSaving: 'saving',
			sampleEditZoomRequired: 'Zoom required',
			timeSelectionRequired: 'Selection required',
		},
		createAddSourceCommand: () => ({}),
		createPencilSampleEdits: () => [{ channel: 0, frame: 0, value: 0 }],
		createReplaceClipSourceCommand: () => ({}),
		createSmoothSampleRange: () => null,
		createStableId: () => derivedSourceId,
		editingBlocked: () => false,
		findClip: (_project, clipId) => project.clips.find((clip) => clip.id === clipId),
		findClipTrack: () => track,
		findSource: (_project, sourceId) => project.sources.find((source) => source.id === sourceId),
		getProject: () => project,
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		persistImmutableSampleEdit: async () => persisted,
		preflightStorage: async () => undefined,
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot() {},
		async retireSourceChunkProvider(sourceId) {
			providers.delete(sourceId);
			events.push('publish-engine-providers');
			await providers.drain();
		},
		setStatus: (status) => { statuses.push(status); },
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		state,
		store: { async deleteAnalysis() { events.push('analysis-delete'); } },
		throwIfAborted(signal) { if (signal.aborted) throw signal.reason; },
	});
	return { cleanupStarted, events, providers, resolveCleanup, service, statuses };
}

function createSampleStore(source, chunks) {
	const sources = new Map([[source.id, { ...source }]]);
	const data = new Map([[source.id, chunks.map((channel) => [Float32Array.from(channel)])]]);
	return {
		async beginSourceWrite(sourceId, metadata) {
			const pending = [];
			let closed = false;
			return {
				async write(channels) {
					if (closed) throw new Error('closed');
					pending.push(channels.map((channel) => Float32Array.from(channel)));
				},
				async commit(extra = {}) {
					if (closed) throw new Error('closed');
					closed = true;
					const frameCount = pending.reduce((total, chunk) => total + chunk[0].length, 0);
					const record = { id: sourceId, ...metadata, ...extra, frameCount, chunkCount: pending.length };
					sources.set(sourceId, record);
					data.set(sourceId, pending);
					return record;
				},
				async abort() { closed = true; },
			};
		},
		async *readSourceChunks(sourceId) {
			for (const [index, channels] of (data.get(sourceId) || []).entries()) {
				yield { index, frames: channels[0].length, channels: channels.map((channel) => channel.slice()) };
			}
		},
		async deleteSource(sourceId) { sources.delete(sourceId); data.delete(sourceId); },
		hasSource(sourceId) { return sources.has(sourceId); },
		sample(sourceId, frame) {
			const chunkIndex = Math.floor(frame / 65_536);
			return data.get(sourceId)[chunkIndex][0][frame % 65_536];
		},
	};
}
