/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import { prepareThreePointEditCommand } from '../src/common/editor/commands/three-point-edit-runtime.js';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';

const NOW = '2026-08-10T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 25, den: 1 });
const SEQUENCE = Object.freeze({ id: 'main', rate: RATE });
/** One second of the 25 fps sequence. */
const SECOND = SAMPLE_RATE;

type ProjectRecord = ReturnType<typeof editableProject>;

function videoSource(id: string, sourceFrameCount: number) {
	return createVideoSourceV10({
		kind: 'video',
		id,
		storageKey: id,
		name: `${id}.mp4`,
		mimeType: 'video/mp4',
		frameCount: SAMPLE_RATE * (sourceFrameCount / 25),
		sampleRate: SAMPLE_RATE,
		width: 640,
		height: 360,
		frameRate: RATE,
		sourceFrameCount,
		timingAsset: null,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: RATE, reason: 'timing-probe-unavailable', failures: [] },
		videoCodec: 'unknown',
		audioCodec: null,
		hasAudio: false,
	}, SAMPLE_RATE);
}

/** Two seconds of existing programme on a linked A/V pair, plus a bin source. */
function editableProject() {
	const existing = videoSource('existing-source', 50);
	const incoming = videoSource('incoming-source', 250);
	const audioSource = createAudioSourceV10({
		kind: 'audio',
		id: 'existing-audio-source',
		storageKey: 'existing-audio-source',
		name: 'Existing Audio',
		mimeType: 'audio/x-soundscaper-extracted',
		frameCount: SECOND * 2,
		channelCount: 2,
		sampleRate: SAMPLE_RATE,
	});
	const videoClip = createVideoClipV10({
		id: 'existing-video',
		sourceId: existing.id,
		sequenceId: SEQUENCE.id,
		sequenceStartFrame: 0,
		sequenceFrameCount: 50,
		sourceInFrame: 0,
		sourceFrameCount: 50,
		avLinkId: 'existing-link',
	}, { projectSampleRate: SAMPLE_RATE, sequence: SEQUENCE, source: existing });
	const audioClip = createAudioClipV10({
		id: 'existing-audio',
		sourceId: audioSource.id,
		timelineStartFrame: 0,
		durationFrames: SECOND * 2,
		sourceStartFrame: 0,
		sourceDurationFrames: SECOND * 2,
		avLinkId: 'existing-link',
	});
	return createCurrentAudioEditorProject({
		id: 'three-point-project',
		now: NOW,
		sampleRate: SAMPLE_RATE,
		sequences: [{ id: SEQUENCE.id, rate: RATE }],
		primarySequenceId: SEQUENCE.id,
		sources: [existing, incoming, audioSource],
		clips: [videoClip, audioClip],
		tracks: [
			createVideoTrackV10({ id: 'video-track', clipIds: ['existing-video'], laneGroupId: 'lane' }),
			createAudioTrackV10({ id: 'audio-track', clipIds: ['existing-audio'], laneGroupId: 'lane' }, SAMPLE_RATE),
		],
	});
}

function editCommand(project: ProjectRecord, options: Record<string, unknown>): AudioEditorCommand & {
	readonly trackIds: readonly string[];
	readonly placements: readonly { readonly clipId: string }[];
	readonly splitClipIds: Record<string, string>;
	readonly avLinkId?: string;
} {
	let next = 0;
	// The command runtime is JavaScript, so the prepared command is narrowed to
	// the protocol shape at this boundary.
	return prepareThreePointEditCommand(
		projectV10ForCommand(project as unknown as Record<string, unknown>),
		options,
		(prefix?: string) => `${String(prefix)}-${String(next++)}`,
	) as unknown as ReturnType<typeof editCommand>;
}

function placement(overrides: Record<string, unknown> = {}) {
	return {
		trackId: 'video-track',
		sourceId: 'incoming-source',
		sourceIn: 0,
		sourceCount: 25,
		...overrides,
	};
}

function lane(project: ProjectRecord, trackId: string) {
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	const clipIds: readonly string[] = Array.isArray(track?.clipIds) ? track.clipIds : [];
	return clipIds.map((clipId) => {
		const clip = project.clips.find((candidate) => candidate.id === clipId);
		return clip?.kind === 'video'
			? [clip.id, clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount]
			: [clip?.id, clip?.timelineStartFrame, clip?.durationFrames];
	});
}

