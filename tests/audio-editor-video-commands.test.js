import test from 'node:test';
import assert from 'node:assert/strict';

import {
	applyEditorCommand,
	collectClipTransformIds,
	collectClipTrimIds,
	prepareLinkedSplitCommand,
	prepareLinkAvCommand,
	prepareTransformClipsCommand,
	prepareUnlinkAvCommand,
} from '../src/lib/tools/audio-editor/commands.js';
import { validateAudioEditorProject } from '../src/lib/tools/audio-editor/project.js';
import {
	createAudioClipV4,
	createAudioEditorProjectV4,
	createAudioSourceV4,
	createAudioTrackV4,
	createVideoClipV4,
	createVideoSourceV4,
	createVideoTrackV4,
} from '../src/lib/tools/audio-editor/project-v4.js';

const NOW = '2026-07-18T12:00:00.000Z';
const EDITED_AT = '2026-07-18T12:01:00.000Z';

function apply(project, command) {
	return applyEditorCommand(project, command, { now: EDITED_AT });
}

function createMediaSources() {
	return [
		createVideoSourceV4({
			id: 'video-source',
			name: 'camera.mp4',
			mimeType: 'video/mp4',
			storageKey: 'media/video-source',
			frameCount: 2_000,
			sampleRate: 48_000,
			width: 1_920,
			height: 1_080,
			frameRate: 30,
			videoCodec: 'avc1',
			audioCodec: 'mp4a',
			hasAudio: true,
		}),
		createAudioSourceV4({
			id: 'audio-source',
			name: 'camera audio',
			storageKey: 'pcm/audio-source',
			frameCount: 2_000,
			channelCount: 2,
			sampleRate: 48_000,
		}),
	];
}

function createTimelineClipPair({ linked = true, timelineStartFrame = 100 } = {}) {
	const avLinkId = linked ? 'av-original' : null;
	return [
		createVideoClipV4({
			id: 'video-clip',
			sourceId: 'video-source',
			title: 'Camera video',
			timelineStartFrame,
			sourceStartFrame: 100,
			sourceDurationFrames: 600,
			durationFrames: 600,
			avLinkId,
		}),
		createAudioClipV4({
			id: 'audio-clip',
			sourceId: 'audio-source',
			title: 'Camera audio',
			timelineStartFrame,
			sourceStartFrame: 100,
			sourceDurationFrames: 600,
			durationFrames: 600,
			avLinkId,
		}),
	];
}

function createPairedTracks(clipIds = { video: [], audio: [] }) {
	return [
		createVideoTrackV4({
			id: 'video-track',
			name: 'Camera',
			clipIds: clipIds.video,
			laneGroupId: 'camera-lanes',
		}),
		createAudioTrackV4({
			id: 'audio-track',
			name: 'Camera audio',
			clipIds: clipIds.audio,
			laneGroupId: 'camera-lanes',
		}),
	];
}

function createTimelinePairProject(options = {}) {
	const clips = createTimelineClipPair(options);
	return createAudioEditorProjectV4({
		id: 'video-command-project',
		title: 'Video command project',
		now: NOW,
		sources: createMediaSources(),
		clips,
		tracks: createPairedTracks({
			video: [clips[0].id],
			audio: [clips[1].id],
		}),
		selection: {
			startFrame: clips[0].timelineStartFrame,
			endFrame: clips[0].timelineStartFrame + clips[0].durationFrames,
			trackIds: ['video-track', 'audio-track'],
			clipIds: [clips[0].id],
		},
	});
}

