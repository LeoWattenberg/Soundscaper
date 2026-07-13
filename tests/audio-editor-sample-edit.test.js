import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_SAMPLE_EDIT_MIN_PIXELS_PER_SAMPLE,
	canEditAudioSamplesAtZoom,
	createPencilSampleEdits,
	createSmoothSampleRange,
	persistImmutableSampleEdit,
	timelineFrameToSourceFrame,
} from '../src/lib/tools/audio-editor/sample-edit.js';
import {
	createAddSourceCommand,
	createReplaceClipSourceCommand,
} from '../src/lib/tools/audio-editor/commands.js';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/lib/tools/audio-editor/history.js';
import { createAudioEditorProjectV2 } from '../src/lib/tools/audio-editor/project-v2.js';
import { collectHistorySourceIds } from '../src/lib/tools/audio-editor/retention.js';
import { createProjectStore } from '../src/lib/tools/audio-editor/storage.js';

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

test('sample editing is exposed only once one sample spans one visible pixel', () => {
	assert.equal(AUDIO_EDITOR_SAMPLE_EDIT_MIN_PIXELS_PER_SAMPLE, 1);
	assert.equal(canEditAudioSamplesAtZoom(47_999, 48_000), false);
	assert.equal(canEditAudioSamplesAtZoom(48_000, 48_000), true);
	assert.equal(canEditAudioSamplesAtZoom(96_000, 48_000), true);
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
	const project = createAudioEditorProjectV2({
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
