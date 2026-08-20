/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	createAddTrackFolderCommand,
	createMoveTrackNodeCommand,
} from '../src/common/editor/commands/factories.ts';
import { prepareTransformClipsCommand } from '../src/common/editor/commands.js';
import { createAudioWarpClipAuthority } from '../src/common/editor/audio-warp-clip-authority.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';
import {
	applySoundscaperProjectCommandV21,
	soundscaperProjectForCommandConsumersV21,
} from '../src/soundscaper/editor-project-v21-commands.ts';
import {
	createSoundscaperProjectHistoryV21,
	executeSoundscaperProjectCommandV21,
	redoSoundscaperProjectCommandV21,
	undoSoundscaperProjectCommandV21,
} from '../src/soundscaper/editor-project-v21-history.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-14T11:00:00.000Z';
const LATER = '2026-08-14T11:01:00.000Z';
const HIGH_RATE = Object.freeze({ num: 40_000, den: 1 });

test('V21 commands replace complete lane and graph values by optimistic equality', () => {
	const project = fixture();
	const lane = {
		id: 'voice-gain',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [{ id: 'start', position: 0, value: 0.75 }],
		segments: [],
	} as const;
	const automated = applySoundscaperProjectCommandV21(project, {
		type: 'automation-lane/set', laneId: lane.id, expected: null, lane,
	}, { now: NOW });
	assert.deepEqual(automated.automationLanes, [lane]);
	assert.equal(automated.revision, project.revision + 1);
	assert.equal(automated.updatedAt, NOW);
	assert.throws(() => applySoundscaperProjectCommandV21(automated, {
		type: 'automation-lane/set', laneId: lane.id, expected: null, lane,
	}), /stale/iu);

	const mixer = structuredClone(automated.mixer);
	(mixer.vcas as unknown as Array<Record<string, unknown>>).push({
		id: 'all', name: 'All', gain: 1, mute: false, members: [{ kind: 'master' }],
	});
	const mixed = applySoundscaperProjectCommandV21(automated, {
		type: 'mixer-graph/set',
		expected: automated.mixer as unknown as Readonly<Record<string, unknown>>,
		mixer: mixer as unknown as Readonly<Record<string, unknown>>,
	}, { now: LATER });
	assert.equal(mixed.mixer.vcas[0]?.id, 'all');
	assert.equal(mixed.revision, automated.revision + 1);

	const history = createSoundscaperProjectHistoryV21(mixed);
	const unchanged = executeSoundscaperProjectCommandV21(history, {
		type: 'mixer-graph/set',
		expected: mixed.mixer as unknown as Readonly<Record<string, unknown>>,
		mixer: mixed.mixer as unknown as Readonly<Record<string, unknown>>,
	});
	assert.strictEqual(unchanged, history);
	assert.equal(unchanged.undoStack.length, 0);
	assert.equal(unchanged.present.revision, mixed.revision);
});

test('inherited edits preserve V21 authority and reconcile added audio tracks', () => {
	const project = fixture();
	const renamed = applySoundscaperProjectCommandV21(project, {
		type: 'project/rename', title: 'Renamed production project',
	});
	assert.equal(renamed.title, 'Renamed production project');
	assert.equal(renamed.schemaVersion, 21);
	assert.equal(Object.hasOwn(renamed.tracks[0] as object, 'envelope'), false);
	assert.deepEqual(renamed.mixer, project.mixer);

	const added = applySoundscaperProjectCommandV21(renamed, {
		type: 'track/add',
		track: createAudioTrack({ id: 'music', name: 'Music', clipIds: [] }),
	} as AudioEditorCommand);
	assert.equal(added.tracks.some(({ id }) => id === 'music'), true);
	assert.equal(added.mixer.edges.some((edge) => (
		edge.source.kind === 'track' && edge.source.id === 'music'
	)), true);
});

