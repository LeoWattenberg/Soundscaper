/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createTrackLockAdmission } from '../src/common/editor/commands/track-lock-admission.ts';
import { projectForCommandConsumers } from '../src/common/editor/project-current-runtime.ts';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createLabel,
	createLabelTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

const NOW = '2026-08-11T12:00:00.000Z';
const RATE = { num: 24, den: 1 } as const;

test('retired locked-shaped wire is rejected before it can acquire current lock semantics', () => {
	assert.throws(() => applyEditorCommand({
		schemaVersion: 10,
		tracks: [{ type: 'audio', id: 'legacy-track', locked: true, clipIds: ['legacy-clip'] }],
		clips: [{ id: 'legacy-clip', sourceId: 'legacy-source', timelineStartFrame: 100 }],
	} as never, {
		type: 'clip/move', clipId: 'legacy-clip', timelineStartFrame: 200,
	}, { now: NOW }), /current audio editor project/iu);
});

test('protected opaque binary values remain byte-exact through an allowed locked-track control', () => {
	const project = audioProject({ locked: true, binaryOpaque: true });
	const edited = applyEditorCommand(project, {
		type: 'track/update', trackId: 'locked-track', changes: { name: 'Binary-safe' },
	}, { now: NOW });
	const opaque = recordSource(edited, 'locked-source').opaqueExtensions as {
		readonly bytes: Uint8Array;
		readonly buffer: ArrayBuffer;
	};
	assert.deepEqual(opaque.bytes, Uint8Array.of(0, 1, 254, 255));
	assert.deepEqual(new Uint8Array(opaque.buffer), Uint8Array.of(4, 3, 2, 1));
});

test('a new lock baseline protects canonical beats even when their resolved sample is unchanged', () => {
	const project = musicalProject(false);
	const projected = structuredClone(projectForCommandConsumers(project));
	const projectedTrack = projected.tracks[0] as Record<string, unknown> | undefined;
	if (!projectedTrack) throw new Error('Missing projected track.');
	projectedTrack.locked = true;
	const admission = createTrackLockAdmission(project, projected);
	admission.afterCommand(projected);

	const drifted = structuredClone(project);
	const driftedTrack = drifted.tracks[0] as Record<string, unknown> | undefined;
	const driftedClip = drifted.clips[0] as Record<string, unknown> | undefined;
	if (!driftedTrack || !driftedClip) throw new Error('Missing drift fixture.');
	driftedTrack.locked = true;
	driftedClip.musicalStartBeat = { num: 1_000_001, den: 1_000_000 };
	assert.equal(resolvedStartFrame(drifted), resolvedStartFrame(project));
	assert.throws(() => admission.assertPersistedResult(drifted), /Track musical-track is locked\./u);
});

test('locked audio and label tracks refuse owned edits and referenced source changes', () => {
	const project = audioProject({ locked: true });
	const before = structuredClone(project);
	for (const command of [
		{ type: 'clip/move', clipId: 'locked-clip', timelineStartFrame: 2_000 },
		{ type: 'clip/update', clipId: 'locked-clip', changes: { title: 'Changed' } },
		{ type: 'source/update', sourceId: 'locked-source', changes: { name: 'Changed source' } },
	] satisfies readonly AudioEditorCommand[]) {
		assert.throws(() => applyEditorCommand(project, command, { now: NOW }), /Track locked-track is locked\./u);
	}
	assert.deepEqual(project, before);

	const labels = labelProject();
	assert.throws(
		() => applyEditorCommand(labels, {
			type: 'label/update', trackId: 'labels', labelId: 'label', changes: { title: 'Changed' },
		}, { now: NOW }),
		/Track labels is locked\./u,
	);
});

test('locked tracks retain group membership even when only an unlocked peer is named', () => {
	const project = groupedProject();
	assert.throws(
		() => applyEditorCommand(project, {
			type: 'clip/ungroup', clipIds: ['peer-clip'],
		}, { now: NOW }),
		/Track locked-track is locked\./u,
	);
});

test('header, mix, view, rack, and unrelated source controls remain writable', () => {
	let project = audioProject({ locked: true });
	project = applyEditorCommand(project, {
		type: 'track/update', trackId: 'locked-track',
		changes: { name: 'Renamed', gain: 0.75, mute: true, collapsed: true, color: '#ff0000' },
	}, { now: NOW });
	project = applyEditorCommand(project, {
		type: 'effect/add', scope: 'track', trackId: 'locked-track',
		effect: { id: 'effect', type: 'highpass', enabled: true, params: { frequency: 100 } },
	}, { now: NOW });
	project = applyEditorCommand(project, {
		type: 'mixer/route-update', trackId: 'locked-track', changes: { groupId: null, sends: {} },
	}, { now: NOW });
	project = applyEditorCommand(project, {
		type: 'source/update', sourceId: 'other-source', changes: { name: 'Other renamed' },
	}, { now: NOW });

	const track = recordTrack(project, 'locked-track');
	assert.equal(track.locked, true);
	assert.equal(track.name, 'Renamed');
	assert.equal(track.gain, 0.75);
	assert.equal(track.mute, true);
	assert.equal((track.effects as readonly unknown[]).length, 1);
	assert.equal(recordSource(project, 'other-source').name, 'Other renamed');
});