test('an overwrite lifts only the lane it lands on and places the resolved range', () => {
	const project = editableProject();
	// One second of the incoming source, dropped one second into the programme.
	const command = editCommand(project, {
		mode: 'overwrite',
		startFrame: SECOND,
		endFrame: SECOND * 2,
		placements: [placement()],
	});
	assert.equal(command.type, 'edit/overwrite');
	assert.deepEqual(command.trackIds, ['video-track']);

	const edited = applyEditorCommand(project, command, { now: NOW }) as ProjectRecord;
	assert.deepEqual(lane(edited, 'video-track'), [
		['existing-video', 0, 25, 0, 25],
		[command.placements[0].clipId, 25, 25, 0, 25],
	]);
	// The audio lane was not targeted, but it is linked to the video the
	// overwrite trimmed, so it follows that clip's conformed endpoints — the
	// foundation A/V rule, not a second conversion of the edit range.
	assert.deepEqual(lane(edited, 'audio-track'), [['existing-audio', 0, SECOND]]);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('an insert opens every media lane in the sequence so nothing loses sync', () => {
	const project = editableProject();
	const command = editCommand(project, {
		mode: 'insert',
		startFrame: SECOND,
		endFrame: SECOND * 2,
		placements: [placement()],
	});
	assert.equal(command.type, 'edit/insert');
	assert.deepEqual([...command.trackIds].sort(), ['audio-track', 'video-track']);

	const edited = applyEditorCommand(project, command, { now: NOW }) as ProjectRecord;
	const splitVideoId = command.splitClipIds['existing-video'];
	assert.ok(splitVideoId, 'the clip the insert point falls inside is split');
	assert.deepEqual(lane(edited, 'video-track'), [
		['existing-video', 0, 25, 0, 25],
		[command.placements[0].clipId, 25, 25, 0, 25],
		[splitVideoId, 50, 25, 25, 25],
	]);
	// The audio lane received no material but opened by exactly the same span.
	const splitAudioId = command.splitClipIds['existing-audio'];
	assert.deepEqual(lane(edited, 'audio-track'), [
		['existing-audio', 0, SECOND],
		[splitAudioId, SECOND * 2, SECOND],
	]);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('an insert carries the markers and regions that sat after it', () => {
	// Insert-mode paste and ripple delete both move annotations with the media.
	// The three-point insert opened every media lane and left them behind, so a
	// marker ended up annotating whatever moved under it.
	const project = annotatedProject();
	const command = editCommand(project, {
		mode: 'insert',
		startFrame: SECOND,
		endFrame: SECOND * 2,
		placements: [placement()],
	});
	const edited = applyEditorCommand(project, command, { now: NOW }) as ProjectRecord;
	const annotations = edited.timelineAnnotations as unknown as readonly Record<string, unknown>[];

	assert.deepEqual(
		annotations.map(({ id, positionFrame, startFrame, endFrame }) => (
			{ id, positionFrame, startFrame, endFrame }
		)),
		[
			// Before the insert point: untouched.
			{ id: 'before', positionFrame: 0, startFrame: undefined, endFrame: undefined },
			// After it: moved by exactly the span the media opened.
			{ id: 'after', positionFrame: SECOND * 3, startFrame: undefined, endFrame: undefined },
			{ id: 'region-after', positionFrame: undefined, startFrame: SECOND * 3, endFrame: SECOND * 4 },
		],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

function annotatedProject(): ProjectRecord {
	const project = editableProject() as unknown as Record<string, unknown>;
	return createCurrentAudioEditorProject({
		...project,
		timelineAnnotations: [
			{
				id: 'before', sequenceId: SEQUENCE.id, kind: 'marker', anchor: 'sample',
				name: 'Before', positionFrame: 0, color: 'auto', batchId: null, opaqueExtensions: {},
			},
			{
				id: 'after', sequenceId: SEQUENCE.id, kind: 'marker', anchor: 'sample',
				name: 'After', positionFrame: SECOND * 2, color: 'auto', batchId: null, opaqueExtensions: {},
			},
			{
				id: 'region-after', sequenceId: SEQUENCE.id, kind: 'region', anchor: 'sample',
				name: 'Region', startFrame: SECOND * 2, endFrame: SECOND * 3,
				color: 'auto', batchId: null, opaqueExtensions: {},
			},
		],
	} as never) as unknown as ProjectRecord;
}

test('a linked pair lands under one A/V link', () => {
	const project = editableProject();
	const command = editCommand(project, {
		mode: 'overwrite',
		startFrame: 0,
		endFrame: SECOND,
		placements: [
			placement(),
			placement({ trackId: 'audio-track', sourceId: 'existing-audio-source', sourceCount: SECOND }),
		],
	});
	assert.ok(command.avLinkId, 'a two-lane edit allocates one shared link');

	const edited = applyEditorCommand(project, command, { now: NOW }) as ProjectRecord;
	const placed = command.placements.map(({ clipId }) => (
		edited.clips.find((clip) => clip.id === clipId)
	));
	assert.equal(placed.length, 2);
	assert.equal(placed[0]?.avLinkId, command.avLinkId);
	assert.equal(placed[1]?.avLinkId, command.avLinkId);
	// The audio member's placement is derived from the video's conformed
	// endpoints rather than converted a second time.
	assert.equal(placed[1]?.timelineStartFrame, 0);
	assert.equal(placed[1]?.durationFrames, SECOND);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('an edit that names no lane is rejected before it can half-apply', () => {
	const project = editableProject();
	assert.throws(() => editCommand(project, {
		mode: 'overwrite',
		startFrame: 0,
		endFrame: SECOND,
		placements: [],
	}), /at least one targeted lane/);
	assert.throws(() => editCommand(project, {
		mode: 'overwrite',
		startFrame: 0,
		endFrame: SECOND,
		placements: [placement({ trackId: 'missing-track' })],
	}), /Unknown track/);
});

test('both edits leave the pre-command document untouched for undo', () => {
	const project = editableProject();
	const before = structuredClone(project);
	for (const mode of ['insert', 'overwrite']) {
		applyEditorCommand(project, editCommand(project, {
			mode,
			startFrame: SECOND,
			endFrame: SECOND * 2,
			placements: [placement()],
		}), { now: NOW });
	}
	assert.deepEqual(project, before);
});