test('inherited ADM width changes reconcile the default V21 main output geometry', () => {
	const project = applySoundscaperProjectCommandV21(fixture(), {
		type: 'metadata/update',
		changes: {
			adm: {
				mode: 'authored',
				programme: { name: 'Main programme', language: 'eng' },
				content: { name: 'Main content', language: 'eng' },
				bed: { name: '5.1 bed', layout: '5.1', assignments: [] },
			},
		},
	} as AudioEditorCommand);
	assert.equal(project.masterChannels, 6);
	assert.equal(project.mixer.outputs.find(({ role }) => role === 'main')?.channelCount, 6);
	assert.deepEqual(
		project.mixer.edges.find(({ source }) => source.kind === 'master')?.channelMap,
		[0, 1, 2, 3, 4, 5],
	);
	assert.deepEqual(
		project.mixer.edges.find(({ source }) => source.kind === 'track')?.channelMap,
		[0, 1, 2, 3, 4, 5],
	);
});

test('an inherited mono import reconciles its default stereo assignment as dual mono', () => {
	const source = createAudioSource({
		id: 'mono-source', name: 'Mono source', storageKey: 'mono-source', mimeType: 'audio/wav',
		frameCount: 48_000, sampleRate: 48_000, channelCount: 1,
	});
	const clip = createAudioClip({
		id: 'mono-clip', sourceId: 'mono-source', timelineStartFrame: 0,
		sourceStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000,
	});
	const imported = applySoundscaperProjectCommandV21(fixture(), {
		type: 'batch',
		commands: [
			{ type: 'source/add', source },
			{ type: 'track/add', track: createAudioTrack({ id: 'mono', name: 'Mono', clipIds: [] }) },
			{ type: 'clip/add', trackId: 'mono', clip },
		],
	} as AudioEditorCommand);
	const assignment = imported.mixer.edges.find(({ id }) => id === 'assignment:track:mono:master');
	assert.deepEqual(assignment?.channelMap, [0, 0]);
});

test('unrelated inherited controls retain an authored mono channel map byte-for-byte', () => {
	const source = createAudioSource({
		id: 'mono-source', name: 'Mono source', storageKey: 'mono-source', mimeType: 'audio/wav',
		frameCount: 48_000, sampleRate: 48_000, channelCount: 1,
	});
	const clip = createAudioClip({
		id: 'mono-clip', sourceId: source.id, timelineStartFrame: 0,
		sourceStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000,
	});
	const mixer = structuredClone(createDefaultMixerGraphV21([{ id: 'mono' }], 2));
	const assignment = mixer.edges.find(({ id }) => id === 'assignment:track:mono:master');
	assert.ok(assignment);
	(assignment as { channelMap: readonly number[] }).channelMap = [0, -1];
	const project = createSoundscaperProjectV21({
		id: 'authored-mono-map', title: 'Authored mono map', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'mono', name: 'Mono', clipIds: ['mono-clip'] })],
		sequences: [{ id: 'main-sequence', trackIds: ['mono'] }],
		primarySequenceId: 'main-sequence', mixer,
	});
	const renamed = applySoundscaperProjectCommandV21(project, {
		type: 'project/rename', title: 'Still authored',
	});
	assert.deepEqual(renamed.mixer, project.mixer);
});

test('native V21 dispatch admits audio-warp commands without changing production authority', () => {
	const source = createAudioSource({
		id: 'warp-source', name: 'Warp source', storageKey: 'warp-source', mimeType: 'audio/wav',
		frameCount: 100, sampleRate: 48_000, channelCount: 2,
	});
	const clip = createAudioClip({
		id: 'warp-clip', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0,
		durationFrames: 100, sourceDurationFrames: 100, renderCacheRevision: 0, warpMap: null,
	});
	const project = createSoundscaperProjectV21({
		id: 'native-warp', title: 'Native warp', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'warp-track', name: 'Warp', clipIds: ['warp-clip'] })],
		sequences: [{ id: 'main-sequence', trackIds: ['warp-track'] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [{
			id: 'warp-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'warp-track' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1 }], segments: [],
		}],
	});
	const authority = createAudioWarpClipAuthority(project as never, 'warp-clip');
	const result = applySoundscaperProjectCommandV21(project, {
		type: 'audio-warp/set', clipId: 'warp-clip',
		expectedClipAuthority: authority as unknown as Readonly<Record<string, unknown>>,
		warpMap: {
			feature: 'audio-warp',
			points: [
				{ outer: 0, source: 0, mode: 'forward' },
				{ outer: 100, source: 100, mode: 'forward' },
			],
		},
	});
	assert.equal(result.schemaVersion, 21);
	assert.equal(result.clips[0]?.renderCacheRevision, 1);
	assert.deepEqual(result.automationLanes, project.automationLanes);
	assert.deepEqual(result.mixer, project.mixer);
});

