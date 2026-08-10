/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import { acquireVideoExportTimingIndexes } from '../src/common/editor/controller/video-export-timing.ts';
import { buildProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import {
	createAudioEditorProjectV10,
	createAudioTrackV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import {
	TRACK_FOLDER_STATE_PROJECTION_VERSION,
	inheritTrackFolderMediaStateProjectionV12,
	isTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../src/common/editor/track-folder-media-runtime.ts';
import { createTrackFoldersV12, type TrackFolderV12Options } from '../src/common/editor/track-folder-v12.ts';
import { createTrackHierarchyV12 } from '../src/common/editor/track-hierarchy-v12.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { resolveActiveVideoLayers } from '../src/common/editor/video-timeline.js';

type DataRecord = Record<string, unknown>;

interface FolderProject extends DataRecord {
	readonly schemaVersion: number;
	readonly mixer: DataRecord;
	readonly tracks: readonly DataRecord[];
	readonly trackFolders: ReturnType<typeof createTrackFoldersV12>;
	readonly trackFolderStateProjectionVersion?: number;
}

const NOW = '2026-08-09T12:00:00.000Z';

test('transient V12 media projection flattens folder state without mutating local flags or routes', () => {
	const route = { groupId: null, sends: { send: 0.25 }, extension: { color: 'blue' } };
	const project = audioFolderProject({
		branch: { collapsed: true, height: 320, hidden: true, solo: true },
		muted: { mute: true },
		routes: { selected: route },
	});
	const before = structuredClone(project);
	const projected = projectTrackFolderMediaStateV12(project);
	const selected = track(projected, 'selected');
	const nestedMuted = track(projected, 'nested-muted');
	const outside = track(projected, 'outside');

	assert.notStrictEqual(projected, project);
	assert.equal(projected.trackFolderStateProjectionVersion, TRACK_FOLDER_STATE_PROJECTION_VERSION);
	assert.equal(selected.mute, false);
	assert.equal(selected.solo, true);
	assert.equal(nestedMuted.mute, true);
	assert.equal(nestedMuted.solo, true, 'mute does not erase inherited solo membership');
	assert.equal(outside.mute, false);
	assert.equal(outside.solo, false);
	assert.deepEqual(project, before);
	assert.strictEqual((projected.mixer as DataRecord).routes, project.mixer.routes);
	assert.strictEqual((projected.mixer as DataRecord).routes, routeContainer(project));
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(Object.isFrozen(projected.tracks), true);
	assert.equal(Object.isFrozen(selected), true);
	assert.strictEqual(projectTrackFolderMediaStateV12(projected), projected);

	const cloned = structuredClone(projected);
	assert.equal(cloned.trackFolderStateProjectionVersion, TRACK_FOLDER_STATE_PROJECTION_VERSION);
	assert.throws(() => projectTrackFolderMediaStateV12(cloned), /not trusted/);
	inheritTrackFolderMediaStateProjectionV12(projected, cloned);
	assert.strictEqual(projectTrackFolderMediaStateV12(cloned), cloned);
	assert.equal(isTrackFolderMediaStateProjectionV12(cloned), true);
	assert.equal(track(cloned, 'nested-muted').mute, true);
	assert.equal(project.trackFolders[0]?.collapsed, true, 'collapse stays a UI-only local flag');
	assert.equal(project.trackFolders[0]?.height, 320, 'folder height stays a UI-only local value');
});

test('only exact V12 privately branded projections can bypass folder traversal', () => {
	let traversals = 0;
	const forged = {
		schemaVersion: 13,
		trackFolderStateProjectionVersion: TRACK_FOLDER_STATE_PROJECTION_VERSION,
		get tracks() {
			traversals += 1;
			throw new Error('forged projections must fail before hierarchy traversal');
		},
	};
	assert.throws(() => projectTrackFolderMediaStateV12(forged), /not trusted/);
	assert.equal(traversals, 0);

	const future = {
		schemaVersion: 14,
		trackFolderStateProjectionVersion: TRACK_FOLDER_STATE_PROJECTION_VERSION,
	};
	assert.strictEqual(projectTrackFolderMediaStateV12(future), future, 'future schemas stay opaque');
});

test('empty and video-only folder solos never synthesize an audio solo', () => {
	const project = audioFolderProject({
		branch: { solo: false },
		muted: { mute: false },
		extraFolders: [
			{ id: 'empty', name: 'Empty', solo: true },
			{ id: 'video-only', name: 'Video only', solo: true },
		],
		includeVideoOnlyTrack: true,
	});
	const projected = projectTrackFolderMediaStateV12(project);
	assert.equal(track(projected, 'selected').solo, false);
	assert.equal(track(projected, 'nested-muted').solo, false);
	assert.equal(track(projected, 'outside').solo, false);
	assert.equal(track(projected, 'video-only-track').hidden, false);
});

test('playback service projects exact V12 folder state before other transient playback features', () => {
	const project = audioFolderProject({ branch: { solo: true }, muted: { mute: true } });
	const service = createPlaybackProjectService({});
	const projection = service.projectForPlayback(project);
	assert.equal(projection.project.trackFolderStateProjectionVersion, 1);
	assert.equal(track(projection.project, 'selected').solo, true);
	assert.equal(track(projection.project, 'nested-muted').mute, true);
	assert.deepEqual(project.tracks.map(({ mute, solo }) => ({ mute, solo })), [
		{ mute: false, solo: false },
		{ mute: false, solo: false },
		{ mute: false, solo: false },
	]);

	const simulatedFullFallback = structuredClone({
		...projection.project,
		tracks: [{ id: 'rendered-mix', type: 'audio', mute: false, solo: false }],
	});
	inheritTrackFolderMediaStateProjectionV12(projection.project, simulatedFullFallback);
	assert.strictEqual(
		projectTrackFolderMediaStateV12(simulatedFullFallback),
		simulatedFullFallback,
		'post-fallback hierarchy replacement must not trigger a second validation',
	);
});

test('engine graph combines structural folder solo with existing group/send solo gates', () => {
	const structural = graphRouteGains(audioFolderProject({
		branch: { solo: true },
		muted: { mute: true },
		groupSolo: false,
		sendSolo: false,
	}));
	assert.deepEqual(structural.selected, [1, 0.5]);
	assert.deepEqual(structural['nested-muted'], [0, 0], 'folder mute wins over folder solo');
	assert.deepEqual(structural.outside, [0, 0]);

	const group = graphRouteGains(audioFolderProject({
		branch: { solo: false },
		muted: { mute: false },
		groupSolo: true,
		sendSolo: false,
	}));
	assert.deepEqual(group.selected, [0, 0]);
	assert.deepEqual(group.outside, [1, 0], 'a routed group solo opens only the direct group path');

	const send = graphRouteGains(audioFolderProject({
		branch: { solo: false },
		muted: { mute: true },
		groupSolo: false,
		sendSolo: true,
	}));
	assert.deepEqual(send.selected, [0, 0.5]);
	assert.deepEqual(send.outside, [0, 0.5], 'a send solo opens only the matching send path');
	assert.deepEqual(send['nested-muted'], [0, 0], 'effective folder mute closes even a soloed send');
});

test('nested folder hidden state gates A/V preview, video export selection, and timing acquisition', async () => {
	const project = videoFolderProject();
	const before = structuredClone(project);
	const layers = resolveActiveVideoLayers(project, 10);
	assert.deepEqual(layers.map(({ trackId }) => trackId), ['visible-video']);
	const plan = createVideoExportPlan(project, {
		format: 'mp4',
		includeAudio: false,
		range: { startFrame: 0, endFrame: 100 },
	});
	assert.deepEqual(
		plan.inputs.filter(({ kind }: DataRecord) => kind === 'video-source').map(({ sourceId }: DataRecord) => sourceId),
		['visible-source'],
	);
	assert.equal(plan.canvas.referenceSourceId, 'visible-source');

	let timingLoads = 0;
	const lease = await acquireVideoExportTimingIndexes(project, {
		loadMediaAsset() {
			timingLoads += 1;
			throw new Error('A hidden VFR source timing asset must not be loaded.');
		},
	}, {
		findClip: (candidate, id) => (record(candidate).clips as readonly DataRecord[])
			.find((clip) => clip.id === id),
		findSource: (candidate, id) => (record(candidate).sources as readonly DataRecord[])
			.find((source) => source.id === id),
	}, { assertCurrent: () => undefined });
	assert.equal(timingLoads, 0);
	assert.equal(lease.release(), false);
	assert.deepEqual(project, before);
});

test('legacy audio/video projects retain identity and local visibility semantics', () => {
	const legacy = {
		schemaVersion: 11,
		tracks: [{ id: 'audio', type: 'audio', mute: true, solo: false }],
		mixer: { routes: { audio: { groupId: null, sends: {} } } },
	};
	assert.strictEqual(projectTrackFolderMediaStateV12(legacy), legacy);

	const video = legacyVideoProject();
	assert.strictEqual(projectTrackFolderMediaStateV12(video), video);
	assert.deepEqual(resolveActiveVideoLayers(video, 10).map(({ trackId }) => trackId), ['visible']);
	assert.equal(resolveActiveVideoLayers(video, 10, { isTrackVisible: () => true }).length, 2);
});

interface AudioFolderProjectOptions {
	readonly branch?: Partial<TrackFolderV12Options>;
	readonly muted?: Partial<TrackFolderV12Options>;
	readonly extraFolders?: readonly TrackFolderV12Options[];
	readonly includeVideoOnlyTrack?: boolean;
	readonly groupSolo?: boolean;
	readonly sendSolo?: boolean;
	readonly routes?: Readonly<Record<string, unknown>>;
}

function audioFolderProject(options: AudioFolderProjectOptions = {}) {
	const tracks: DataRecord[] = [
		createAudioTrackV10({ id: 'selected', name: 'Selected' }),
		createAudioTrackV10({ id: 'nested-muted', name: 'Nested muted' }),
		createAudioTrackV10({ id: 'outside', name: 'Outside' }),
	];
	const folders: TrackFolderV12Options[] = [
		{ id: 'branch', name: 'Branch', ...options.branch },
		{ id: 'muted', name: 'Muted', ...options.muted },
		...(options.extraFolders ?? []),
	];
	const nodes: DataRecord[] = [
		{ kind: 'folder', id: 'branch', parentFolderId: null },
		{ kind: 'track', id: 'selected', parentFolderId: 'branch' },
		{ kind: 'folder', id: 'muted', parentFolderId: 'branch' },
		{ kind: 'track', id: 'nested-muted', parentFolderId: 'muted' },
		{ kind: 'track', id: 'outside', parentFolderId: null },
	];
	for (const folder of options.extraFolders ?? []) {
		nodes.push({ kind: 'folder', id: folder.id, parentFolderId: null });
		if (folder.id === 'video-only' && options.includeVideoOnlyTrack) {
			tracks.push(createVideoTrackV10({ id: 'video-only-track', name: 'Picture', clipIds: [] }));
			nodes.push({ kind: 'track', id: 'video-only-track', parentFolderId: folder.id });
		}
	}
	const base = createAudioEditorProjectV10({
		id: 'audio-folders', now: NOW, tracks,
		mixer: {
			groups: [{ id: 'group', name: 'Group', gain: 1, pan: 0, mute: false, solo: options.groupSolo ?? false, effects: [], envelope: [] }],
			sends: [{ id: 'send', name: 'Send', gain: 1, pan: 0, mute: false, solo: options.sendSolo ?? false, effects: [], envelope: [] }],
			routes: options.routes ?? {
				selected: { groupId: null, sends: { send: 0.5 } },
				'nested-muted': { groupId: null, sends: { send: 0.5 } },
				outside: { groupId: 'group', sends: { send: 0.5 } },
			},
		},
	});
	return asV12(base, folders, nodes);
}

function videoFolderProject() {
	const sampleRate = 8_000;
	const sequence = { id: 'main', rate: { num: 25, den: 1 } };
	const hiddenSource = createVideoSourceV10({
		id: 'hidden-source', storageKey: 'hidden-source', mimeType: 'video/mp4',
		frameCount: 100, sampleRate, width: 16, height: 16,
		sourceFrameRate: sequence.rate, sourceFrameCount: 25,
		timingAsset: null,
	}, sampleRate);
	const visibleSource = createVideoSourceV10({
		...hiddenSource, id: 'visible-source', storageKey: 'visible-source', timingAsset: null,
	}, sampleRate);
	const hiddenClip = createVideoClipV10({
		id: 'hidden-clip', sourceId: hiddenSource.id, sequenceId: sequence.id,
		sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25,
	}, { projectSampleRate: sampleRate, sequence, source: hiddenSource });
	const visibleClip = createVideoClipV10({
		id: 'visible-clip', sourceId: visibleSource.id, sequenceId: sequence.id,
		sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25,
	}, { projectSampleRate: sampleRate, sequence, source: visibleSource });
	const tracks: DataRecord[] = [
		createVideoTrackV10({ id: 'hidden-video', name: 'Hidden', clipIds: [hiddenClip.id], laneGroupId: 'av' }),
		createAudioTrackV10({ id: 'hidden-audio', name: 'Hidden audio', laneGroupId: 'av' }, sampleRate),
		createVideoTrackV10({ id: 'visible-video', name: 'Visible', clipIds: [visibleClip.id] }),
	];
	const base = createAudioEditorProjectV10({
		id: 'video-folders', now: NOW, sampleRate, sequences: [sequence], primarySequenceId: sequence.id,
		sources: [hiddenSource, visibleSource], clips: [hiddenClip, visibleClip], tracks,
	});
	return asV12(base, [{ id: 'hidden-folder', name: 'Hidden folder', hidden: true }], [
		{ kind: 'folder', id: 'hidden-folder', parentFolderId: null },
		{ kind: 'track', id: 'hidden-video', parentFolderId: 'hidden-folder' },
		{ kind: 'track', id: 'hidden-audio', parentFolderId: 'hidden-folder' },
		{ kind: 'track', id: 'visible-video', parentFolderId: null },
	]);
}

function asV12(
	base: DataRecord,
	folderOptions: readonly TrackFolderV12Options[],
	nodes: readonly DataRecord[],
): FolderProject {
	const trackFolders = createTrackFoldersV12(folderOptions);
	const tracks = base.tracks as readonly DataRecord[];
	const hierarchy = createTrackHierarchyV12([{ id: 'main', trackNodes: nodes }], {
		trackFolders,
		tracks: tracks.map(({ id, type, laneGroupId }) => ({ id, type, laneGroupId })),
	});
	const foundationSequence = (base.sequences as readonly DataRecord[])[0] ?? { id: 'main' };
	return {
		...base,
		schemaVersion: 13,
		trackFolders,
		sequences: [{
			...foundationSequence,
			id: 'main',
			trackNodes: hierarchy[0]!.trackNodes,
			trackIds: hierarchy[0]!.trackIds,
		}],
		timelineAnnotations: [],
		selection: { ...(base.selection as DataRecord), annotationIds: [] },
	} as unknown as FolderProject;
}

function graphRouteGains(project: ReturnType<typeof audioFolderProject>): Record<string, number[]> {
	const context = new MockAudioContext();
	const graph = buildProjectGraph(context as unknown as BaseAudioContext, context.destination as unknown as AudioNode, project, {
		metering: false,
		includeTrackPan: false,
		respectMuteSolo: true,
	});
	return Object.fromEntries([...graph.trackInputs].map(([id, input]) => {
		const trackGain = (input as unknown as MockAudioNode).connections[0];
		return [id, trackGain?.connections.map((node) => node.gain?.value ?? -1) ?? []];
	}));
}

class MockAudioParam {
	value = 1;
	setValueAtTime(value: number): void { this.value = value; }
}

class MockAudioNode {
	readonly connections: MockAudioNode[] = [];
	readonly gain?: MockAudioParam;
	constructor(gain = false) { if (gain) this.gain = new MockAudioParam(); }
	connect(target: MockAudioNode): MockAudioNode { this.connections.push(target); return target; }
	disconnect(): void { this.connections.length = 0; }
}

class MockAudioContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new MockAudioNode();
	createGain(): MockAudioNode { return new MockAudioNode(true); }
}

function track(project: Readonly<Record<string, unknown>>, id: string): DataRecord {
	const value = (project.tracks as readonly DataRecord[]).find((candidate) => candidate.id === id);
	if (!value) throw new Error(`Missing track ${id}.`);
	return value;
}

function routeContainer(project: Readonly<Record<string, unknown>>): unknown {
	return (project.mixer as DataRecord).routes;
}

function record(value: unknown): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A record is required.');
	return value as DataRecord;
}

function legacyVideoProject() {
	return {
		schemaVersion: 9,
		sampleRate: 100,
		sources: [
			{ id: 'hidden-source', kind: 'video', sampleRate: 100 },
			{ id: 'visible-source', kind: 'video', sampleRate: 100 },
		],
		clips: [
			{ id: 'hidden-clip', kind: 'video', sourceId: 'hidden-source', timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 0, sourceDurationFrames: 100 },
			{ id: 'visible-clip', kind: 'video', sourceId: 'visible-source', timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 0, sourceDurationFrames: 100 },
		],
		tracks: [
			{ id: 'hidden', type: 'video', hidden: true, clipIds: ['hidden-clip'] },
			{ id: 'visible', type: 'video', hidden: false, clipIds: ['visible-clip'] },
		],
		projectBin: { clips: [] },
	};
}

test('re-projecting the same canonical project returns the cached projection', () => {
	const project = audioFolderProject();
	const first = projectTrackFolderMediaStateV12(project);
	const second = projectTrackFolderMediaStateV12(project);
	assert.strictEqual(second, first, 'a cache hit must return the identical projection');
	assert.equal(isTrackFolderMediaStateProjectionV12(second), true);
});

test('mutating folder or leaf state on the same identity is never served from the cache', () => {
	const project = audioFolderProject() as unknown as Record<string, unknown> & {
		trackFolders: readonly Record<string, unknown>[];
		tracks: readonly Record<string, unknown>[];
	};
	const first = projectTrackFolderMediaStateV12(project);

	// Canonical folder records are frozen, so a same-identity edit replaces
	// records rather than mutating them - exactly what the fingerprint covers.
	project.trackFolders = project.trackFolders.map((folder, index) => (
		index === 0 ? { ...folder, mute: folder.mute !== true } : folder
	));
	const afterFolderEdit = projectTrackFolderMediaStateV12(project);
	assert.notStrictEqual(afterFolderEdit, first, 'a folder change must re-derive');

	project.tracks = project.tracks.map((track) => (
		track.type === 'audio' ? { ...track, solo: track.solo !== true } : track
	));
	const afterLeafEdit = projectTrackFolderMediaStateV12(project);
	assert.notStrictEqual(afterLeafEdit, afterFolderEdit, 'a leaf flag change must re-derive');
});
