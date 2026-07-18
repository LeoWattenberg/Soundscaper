import test from 'node:test';
import assert from 'node:assert/strict';

import {
	applyEditorCommand,
	collectClipTransformIds,
	collectClipTrimIds,
	collectRelatedClipIds,
	createClipboardDescriptor,
	prepareKeepRangeCommand,
	prepareLinkedSplitCommand,
	prepareLinkAvCommand,
	preparePasteCommand,
	prepareRangeDeleteCommand,
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
	assert.deepEqual(
		collectRelatedClipIds(project, ['video-clip']),
		['video-clip', 'audio-clip'],
	);
});

test('exact grouped clip edits do not capture or delete unrelated material inside the group span', () => {
	const source = createAudioSourceV4({
		id: 'group-source',
		name: 'group.wav',
		storageKey: 'group-source',
		frameCount: 2_000,
		channelCount: 1,
		sampleRate: 48_000,
	});
	const clips = [{
		id: 'group-first',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		groupId: 'edit-group',
	}, {
		id: 'unrelated-gap',
		timelineStartFrame: 200,
		sourceStartFrame: 200,
		groupId: null,
	}, {
		id: 'group-last',
		timelineStartFrame: 400,
		sourceStartFrame: 400,
		groupId: 'edit-group',
	}].map((value) => createAudioClipV4({
		...value,
		sourceId: source.id,
		durationFrames: 100,
	}));
	const project = createAudioEditorProjectV4({
		id: 'exact-group-project',
		title: 'Exact group edits',
		now: NOW,
		sources: [source],
		clips,
		tracks: [createAudioTrackV4({
			id: 'group-track',
			clipIds: clips.map((clip) => clip.id),
		})],
	});
	const clipboard = createClipboardDescriptor(project, {
		startFrame: 0,
		endFrame: 500,
		trackIds: ['group-track'],
		clipIds: ['group-first'],
	});
	assert.deepEqual(
		clipboard.tracks[0].clips.map((clip) => clip.key),
		['group-first:0:100', 'group-last:400:500'],
	);

	const edited = apply(project, {
		type: 'clip/remove-many',
		clipIds: ['group-first'],
	});
	assert.deepEqual(edited.clips.map((clip) => clip.id), ['unrelated-gap']);
	assert.deepEqual(edited.tracks[0].clipIds, ['unrelated-gap']);
	assert.equal(validateAudioEditorProject(edited), true);
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

test('range deletion from one media lane edits its linked companion and gives the right pair a fresh link', () => {
	const project = createTimelinePairProject();
	const counts = new Map();
	const command = prepareRangeDeleteCommand(project, {
		startFrame: 300,
		endFrame: 500,
		trackIds: ['video-track'],
	}, (prefix) => {
		const count = (counts.get(prefix) || 0) + 1;
		counts.set(prefix, count);
		return `${prefix}-${count}`;
	});

	assert.deepEqual(command.trackIds, ['video-track', 'audio-track']);
	assert.deepEqual(command.clipIds, ['video-clip', 'audio-clip']);
	assert.deepEqual(command.splitAvLinkIds, { 'av-original': 'av-link-1' });
	const edited = apply(project, command);
	assert.deepEqual(edited.tracks.map((track) => track.clipIds), [
		['video-clip', 'clip-1'],
		['audio-clip', 'clip-2'],
	]);
	assert.deepEqual(
		edited.clips
			.map((clip) => [clip.kind, clip.timelineStartFrame, clip.durationFrames, clip.avLinkId])
			.sort((left, right) => left[1] - right[1] || right[0].localeCompare(left[0])),
		[
			['video', 100, 200, 'av-original'],
			['audio', 100, 200, 'av-original'],
			['video', 500, 200, 'av-link-1'],
			['audio', 500, 200, 'av-link-1'],
		],
	);
	assert.equal(validateAudioEditorProject(edited), true);
});

test('keep-range from one media lane trims its linked pair without deleting unrelated companion-lane audio', () => {
	let project = createTimelinePairProject();
	project = apply(project, {
		type: 'clip/add',
		trackId: 'audio-track',
		clip: createAudioClipV4({
			id: 'independent-audio',
			sourceId: 'audio-source',
			timelineStartFrame: 800,
			sourceStartFrame: 800,
			durationFrames: 100,
		}),
	});
	project = apply(project, prepareKeepRangeCommand(project, {
		startFrame: 300,
		endFrame: 500,
		trackIds: ['video-track'],
	}));

	assert.deepEqual(
		project.clips.map((clip) => [clip.id, clip.timelineStartFrame, clip.durationFrames, clip.avLinkId]),
		[
			['video-clip', 300, 200, 'av-original'],
			['audio-clip', 300, 200, 'av-original'],
			['independent-audio', 800, 100, null],
		],
	);
	assert.equal(validateAudioEditorProject(project), true);
});

test('clipboard paste preserves media lanes and remaps clip groups and A/V links', () => {
	const sourceProject = createTimelinePairProject();
	sourceProject.clips = sourceProject.clips.map((clip) => ({ ...clip, groupId: 'source-group' }));
	const clipboard = createClipboardDescriptor(sourceProject, {
		startFrame: 100,
		endFrame: 700,
		trackIds: ['video-track'],
	});
	assert.equal(clipboard.schemaVersion, 2);
	assert.deepEqual(
		clipboard.tracks.map((track) => [
			track.sourceTrackType,
			track.sourceLaneGroupId,
			track.clips[0].kind,
			track.clips[0].avLinkId,
		]),
		[
			['video', 'camera-lanes', 'video', 'av-original'],
			['audio', 'camera-lanes', 'audio', 'av-original'],
		],
	);

	let target = createAudioEditorProjectV4({
		id: 'clipboard-target',
		title: 'Clipboard target',
		now: NOW,
		sources: createMediaSources(),
		tracks: [
			createVideoTrackV4({ id: 'target-video', laneGroupId: 'target-lanes' }),
			createAudioTrackV4({ id: 'target-audio', laneGroupId: 'target-lanes' }),
		],
	});
	const counts = new Map();
	const paste = preparePasteCommand(clipboard, {
		atFrame: 1_000,
		trackMap: {
			'video-track': 'target-video',
			'audio-track': 'target-audio',
		},
	}, (prefix) => {
		const count = (counts.get(prefix) || 0) + 1;
		counts.set(prefix, count);
		return `${prefix}-${count}`;
	});
	target = apply(target, paste);

	assert.notEqual(paste.groupIds['source-group'], 'source-group');
	assert.notEqual(paste.avLinkIds['av-original'], 'av-original');
	assert.deepEqual(
		target.clips.map((clip) => [
			clip.kind,
			clip.timelineStartFrame,
			clip.groupId,
			clip.avLinkId,
		]),
		[
			['video', 1_000, 'clip-group-1', 'av-link-1'],
			['audio', 1_000, 'clip-group-1', 'av-link-1'],
		],
	);
	assert.equal(validateAudioEditorProject(target), true);
});

test('insert-paste splits an existing linked pair with one fresh right-side link', () => {
	const project = createTimelinePairProject();
	const clipboard = createClipboardDescriptor(project, {
		startFrame: 100,
		endFrame: 200,
		trackIds: ['video-track'],
	});
	const counts = new Map();
	const command = preparePasteCommand(clipboard, {
		project,
		atFrame: 400,
		mode: 'insert-track',
		trackMap: {
			'video-track': 'video-track',
			'audio-track': 'audio-track',
		},
	}, (prefix) => {
		const count = (counts.get(prefix) || 0) + 1;
		counts.set(prefix, count);
		return `${prefix}-${count}`;
	});
	const pasted = apply(project, command);
	const linkedRanges = new Map();
	for (const clip of pasted.clips) {
		const ranges = linkedRanges.get(clip.avLinkId) || [];
		ranges.push([clip.kind, clip.timelineStartFrame, clip.durationFrames]);
		linkedRanges.set(clip.avLinkId, ranges);
	}

	assert.equal(linkedRanges.size, 3);
	assert.deepEqual(linkedRanges.get('av-original'), [
		['video', 100, 300],
		['audio', 100, 300],
	]);
	assert.deepEqual(linkedRanges.get(command.avLinkIds['av-original']), [
		['video', 400, 100],
		['audio', 400, 100],
	]);
	assert.deepEqual(linkedRanges.get(command.splitAvLinkIds['av-original']), [
		['video', 500, 300],
		['audio', 500, 300],
	]);
	assert.equal(validateAudioEditorProject(pasted), true);
});

test('legacy V1 audio clipboards still paste into V4 audio tracks', () => {
	const target = createAudioEditorProjectV4({
		id: 'legacy-clipboard-target',
		title: 'Legacy clipboard target',
		now: NOW,
		sources: [createMediaSources()[1]],
		tracks: [createAudioTrackV4({ id: 'legacy-audio-track' })],
	});
	const clipboard = {
		schemaVersion: 1,
		sampleRate: 48_000,
		durationFrames: 100,
		tracks: [{
			sourceTrackId: 'legacy-source-track',
			sourceTrackName: 'Legacy audio',
			clips: [{
				key: 'legacy-clip:0:100',
				sourceId: 'audio-source',
				offsetFrame: 0,
				sourceStartFrame: 0,
				durationFrames: 100,
			}],
		}],
	};
	const pasted = apply(target, preparePasteCommand(clipboard, {
		atFrame: 250,
		trackMap: { 'legacy-source-track': 'legacy-audio-track' },
	}, () => 'legacy-pasted-clip'));
	assert.deepEqual(
		pasted.clips.map((clip) => [clip.id, clip.kind, clip.timelineStartFrame]),
		[['legacy-pasted-clip', 'audio', 250]],
	);
	assert.equal(validateAudioEditorProject(pasted), true);
});

test('joining adjacent linked segments rejoins both media lanes atomically', () => {
	let project = createTimelinePairProject();
	project = apply(project, prepareLinkedSplitCommand(project, 'video-clip', 400, (() => {
		const ids = ['right-video', 'right-audio', 'right-av'];
		return () => ids.shift();
	})()));
	project = apply(project, {
		type: 'clip/join',
		clipIds: ['video-clip', 'right-video', 'audio-clip', 'right-audio'],
	});

	assert.deepEqual(project.tracks.map((track) => track.clipIds), [
		['video-clip'],
		['audio-clip'],
	]);
	assert.deepEqual(
		project.clips.map((clip) => [clip.id, clip.durationFrames, clip.avLinkId]),
		[
			['video-clip', 600, 'av-original'],
			['audio-clip', 600, 'av-original'],
		],
	);
	assert.equal(validateAudioEditorProject(project), true);
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
