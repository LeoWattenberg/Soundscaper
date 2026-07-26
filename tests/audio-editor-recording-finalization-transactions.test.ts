/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLegacyRecordingFinalization,
	snapshotLegacyRecordingFinalization,
} from '../src/common/editor/controller/legacy-recording-finalization.ts';
import {
	createRoutedRecordingFinalization,
	snapshotRoutedRecordingFinalization,
} from '../src/common/editor/controller/routed-recording-finalization.ts';
import type {
	RecordingFinalizationCommonRuntime,
	RoutedRecordingFinalizationRuntime,
} from '../src/common/editor/controller/recording-finalization-types.ts';
import type { RecordingFinalizationSnapshot } from '../src/common/editor/controller/recording-session-service.ts';
import type {
	RecordingProject,
	RecordingRoute,
	RecordingSourceWriter,
	RoutedRecordingEntry,
} from '../src/common/editor/controller/recording-transaction-types.ts';
import type { RecordingPreview } from '../src/common/editor/controller/recording-model.ts';

function createPreview(trackId = 'track-1'): RecordingPreview {
	return {
		trackId,
		startFrame: 10,
		framesToSkip: 0,
		frames: 0,
		framesPerBucket: 64,
		bucketFrames: 0,
		minimums: [1],
		maximums: [-1],
		buckets: [[]],
	};
}

function createWriter(framesWritten = 100) {
	let aborts = 0;
	let commits = 0;
	const writer: RecordingSourceWriter = {
		framesWritten,
		async write() {},
		async commit() {
			commits += 1;
			return { name: 'Take', channelCount: 1 };
		},
		async abort() { aborts += 1; },
	};
	return { writer, aborts: () => aborts, commits: () => commits };
}

function createSnapshot(overrides: Partial<RecordingFinalizationSnapshot> = {}): RecordingFinalizationSnapshot {
	const writer = createWriter().writer;
	return {
		recorder: { stop: async () => {}, dispose: async () => {} },
		entries: null,
		writer,
		sourceId: 'source-1',
		trackId: 'track-1',
		startFrame: 10,
		sourceOffsetFrames: 5,
		selection: null,
		resampler: { push: (channels: readonly Float32Array[]) => channels, finish: () => [] },
		sampleRate: 48_000,
		preview: createPreview(),
		discardRequested: false,
		fatalError: null,
		...overrides,
	};
}

function createRuntime() {
	const project: RecordingProject = Object.freeze({
		id: 'project-1',
		tracks: Object.freeze([{ id: 'track-1', type: 'audio' }]),
	});
	let current = true;
	let activateHook: (() => void) | null = null;
	const commits: Array<Readonly<{
		project: RecordingProject;
		commands: readonly unknown[];
		selection: Readonly<Record<string, unknown>>;
	}>> = [];
	const deactivated: string[] = [];
	const deleted: string[] = [];
	const analysisDeleted: string[] = [];
	const routeHealth: Array<[string, string]> = [];
	let statusCalls = 0;
	let pauses = 0;
	const common: RecordingFinalizationCommonRuntime = {
		sourceChunkFrames: 65_536,
		captureProjectScope: () => ({
			project,
			projectId: project.id,
			assertCurrent() {
				if (!current) throw new DOMException('Project changed.', 'AbortError');
			},
		}),
		projectSampleRate: () => 48_000,
		pauseTransport: () => { pauses += 1; },
		disposeRecorder: async (recorder) => { await recorder.dispose?.({ stopTracks: false }); },
		appendPreview: () => {},
		scaleFrames: (frames, inputRate, outputRate) => Math.round(frames * outputRate / inputRate),
		createStableId: () => 'clip-1',
		createAddSourceCommand: (source) => ({ type: 'add-source', source }),
		preparePunchCommand: (targetProject, options) => ({ type: 'punch', targetProject, options }),
		activateStoredSource: async () => { activateHook?.(); },
		commitBatch: (targetProject, commands, selection) => {
			commits.push({ project: targetProject, commands, selection });
		},
		setStatusDone: () => { statusCalls += 1; },
		deactivateSource: (sourceId) => { deactivated.push(sourceId); },
		deleteStoredSource: async (sourceId) => { deleted.push(sourceId); },
	};
	const routed: RoutedRecordingFinalizationRuntime = {
		...common,
		setRouteHealth: (trackId, health) => { routeHealth.push([trackId, health]); },
		deleteSourceAnalysis: async (sourceId) => { analysisDeleted.push(sourceId); },
	};
	return {
		common,
		routed,
		project,
		commits,
		deactivated,
		deleted,
		analysisDeleted,
		routeHealth,
		statusCalls: () => statusCalls,
		pauses: () => pauses,
		setCurrent: (value: boolean) => { current = value; },
		setActivateHook: (hook: (() => void) | null) => { activateHook = hook; },
	};
}