test('direct locked structure and containing media-lane structure refuse', () => {
	const project = audioProject({ locked: true });
	for (const command of [
		{ type: 'track/remove', trackId: 'locked-track' },
		{ type: 'track/reorder', trackId: 'locked-track', index: 0 },
	] satisfies readonly AudioEditorCommand[]) {
		assert.throws(() => applyEditorCommand(project, command, { now: NOW }), /Track locked-track is locked\./u);
	}

	const lane = laneProject();
	for (const command of [
		{ type: 'track/remove', trackId: 'audio-lane' },
		{ type: 'track/reorder', trackId: 'audio-lane', index: 0 },
	] satisfies readonly AudioEditorCommand[]) {
		assert.throws(() => applyEditorCommand(lane, command, { now: NOW }), /Track video-lane is locked\./u);
	}
});

test('containing folder removal and movement refuse while unrelated index shifts remain allowed', () => {
	const project = folderProject();
	for (const command of [
		{ type: 'track-folder/remove', folderId: 'parent', disposition: 'promote' },
		{ type: 'track-node/move', sequenceId: 'main', nodeId: 'parent', parentFolderId: null, index: 1 },
	] satisfies readonly AudioEditorCommand[]) {
		assert.throws(() => applyEditorCommand(project, command, { now: NOW }), /Track locked-track is locked\./u);
	}

	const shifted = applyEditorCommand(audioProject({ locked: true }), {
		type: 'track/reorder', trackId: 'before-track', index: 2,
	}, { now: NOW });
	assert.deepEqual(shifted.tracks.map(({ id }) => id), ['locked-track', 'after-track', 'before-track']);
	assert.equal(recordTrack(shifted, 'locked-track').locked, true);

	const removed = applyEditorCommand(audioProject({ locked: true }), {
		type: 'track/remove', trackId: 'before-track',
	}, { now: NOW });
	assert.deepEqual(removed.tracks.map(({ id }) => id), ['locked-track', 'after-track']);
});

test('resolved sequence and musical timing changes refuse on locked tracks', () => {
	assert.throws(
		() => applyEditorCommand(videoProject(), {
			type: 'sequence/update', sequenceId: 'main', changes: { rate: { num: 30, den: 1 } },
		}, { now: NOW }),
		/Track video-track is locked\./u,
	);
	assert.throws(
		() => applyEditorCommand(musicalProject(), {
			type: 'tempo-event/update', eventId: 'tempo-root', changes: { bpm: { num: 60, den: 1 } },
		}, { now: NOW }),
		/Track musical-track is locked\./u,
	);
});

function audioProject(options: {
	readonly locked: boolean;
	readonly binaryOpaque?: boolean;
}): AudioEditorProjectCurrent {
	const lockedSource = createAudioSource({
		id: 'locked-source', name: 'Locked source', frameCount: 48_000, channelCount: 1, sampleRate: 48_000,
		...(options.binaryOpaque === true ? { opaqueExtensions: {
			bytes: Uint8Array.of(0, 1, 254, 255),
			buffer: Uint8Array.of(4, 3, 2, 1).buffer,
		} } : {}),
	});
	const otherSource = createAudioSource({
		id: 'other-source', name: 'Other source', frameCount: 48_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'locked-clip', sourceId: lockedSource.id, title: 'Locked clip',
		timelineStartFrame: 1_000, durationFrames: 1_000,
		sourceStartFrame: 0, sourceDurationFrames: 1_000,
	});
	return createCurrentAudioEditorProject({
		id: 'audio-lock-project', now: NOW,
		sources: [lockedSource, otherSource], clips: [clip],
		tracks: [
			createAudioTrack({ id: 'before-track', name: 'Before', locked: false }),
			createAudioTrack({
				id: 'locked-track', name: 'Locked', locked: options.locked, clipIds: [clip.id],
			}),
			createAudioTrack({ id: 'after-track', name: 'After', locked: false }),
		],
	});
}