test('V4 Project Bin commands add, place, update, and remove a compound A/V item atomically', () => {
	let project = createAudioEditorProjectV4({
		id: 'video-bin-project',
		title: 'Video bin project',
		now: NOW,
		sources: createMediaSources(),
		tracks: createPairedTracks(),
	});
	project = apply(project, {
		type: 'batch',
		commands: [
			{
				type: 'project-bin/add',
				clip: createVideoClipV4({
					id: 'bin-video',
					sourceId: 'video-source',
					title: 'Reusable take',
					durationFrames: 600,
					sourceDurationFrames: 600,
					binItemId: 'take-one',
				}),
			},
			{
				type: 'project-bin/add',
				clip: createAudioClipV4({
					id: 'bin-audio',
					sourceId: 'audio-source',
					title: 'Reusable take',
					durationFrames: 600,
					sourceDurationFrames: 600,
					binItemId: 'take-one',
				}),
			},
		],
	});

	assert.deepEqual(project.projectBin.clips.map((clip) => [
		clip.id,
		clip.kind,
		clip.binItemId,
		clip.avLinkId,
		clip.groupId,
	]), [
		['bin-video', 'video', 'take-one', null, null],
		['bin-audio', 'audio', 'take-one', null, null],
	]);

	project = apply(project, {
		type: 'project-bin/place',
		binClipId: 'bin-video',
		timelineStartFrame: 800,
		avLinkId: 'placed-av',
		placements: [
			{ binClipId: 'bin-video', trackId: 'video-track', clipId: 'placed-video' },
			{ binClipId: 'bin-audio', trackId: 'audio-track', clipId: 'placed-audio' },
		],
	});
	assert.deepEqual(project.tracks.map((track) => track.clipIds), [
		['placed-video'],
		['placed-audio'],
	]);
	assert.deepEqual(project.clips.map((clip) => [
		clip.id,
		clip.kind,
		clip.timelineStartFrame,
		clip.avLinkId,
		clip.binItemId,
	]), [
		['placed-video', 'video', 800, 'placed-av', null],
		['placed-audio', 'audio', 800, 'placed-av', null],
	]);
	assert.equal(project.projectBin.clips.length, 2);

	project = apply(project, {
		type: 'project-bin/update',
		clipId: 'bin-audio',
		changes: { title: 'Renamed reusable take' },
	});
	assert.deepEqual(
		project.projectBin.clips.map((clip) => clip.title),
		['Renamed reusable take', 'Renamed reusable take'],
	);

	project = apply(project, {
		type: 'project-bin/remove',
		clipId: 'bin-video',
	});
	assert.deepEqual(project.projectBin.clips, []);
	assert.deepEqual(project.clips.map((clip) => clip.id), ['placed-video', 'placed-audio']);
	assert.equal(validateAudioEditorProject(project), true);
});

test('moving one linked timeline clip to the Project Bin moves its companion into one item', () => {
	const project = createTimelinePairProject();
	const moved = apply(project, {
		type: 'project-bin/move-from-timeline',
		clipIds: ['audio-clip'],
	});

	assert.deepEqual(moved.clips, []);
	assert.deepEqual(moved.tracks.map((track) => track.clipIds), [[], []]);
	assert.deepEqual(moved.selection.clipIds, []);
	assert.deepEqual(moved.projectBin.clips.map((clip) => [
		clip.id,
		clip.kind,
		clip.binItemId,
		clip.avLinkId,
	]), [
		['video-clip', 'video', 'video-clip', null],
		['audio-clip', 'audio', 'video-clip', null],
	]);
	assert.equal(validateAudioEditorProject(moved), true);
});

test('linked clips are included in transform and trim participation', () => {
	const project = createTimelinePairProject();

	assert.deepEqual(
		collectClipTransformIds(project, 'video-clip'),
		['video-clip', 'audio-clip'],
	);
	assert.deepEqual(
		collectClipTrimIds(project, 'video-clip', 'left'),
		['video-clip', 'audio-clip'],
	);
	assert.deepEqual(
		collectClipTrimIds(project, 'audio-clip', 'right'),
		['video-clip', 'audio-clip'],
	);
});

test('a linked split keeps the left pair together and assigns a fresh link to the right pair', () => {
	const project = createTimelinePairProject();
	const reservedIds = ['video-right', 'audio-right', 'av-right'];
	const command = prepareLinkedSplitCommand(
		project,
		'video-clip',
		400,
		() => reservedIds.shift(),
	);
	const split = apply(project, command);

	assert.deepEqual(command, {
		type: 'clip/split',
		clipId: 'video-clip',
		atFrame: 400,
		rightClipId: 'video-right',
		linkedRightClipId: 'audio-right',
		rightAvLinkId: 'av-right',
	});
	assert.deepEqual(split.tracks.map((track) => track.clipIds), [
		['video-clip', 'video-right'],
		['audio-clip', 'audio-right'],
	]);
	assert.deepEqual(
		split.clips
			.map((clip) => [
				clip.id,
				clip.timelineStartFrame,
				clip.sourceStartFrame,
				clip.durationFrames,
				clip.sourceDurationFrames,
				clip.avLinkId,
			])
			.sort((left, right) => left[0].localeCompare(right[0])),
		[
			['audio-clip', 100, 100, 300, 300, 'av-original'],
			['audio-right', 400, 400, 300, 300, 'av-right'],
			['video-clip', 100, 100, 300, 300, 'av-original'],
			['video-right', 400, 400, 300, 300, 'av-right'],
		],
	);
	assert.equal(validateAudioEditorProject(split), true);
});