function createRoutedEntry(
	writer: RecordingSourceWriter,
	overrides: Partial<RoutedRecordingEntry> = {},
): RoutedRecordingEntry {
	const route: RecordingRoute = { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 };
	return {
		trackId: 'track-1',
		route,
		sourceKey: 'device:default',
		sourceId: 'source-1',
		writer,
		previewResampler: { push: (channels) => channels, finish: () => [] },
		preview: createPreview(),
		sampleRate: 48_000,
		selection: null,
		recordingStartFrame: 10,
		sourceOffsetFrames: 5,
		sourceOffsetProjectFrames: 5,
		...overrides,
	};
}

test('legacy finalization validates and freezes its mutable controller snapshot', () => {
	const input = createSnapshot({ selection: { startFrame: 2, endFrame: 12 } });
	const snapshot = snapshotLegacyRecordingFinalization(input);
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.selection), true);
	assert.notStrictEqual(snapshot.selection, input.selection);
	assert.throws(
		() => snapshotLegacyRecordingFinalization(createSnapshot({ writer: null })),
		/The recording finalization writer is invalid/,
	);
	assert.throws(
		() => snapshotLegacyRecordingFinalization(createSnapshot({ sourceId: null })),
		/source and track are required/,
	);
	assert.throws(
		() => snapshotLegacyRecordingFinalization(createSnapshot({ selection: { startFrame: Number.NaN, endFrame: 2 } })),
		/selection is invalid/,
	);
	assert.throws(
		() => snapshotLegacyRecordingFinalization(createSnapshot({ resampler: {} })),
		/resampler is invalid/,
	);
	assert.throws(
		() => snapshotLegacyRecordingFinalization(createSnapshot({ preview: 'invalid' })),
		/preview is invalid/,
	);
});

test('legacy finalization commits an atomic source and punch batch against the captured project', async () => {
	const fixture = createRuntime();
	const writer = createWriter(105);
	const finalizer = createLegacyRecordingFinalization(fixture.common);
	await finalizer.finalize(createSnapshot({ writer: writer.writer }));

	assert.equal(writer.commits(), 1);
	assert.equal(writer.aborts(), 0);
	assert.equal(fixture.pauses(), 1);
	assert.equal(fixture.commits.length, 1);
	assert.strictEqual(fixture.commits[0]?.project, fixture.project);
	assert.equal(fixture.commits[0]?.commands.length, 2);
	assert.deepEqual(fixture.commits[0]?.selection, {
		selectTrackId: 'track-1',
		selectClipId: 'clip-1',
	});
	assert.equal(fixture.statusCalls(), 1);
});

test('legacy finalization suppresses a late project commit and rolls back the stored source', async () => {
	const fixture = createRuntime();
	const writer = createWriter();
	fixture.setActivateHook(() => fixture.setCurrent(false));
	const finalizer = createLegacyRecordingFinalization(fixture.common);

	await assert.rejects(
		finalizer.finalize(createSnapshot({ writer: writer.writer })),
		(error: unknown) => (error as DOMException).name === 'AbortError',
	);
	assert.deepEqual(fixture.commits, []);
	assert.deepEqual(fixture.deactivated, ['source-1']);
	assert.deepEqual(fixture.deleted, ['source-1']);
	assert.equal(writer.aborts(), 1);
});

test('legacy finalization handles discard, empty, fatal, and selected punch transactions', async () => {
	const discardedFixture = createRuntime();
	const discarded = createWriter();
	await createLegacyRecordingFinalization(discardedFixture.common).finalize(createSnapshot({
		writer: discarded.writer,
		discardRequested: true,
	}));
	assert.equal(discarded.aborts(), 1);
	assert.deepEqual(discardedFixture.commits, []);

	const emptyFixture = createRuntime();
	const empty = createWriter(5);
	await createLegacyRecordingFinalization(emptyFixture.common).finalize(createSnapshot({ writer: empty.writer }));
	assert.equal(empty.aborts(), 1);
	assert.deepEqual(emptyFixture.commits, []);

	const fatalFixture = createRuntime();
	const fatal = createWriter();
	const failure = new Error('capture failed');
	await assert.rejects(
		createLegacyRecordingFinalization(fatalFixture.common).finalize(createSnapshot({
			writer: fatal.writer,
			fatalError: failure,
		})),
		failure,
	);
	assert.equal(fatal.aborts(), 1);

	const selectedFixture = createRuntime();
	const selected = createWriter();
	await createLegacyRecordingFinalization(selectedFixture.common).finalize(createSnapshot({
		writer: selected.writer,
		selection: { startFrame: 10, endFrame: 30 },
	}));
	const punch = selectedFixture.commits[0]?.commands[1] as Readonly<{
		readonly options: Readonly<{ readonly endFrame: number }>;
	}>;
	assert.equal(punch.options.endFrame, 30);
});