test('native V21 command projections retain canonical video placement authority', () => {
	const source = createVideoSource({
		id: 'video-source', frameCount: 120, sampleRate: 48_000,
		width: 16, height: 16, frameRate: HIGH_RATE, sourceFrameCount: 100,
	}, 48_000);
	const clip = createVideoClip({
		id: 'video-clip', sourceId: source.id, sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2,
	}, {
		projectSampleRate: 48_000,
		sequence: { id: 'main-sequence', rate: HIGH_RATE },
		source,
	});
	const project = createSoundscaperProjectV21({
		id: 'native-video-transform', title: 'Native video transform', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createVideoTrack({ id: 'video-track', name: 'Video', clipIds: ['video-clip'] })],
		sequences: [{ id: 'main-sequence', rate: HIGH_RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
	const command = prepareTransformClipsCommand(soundscaperProjectForCommandConsumersV21(project), [{
		clipId: 'video-clip', trackId: 'video-track',
		changes: { durationFrames: videoFrameToSampleFrame(3, HIGH_RATE, 48_000, 'point') },
		sequencePlacement: { sequenceStartFrame: 0, sequenceFrameCount: 3 },
	}]) as AudioEditorCommand;
	const result = applySoundscaperProjectCommandV21(project, command);
	assert.deepEqual([
		result.clips[0]?.sequenceStartFrame,
		result.clips[0]?.sequenceFrameCount,
	], [0, 3]);
	assert.equal(result.schemaVersion, 21);
	assert.deepEqual(result.mixer, project.mixer);
});

test('native V21 command transactions admit the direct video-import batch', () => {
	const rate = Object.freeze({ num: 15, den: 1 });
	const project = createSoundscaperProjectV21({
		id: 'native-video-import', title: 'Native video import', now: NOW,
	});
	const source = createVideoSource({
		id: 'video-source', frameCount: 25_600, sampleRate: 48_000,
		width: 96, height: 54, frameRate: rate, sourceFrameCount: 8,
		videoCodec: 'vp8', timingDecision: { mode: 'conform-cfr-at-ingest', rate },
	}, 48_000);
	const clip = createVideoClip({
		id: 'video-clip', sourceId: source.id, sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 16,
		sourceInFrame: 0, sourceFrameCount: 8,
		avLinkId: 'video-import-link',
	}, {
		projectSampleRate: 48_000,
		sequence: { id: 'main-sequence', rate: { num: 30, den: 1 } },
		source,
	});
	const audioSource = createAudioSource({
		id: 'audio-source', name: 'Video Audio', storageKey: 'audio-source',
		mimeType: 'audio/x-soundscaper-extracted', frameCount: 25_600,
		sampleRate: 48_000, channelCount: 1,
	});
	const audioClip = createAudioClip({
		id: 'audio-clip', sourceId: audioSource.id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 25_600, durationFrames: 25_600,
		avLinkId: 'video-import-link',
	});
	const videoTrack = createVideoTrack({
		id: 'video-track', name: 'Video', clipIds: [], laneGroupId: 'video-import-lane',
	});
	const audioTrack = createAudioTrack({
		id: 'audio-track', name: 'Video Audio', clipIds: [], laneGroupId: 'video-import-lane',
	});
	const command = {
		type: 'batch',
		commands: [
			createAddSourceCommand(source),
			createAddSourceCommand(audioSource),
			{ ...createAddTrackCommand(videoTrack), index: 0 },
			{ ...createAddTrackCommand(audioTrack), index: 1 },
			createAddClipCommand('video-track', clip),
			createAddClipCommand('audio-track', audioClip),
		],
	} as AudioEditorCommand;

	const result = applySoundscaperProjectCommandV21(project, command);
	assert.deepEqual(result.sources.map(({ id }) => id), ['video-source', 'audio-source']);
	assert.deepEqual(result.tracks.map(({ id }) => id), ['video-track', 'audio-track']);
	assert.deepEqual(result.clips.map(({ id }) => id), ['video-clip', 'audio-clip']);
	assert.equal(result.mixer.edges.some((edge) => (
		edge.source.kind === 'track' && edge.source.id === 'audio-track'
	)), true);
});

test('folder commands reconcile nested V21 group authority in the same transaction', () => {
	let project = fixture();
	project = applySoundscaperProjectCommandV21(project, createAddTrackFolderCommand(
		'main-sequence', { id: 'dialogue', name: 'Dialogue' },
	));
	project = applySoundscaperProjectCommandV21(project, createAddTrackFolderCommand(
		'main-sequence', { id: 'takes', name: 'Takes' }, { parentFolderId: 'dialogue' },
	));
	project = applySoundscaperProjectCommandV21(project, createMoveTrackNodeCommand(
		'main-sequence', 'voice', 'takes', 0,
	));
	assert.deepEqual(project.mixer.groups.map(({ id }) => id), ['dialogue', 'takes']);
	assert.equal(project.mixer.edges.some((edge) => (
		edge.kind === 'assignment'
		&& edge.source.kind === 'track' && edge.source.id === 'voice'
		&& edge.destination.kind === 'mixer-node' && edge.destination.id === 'takes'
	)), true);
	assert.equal(project.mixer.edges.some((edge) => (
		edge.kind === 'assignment'
		&& edge.source.kind === 'mixer-node' && edge.source.id === 'takes'
		&& edge.destination.kind === 'mixer-node' && edge.destination.id === 'dialogue'
	)), true);
});

test('V21 folder reconciliation retains authored-ADM terminal ownership admission', () => {
	const project = createSoundscaperProjectV21({
		id: 'v21-adm-folders', title: 'V21 ADM folders', now: NOW,
		metadata: {
			adm: {
				mode: 'authored',
				programme: { name: 'Main programme', language: 'eng' },
				content: { name: 'Main content', language: 'eng' },
				bed: {
					name: 'Stereo bed', layout: 'stereo',
					assignments: [
						{ stripKind: 'track', stripId: 'dialogue', sourceChannel: 0, bedChannel: 'L' },
						{ stripKind: 'group', stripId: 'music', sourceChannel: 0, bedChannel: 'R' },
					],
				},
			},
		},
		trackFolders: [{ id: 'music', name: 'Music' }],
		tracks: [
			createAudioTrack({ id: 'strings', name: 'Strings', clipIds: [] }),
			createAudioTrack({ id: 'dialogue', name: 'Dialogue', clipIds: [] }),
		],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'music', parentFolderId: null },
				{ kind: 'track', id: 'strings', parentFolderId: 'music' },
				{ kind: 'track', id: 'dialogue', parentFolderId: null },
			],
		}],
		primarySequenceId: 'main-sequence',
	});
	const before = structuredClone(project);
	assert.throws(
		() => applySoundscaperProjectCommandV21(project, createMoveTrackNodeCommand(
			'main-sequence', 'dialogue', 'music', 0,
		)),
		/ADM authored programme pins its terminal strips/u,
	);
	assert.deepEqual(project, before);
});