function labelProject(): AudioEditorProjectCurrent {
	return createCurrentAudioEditorProject({
		id: 'label-lock-project', now: NOW,
		tracks: [createLabelTrack({
			id: 'labels', name: 'Labels', locked: true,
			labels: [createLabel({ id: 'label', title: 'Label', startFrame: 0, endFrame: 10 })],
		})],
	});
}

function groupedProject(): AudioEditorProjectCurrent {
	const first = createAudioSource({ id: 'locked-source', frameCount: 48_000, channelCount: 1 });
	const second = createAudioSource({ id: 'peer-source', frameCount: 48_000, channelCount: 1 });
	const locked = createAudioClip({
		id: 'locked-clip', sourceId: first.id, timelineStartFrame: 0,
		durationFrames: 100, sourceDurationFrames: 100, groupId: 'group',
	});
	const peer = createAudioClip({
		id: 'peer-clip', sourceId: second.id, timelineStartFrame: 200,
		durationFrames: 100, sourceDurationFrames: 100, groupId: 'group',
	});
	return createCurrentAudioEditorProject({
		id: 'group-lock-project', now: NOW, sources: [first, second], clips: [locked, peer],
		tracks: [
			createAudioTrack({ id: 'locked-track', locked: true, clipIds: [locked.id] }),
			createAudioTrack({ id: 'peer-track', locked: false, clipIds: [peer.id] }),
		],
	});
}

function laneProject(): AudioEditorProjectCurrent {
	return createCurrentAudioEditorProject({
		id: 'lane-lock-project', now: NOW,
		tracks: [
			createVideoTrack({ id: 'video-lane', locked: true, laneGroupId: 'lane' }),
			createAudioTrack({ id: 'audio-lane', locked: false, laneGroupId: 'lane' }),
		],
	});
}

function folderProject(): AudioEditorProjectCurrent {
	return createCurrentAudioEditorProject({
		id: 'folder-lock-project', now: NOW, primarySequenceId: 'main',
		tracks: [
			createAudioTrack({ id: 'locked-track', locked: true }),
			createAudioTrack({ id: 'other-track', locked: false }),
		],
		trackFolders: [{ id: 'parent', name: 'Parent' }],
		sequences: [{ id: 'main', trackNodes: [
			{ kind: 'folder', id: 'parent', parentFolderId: null },
			{ kind: 'track', id: 'locked-track', parentFolderId: 'parent' },
			{ kind: 'track', id: 'other-track', parentFolderId: null },
		] }],
	});
}

function videoProject(): AudioEditorProjectCurrent {
	const source = createVideoSource({
		id: 'video-source', frameCount: 48_000, sampleRate: 48_000,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount: 120,
	}, 48_000);
	const clip = createVideoClip({
		id: 'video-clip', sourceId: source.id, sequenceId: 'main',
		sequenceStartFrame: 1, sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2,
	}, { projectSampleRate: 48_000, sequence: { id: 'main', rate: RATE }, source });
	return createCurrentAudioEditorProject({
		id: 'video-lock-project', now: NOW, primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: RATE }], sources: [source], clips: [clip],
		tracks: [createVideoTrack({ id: 'video-track', locked: true, clipIds: [clip.id] })],
	});
}

function musicalProject(locked = true): AudioEditorProjectCurrent {
	const source = createAudioSource({ id: 'musical-source', frameCount: 192_000, channelCount: 1 });
	const tempoMap = {
		mode: 'musical' as const,
		events: [{ id: 'tempo-root', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	};
	const clip = createAudioClip({
		id: 'musical-clip', sourceId: source.id, anchor: 'musical',
		musicalStartBeat: { num: 1, den: 1 }, musicalExtent: 'beat',
		musicalDurationBeats: { num: 1, den: 1 }, sourceDurationFrames: 24_000,
	}, { projectSampleRate: 48_000, tempoMap });
	return createCurrentAudioEditorProject({
		id: 'musical-lock-project', now: NOW, tempoMap, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'musical-track', locked, clipIds: [clip.id] })],
	});
}

function resolvedStartFrame(project: AudioEditorProjectCurrent): unknown {
	const runtime = resolveRuntimeProjectProjection(project);
	return (runtime.clips[0] as Readonly<Record<string, unknown>> | undefined)?.timelineStartFrame;
}

function recordTrack(project: AudioEditorProjectCurrent, id: string): Readonly<Record<string, unknown>> {
	const track = project.tracks.find((candidate) => candidate.id === id);
	if (!track) throw new Error(`Missing track ${id}.`);
	return track;
}

function recordSource(project: AudioEditorProjectCurrent, id: string): Readonly<Record<string, unknown>> {
	const source = project.sources.find((candidate) => candidate.id === id);
	if (!source) throw new Error(`Missing source ${id}.`);
	return source;
}