test('linked trims and stretches commit only when both media clips remain aligned', () => {
	const project = createTimelinePairProject();
	assert.throws(() => apply(project, {
		type: 'clip/trim',
		clipId: 'video-clip',
		timelineStartFrame: 200,
		sourceStartFrame: 200,
		sourceDurationFrames: 500,
		durationFrames: 500,
		trimStartFrames: 100,
	}), /aligned timeline ranges/);

	let edited = apply(project, {
		type: 'batch',
		commands: ['video-clip', 'audio-clip'].map((clipId) => ({
			type: 'clip/trim',
			clipId,
			timelineStartFrame: 200,
			sourceStartFrame: 200,
			sourceDurationFrames: 500,
			durationFrames: 500,
			trimStartFrames: 100,
		})),
	});
	assert.deepEqual(
		edited.clips.map((clip) => [
			clip.id,
			clip.timelineStartFrame,
			clip.sourceStartFrame,
			clip.durationFrames,
			clip.sourceDurationFrames,
		]),
		[
			['video-clip', 200, 200, 500, 500],
			['audio-clip', 200, 200, 500, 500],
		],
	);

	const stretch = prepareTransformClipsCommand(edited, [
		{
			clipId: 'video-clip',
			trackId: 'video-track',
			changes: { durationFrames: 1_000, speedRatio: 0.5 },
		},
		{
			clipId: 'audio-clip',
			trackId: 'audio-track',
			changes: { durationFrames: 1_000, speedRatio: 0.5 },
		},
	]);
	edited = apply(edited, stretch);
	assert.deepEqual(
		edited.clips.map((clip) => [clip.id, clip.durationFrames, clip.speedRatio, clip.avLinkId]),
		[
			['video-clip', 1_000, 0.5, 'av-original'],
			['audio-clip', 1_000, 0.5, 'av-original'],
		],
	);
	assert.equal(validateAudioEditorProject(edited), true);
});

test('A/V link and unlink commands require aligned clips in the same paired lanes', () => {
	let project = createTimelinePairProject({ linked: false });
	project = apply(
		project,
		prepareLinkAvCommand('video-clip', 'audio-clip', () => 'linked-av'),
	);
	assert.deepEqual(project.clips.map((clip) => clip.avLinkId), ['linked-av', 'linked-av']);

	project = apply(project, prepareUnlinkAvCommand('audio-clip'));
	assert.deepEqual(project.clips.map((clip) => clip.avLinkId), [null, null]);

	const misaligned = createTimelinePairProject({ linked: false });
	const movedAudio = structuredClone(misaligned);
	movedAudio.clips.find((clip) => clip.id === 'audio-clip').timelineStartFrame += 1;
	assert.equal(validateAudioEditorProject(movedAudio), true);
	assert.throws(
		() => apply(movedAudio, prepareLinkAvCommand('video-clip', 'audio-clip', () => 'bad-av')),
		/aligned timeline ranges/,
	);

	const unpaired = createTimelinePairProject({ linked: false });
	unpaired.tracks = unpaired.tracks.map((track) => ({ ...track, laneGroupId: null }));
	assert.equal(validateAudioEditorProject(unpaired), true);
	assert.throws(
		() => apply(unpaired, prepareLinkAvCommand('video-clip', 'audio-clip', () => 'bad-lanes')),
		/same media lane group/,
	);
});

test('paired video and audio tracks are added and removed as one lane group', () => {
	const empty = createAudioEditorProjectV4({
		id: 'track-pair-project',
		title: 'Track pair project',
		now: NOW,
	});
	assert.throws(() => apply(empty, {
		type: 'track/add',
		track: createVideoTrackV4({
			id: 'orphan-video',
			laneGroupId: 'orphan-lanes',
		}),
	}), /adjacent video\/audio track pair/);

	let project = apply(empty, {
		type: 'batch',
		commands: [
			{
				type: 'track/add',
				index: 0,
				track: createVideoTrackV4({
					id: 'paired-video',
					laneGroupId: 'paired-lanes',
				}),
			},
			{
				type: 'track/add',
				index: 1,
				track: createAudioTrackV4({
					id: 'paired-audio',
					laneGroupId: 'paired-lanes',
				}),
			},
		],
	});
	assert.deepEqual(project.tracks.map((track) => [
		track.id,
		track.type,
		track.laneGroupId,
	]), [
		['paired-video', 'video', 'paired-lanes'],
		['paired-audio', 'audio', 'paired-lanes'],
	]);

	project = apply(project, { type: 'track/remove', trackId: 'paired-audio' });
	assert.deepEqual(project.tracks, []);
	assert.equal(validateAudioEditorProject(project), true);
});