test('native V21 inherited commands retain track-lock admission and product authority', () => {
	const source = createAudioSource({
		id: 'locked-source', name: 'Locked source', storageKey: 'locked-source',
		mimeType: 'audio/wav', frameCount: 100, sampleRate: 48_000, channelCount: 2,
	});
	const clip = createAudioClip({
		id: 'locked-clip', sourceId: source.id, timelineStartFrame: 0,
		sourceStartFrame: 0, durationFrames: 100, sourceDurationFrames: 100,
	});
	const project = createSoundscaperProjectV21({
		id: 'v21-locked-command', title: 'V21 locked command', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({
			id: 'locked-track', name: 'Locked', clipIds: ['locked-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', trackIds: ['locked-track'] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [{
			id: 'locked-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'locked-track' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1 }], segments: [],
		}],
	});
	const before = structuredClone(project);
	assert.throws(
		() => applySoundscaperProjectCommandV21(project, {
			type: 'clip/move', clipId: 'locked-clip', timelineStartFrame: 10,
		}),
		/Track locked-track is locked/u,
	);
	assert.throws(
		() => applySoundscaperProjectCommandV21(project, {
			type: 'batch',
			commands: [
				{ type: 'track/update', trackId: 'locked-track', changes: { locked: false } },
				{ type: 'clip/move', clipId: 'locked-clip', timelineStartFrame: 10 },
				{ type: 'track/update', trackId: 'locked-track', changes: { locked: true } },
			],
		}),
		/Track locked-track is locked/u,
	);
	assert.deepEqual(project, before);
	const renamed = applySoundscaperProjectCommandV21(project, {
		type: 'project/rename', title: 'Allowed header edit',
	});
	assert.deepEqual(renamed.automationLanes, project.automationLanes);
	assert.deepEqual(renamed.mixer, project.mixer);
});

test('track duplication remaps strip automation identities without copying freeze authority', () => {
	const source = applySoundscaperProjectCommandV21(fixture(), {
		type: 'automation-lane/set',
		laneId: 'voice-gain',
		expected: null,
		lane: {
			id: 'voice-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'voice-gain-start', position: 0, value: 0.75 }],
			segments: [],
		},
	});
	const duplicated = applySoundscaperProjectCommandV21(source, {
		type: 'track/add',
		track: createAudioTrack({ id: 'voice-copy', name: 'Voice copy', clipIds: [] }),
		productionDuplicate: { sourceTrackId: 'voice', effectIds: [] },
	} as AudioEditorCommand);
	const copiedLane = duplicated.automationLanes.find((lane) => (
		lane.address.kind === 'strip'
		&& lane.address.strip.kind === 'track'
		&& lane.address.strip.id === 'voice-copy'
	));
	assert.ok(copiedLane);
	assert.notEqual(copiedLane.id, source.automationLanes[0]?.id);
	assert.notEqual(copiedLane.points[0]?.id, source.automationLanes[0]?.points[0]?.id);
	assert.equal(Object.hasOwn(duplicated.tracks.find(({ id }) => id === 'voice-copy')!, 'audioFreeze'), false);
});

test('mixed batches are one V21 transaction and legacy mixer surface gestures author the exact graph', () => {
	const project = fixture();
	const lane = {
		id: 'master-gain',
		address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1 }], segments: [],
	} as const;
	const result = applySoundscaperProjectCommandV21(project, {
		type: 'batch',
		commands: [
			{ type: 'project/rename', title: 'One transaction' },
			{ type: 'automation-lane/set', laneId: lane.id, expected: null, lane },
		],
	}, { now: NOW });
	assert.equal(result.title, 'One transaction');
	assert.equal(result.automationLanes.length, 1);
	assert.equal(result.revision, project.revision + 1);
	assert.equal(result.updatedAt, NOW);
	const grouped = applySoundscaperProjectCommandV21(result, {
		type: 'batch', commands: [
			{ type: 'mixer/bus-add', busType: 'group', bus: { id: 'dialogue', name: 'Dialogue' } },
			{ type: 'mixer/route-update', trackId: 'voice', changes: { groupId: 'dialogue' } },
			{ type: 'mixer/bus-add', busType: 'send', bus: { id: 'reverb', name: 'Reverb' } },
			{ type: 'mixer/route-update', trackId: 'voice', changes: { sends: { reverb: 0.5 } } },
			{ type: 'mixer/bus-update', busType: 'send', busId: 'reverb', changes: { collapsed: false } },
		],
	} as AudioEditorCommand);
	assert.deepEqual(grouped.mixer.groups.map(({ id }) => id), ['dialogue']);
	assert.deepEqual(grouped.mixer.sends.map(({ id, collapsed }) => ({ id, collapsed })), [
		{ id: 'reverb', collapsed: false },
	]);
	assert.equal(Object.hasOwn(grouped.mixer, 'routes'), false);
	assert.equal(Object.hasOwn(grouped.mixer.groups[0]!, 'envelope'), false);
	assert.equal(grouped.mixer.edges.some((edge) => (
		edge.id === 'assignment:track:voice:mixer-node:dialogue'
		&& edge.kind === 'assignment'
		&& edge.destination.kind === 'mixer-node'
		&& edge.destination.id === 'dialogue'
	)), true);
	assert.equal(grouped.mixer.edges.some((edge) => (
		edge.id === 'send:track:voice:mixer-node:reverb'
		&& edge.kind === 'send'
		&& edge.level === 0.5
	)), true);
	assert.throws(() => applySoundscaperProjectCommandV21(grouped, {
		type: 'mixer/bus-update', busType: 'send', busId: 'reverb', changes: { envelope: [] },
	} as AudioEditorCommand), /envelope|automation lane/iu);
	const removed = applySoundscaperProjectCommandV21(grouped, {
		type: 'mixer/bus-remove', busType: 'group', busId: 'dialogue',
	} as AudioEditorCommand);
	assert.deepEqual(removed.mixer.groups, []);
	assert.equal(removed.mixer.edges.some((edge) => (
		edge.id === 'assignment:track:voice:master'
		&& edge.destination.kind === 'master'
	)), true);
});

test('inherited send-rack commands retain exact V21 graph authority', () => {
	const withSend = applySoundscaperProjectCommandV21(fixture(), {
		type: 'mixer/bus-add', busType: 'send', bus: { id: 'reverb', name: 'Reverb' },
	} as AudioEditorCommand);
	const effect = {
		id: 'send-reverb', type: 'reverb', enabled: true,
		params: { mix: 0.2, decay: 2, preDelay: 0.01 },
	};
	const added = applySoundscaperProjectCommandV21(withSend, {
		type: 'effect/add', scope: 'send', trackId: 'reverb', busId: 'reverb', effect,
	} as AudioEditorCommand);
	assert.deepEqual(added.mixer.sends[0]?.effects, [effect]);
	assert.equal(Object.hasOwn(added.mixer, 'routes'), false);

	const disabled = applySoundscaperProjectCommandV21(added, {
		type: 'effect/update', scope: 'send', trackId: 'reverb', busId: 'reverb',
		effectId: effect.id, changes: { enabled: false },
	} as AudioEditorCommand);
	assert.equal(disabled.mixer.sends[0]?.effects[0]?.enabled, false);
	assert.equal(Object.hasOwn(disabled.mixer, 'routes'), false);

	const removed = applySoundscaperProjectCommandV21(disabled, {
		type: 'effect/remove', scope: 'send', trackId: 'reverb', busId: 'reverb', effectId: effect.id,
	} as AudioEditorCommand);
	assert.deepEqual(removed.mixer.sends[0]?.effects, []);
	assert.equal(Object.hasOwn(removed.mixer, 'routes'), false);
});

test('V21 history restores lanes and graph exactly across undo and redo', () => {
	const project = fixture();
	const lane = {
		id: 'voice-pan',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'pan' },
		timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 0 }], segments: [],
	} as const;
	const initial = createSoundscaperProjectHistoryV21(project);
	const executed = executeSoundscaperProjectCommandV21(initial, {
		type: 'automation-lane/set', laneId: lane.id, expected: null, lane,
	}, { now: NOW });
	assert.equal(executed.undoStack.length, 1);
	assert.equal(executed.present.automationLanes.length, 1);
	const undone = undoSoundscaperProjectCommandV21(executed, { now: LATER });
	assert.deepEqual(undone.present.automationLanes, []);
	assert.deepEqual(undone.present.mixer, project.mixer);
	assert.equal(undone.present.revision, executed.present.revision + 1);
	const redone = redoSoundscaperProjectCommandV21(undone);
	assert.deepEqual(redone.present.automationLanes, [lane]);
	assert.equal(redone.undoStack.length, 1);
});

function fixture() {
	return createSoundscaperProjectV21({
		id: 'production-command-project', title: 'Production command project', now: NOW,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	});
}