test('routed finalization snapshots entries and publishes one atomic batch', async () => {
	const fixture = createRuntime();
	const committed = createWriter(100);
	const skipped = createWriter(5);
	const entries = [
		createRoutedEntry(committed.writer),
		createRoutedEntry(skipped.writer, {
			trackId: 'track-2',
			sourceId: 'source-2',
			sourceOffsetFrames: 5,
		}),
	];
	const input = createSnapshot({ entries });
	const snapshot = snapshotRoutedRecordingFinalization({ ...input, entries });
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.entries), true);
	assert.notStrictEqual(snapshot.entries[0], entries[0]);

	await createRoutedRecordingFinalization(fixture.routed).finalize({ ...input, entries });
	assert.equal(committed.commits(), 1);
	assert.equal(skipped.commits(), 0);
	assert.equal(skipped.aborts(), 1);
	assert.deepEqual(fixture.routeHealth, [['track-2', 'skipped']]);
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.commits[0]?.commands.length, 2);
	assert.strictEqual(fixture.commits[0]?.project, fixture.project);
});

test('routed finalization rejects malformed entries before disposing the recorder', () => {
	const input = createSnapshot({ entries: [{}] });
	assert.throws(
		() => snapshotRoutedRecordingFinalization({ ...input, entries: [{}] }),
		/routed recording entry is invalid/,
	);
	const writer = createWriter().writer;
	const entry = createRoutedEntry(writer);
	assert.throws(
		() => snapshotRoutedRecordingFinalization({
			...input,
			entries: [{ ...entry, route: { ...entry.route, channelCount: Number.NaN } }],
		}),
		/route channel count is invalid/,
	);
});

test('routed finalization handles discarded, fatal, and empty selections without a batch', async () => {
	const discardedFixture = createRuntime();
	const discarded = createWriter();
	const discardedEntry = createRoutedEntry(discarded.writer);
	await createRoutedRecordingFinalization(discardedFixture.routed).finalize({
		...createSnapshot(),
		entries: [discardedEntry],
		discardRequested: true,
	});
	assert.equal(discarded.aborts(), 1);

	const fatalFixture = createRuntime();
	const fatal = createWriter();
	const failure = new Error('routed capture failed');
	await assert.rejects(
		createRoutedRecordingFinalization(fatalFixture.routed).finalize({
			...createSnapshot(),
			entries: [createRoutedEntry(fatal.writer)],
			fatalError: failure,
		}),
		failure,
	);
	assert.equal(fatal.aborts(), 1);

	const emptyFixture = createRuntime();
	const empty = createWriter();
	await createRoutedRecordingFinalization(emptyFixture.routed).finalize({
		...createSnapshot(),
		entries: [createRoutedEntry(empty.writer, {
			selection: { startFrame: 20, endFrame: 20 },
		})],
	});
	assert.deepEqual(emptyFixture.commits, []);
});

test('routed finalization rolls every committed source back after project replacement', async () => {
	const fixture = createRuntime();
	const writer = createWriter();
	fixture.setActivateHook(() => fixture.setCurrent(false));
	const entry = createRoutedEntry(writer.writer);
	const input = createSnapshot({ entries: [entry] });

	await assert.rejects(
		createRoutedRecordingFinalization(fixture.routed).finalize({ ...input, entries: [entry] }),
		(error: unknown) => (error as DOMException).name === 'AbortError',
	);
	assert.deepEqual(fixture.commits, []);
	assert.deepEqual(fixture.deactivated, ['source-1']);
	assert.deepEqual(fixture.analysisDeleted, ['source-1']);
	assert.deepEqual(fixture.deleted, ['source-1']);
	assert.equal(writer.aborts(), 1);
});
