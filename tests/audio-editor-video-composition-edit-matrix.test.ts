/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	preparePunchCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
} from '../src/common/editor/commands.js';
import {
	prepareThreePointEditCommand,
} from '../src/common/editor/commands/three-point-edit-runtime.js';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import {
	createProjectBinLinkedVideoRelinkService,
	type ProjectBinLinkedVideoRelinkDependencies,
} from '../src/common/editor/controller/project-bin-linked-video-relink-service.ts';
import {
	createAudioSource,
	createAudioTrack,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
	type VideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
import {
	createFramescaperPlaybackProjectServiceV19,
} from '../src/framescaper/editor-project-playback-v19.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import {
	createEditorProjectRuntimeV19Selection,
} from '../src/framescaper/editor-project-runtime-v19-selection.ts';
import {
	applyFramescaperProjectCommandV19,
	type FramescaperProjectCommandV19,
} from '../src/framescaper/editor-project-v19-commands.ts';
import {
	createFramescaperProjectV19,
	type FramescaperProjectV19,
} from '../src/framescaper/editor-project-v19.ts';

const CREATED = '2026-08-13T16:00:00.000Z';
const EDITED = '2026-08-13T16:01:00.000Z';
const PROFILE = FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE;
const SAMPLE_RATE = 48_000;
const FRAME_SAMPLES = 4_800;

test('move and exact roll-like transforms preserve detached composition ownership', () => {
	const movedBase = timelineProject();
	const movedBefore = compositionOf(movedBase, 'tail');
	const moved = apply(movedBase, {
		type: 'clip/move', clipId: 'tail', timelineStartFrame: 70 * FRAME_SAMPLES,
	});
	assertOwnedComposition(moved, 'tail', composition(3), movedBefore);

	const rolledBase = timelineProject();
	const leftBefore = compositionOf(rolledBase, 'left');
	const middleBefore = compositionOf(rolledBase, 'middle');
	const rolled = apply(rolledBase, {
		type: 'clip/transform-many', overwrite: false, transforms: [
			{
				clipId: 'left', trackId: 'video-track',
				changes: { durationFrames: 21 * FRAME_SAMPLES, sourceDurationFrames: 21 },
				sequencePlacement: { sequenceStartFrame: 0, sequenceFrameCount: 21 },
			},
			{
				clipId: 'middle', trackId: 'video-track',
				changes: {
					timelineStartFrame: 21 * FRAME_SAMPLES,
					durationFrames: 19 * FRAME_SAMPLES,
					sourceStartFrame: 21,
					sourceDurationFrames: 19,
				},
				sequencePlacement: { sequenceStartFrame: 21, sequenceFrameCount: 19 },
			},
		],
	});
	assertOwnedComposition(rolled, 'left', composition(1), leftBefore);
	assertOwnedComposition(rolled, 'middle', composition(2), middleBefore);
});

test('slip, slide-like transforms, and uniform stretch retain every authored composition', () => {
	const slippedBase = timelineProject();
	const slipped = apply(slippedBase, {
		type: 'clip/transform-many', overwrite: false, transforms: [{
			clipId: 'left', trackId: 'video-track',
			changes: { sourceStartFrame: 5, sourceDurationFrames: 20 },
		}],
	});
	assertOwnedComposition(slipped, 'left', composition(1), compositionOf(slippedBase, 'left'));

	const slidBase = timelineProject();
	const slid = apply(slidBase, {
		type: 'clip/transform-many', overwrite: false, transforms: [
			{
				clipId: 'middle', trackId: 'video-track',
				changes: { timelineStartFrame: 22 * FRAME_SAMPLES },
				sequencePlacement: { sequenceStartFrame: 22, sequenceFrameCount: 20 },
			},
			{
				clipId: 'tail', trackId: 'video-track',
				changes: {
					timelineStartFrame: 44 * FRAME_SAMPLES,
					durationFrames: 16 * FRAME_SAMPLES,
					sourceStartFrame: 44,
					sourceDurationFrames: 16,
				},
				sequencePlacement: { sequenceStartFrame: 44, sequenceFrameCount: 16 },
			},
		],
	});
	for (const [id, variant] of [['left', 1], ['middle', 2], ['tail', 3]] as const) {
		assertOwnedComposition(slid, id, composition(variant), compositionOf(slidBase, id));
	}

	const stretchedBase = singleVideoProject();
	const stretched = apply(stretchedBase, {
		type: 'clip/transform-many', overwrite: false, transforms: [{
			clipId: 'long', trackId: 'video-track',
			changes: { durationFrames: 80 * FRAME_SAMPLES, sourceDurationFrames: 60 },
			sequencePlacement: { sequenceStartFrame: 0, sequenceFrameCount: 80 },
		}],
	});
	assertOwnedComposition(stretched, 'long', composition(1), compositionOf(stretchedBase, 'long'));
});

test('group, ungroup, A/V link, and unlink preserve the video value', () => {
	const groupedBase = timelineProject();
	const grouped = apply(groupedBase, {
		type: 'clip/group', clipIds: ['left', 'middle'], groupId: 'group-a',
	});
	assertOwnedComposition(grouped, 'left', composition(1), compositionOf(groupedBase, 'left'));
	assertOwnedComposition(grouped, 'middle', composition(2), compositionOf(groupedBase, 'middle'));
	const ungrouped = apply(grouped, {
		type: 'clip/ungroup', clipIds: ['left', 'middle'],
	});
	assertOwnedComposition(ungrouped, 'left', composition(1), compositionOf(grouped, 'left'));

	const linkedBase = timelineProject();
	const linked = apply(linkedBase, {
		type: 'clip/link-av', videoClipId: 'left', audioClipId: 'audio', avLinkId: 'av-a',
	});
	assertOwnedComposition(linked, 'left', composition(1), compositionOf(linkedBase, 'left'));
	const unlinked = apply(linked, { type: 'clip/unlink-av', clipId: 'left' });
	assertOwnedComposition(unlinked, 'left', composition(1), compositionOf(linked, 'left'));
});

test('source replacement and reprobe preserve composition while refreshing source geometry', () => {
	const base = timelineProject();
	const replaced = apply(base, {
		type: 'clip/replace-source', clipId: 'left', sourceId: 'video-source-b',
	});
	assert.equal(timelineClip(replaced, 'left').sourceId, 'video-source-b');
	assert.equal(timelineClip(replaced, 'left').renderCacheRevision, 1);
	assertOwnedComposition(replaced, 'left', composition(1), compositionOf(base, 'left'));
	const reprobed = apply(replaced, {
		type: 'source/reprobe', sourceId: 'video-source-b',
		changes: { width: 1_280, height: 720 },
		clips: [{ clipId: 'left', sourceInFrame: 0, sourceFrameCount: 20 }],
	});
	assert.equal(reprobed.sources.find(({ id }) => id === 'video-source-b')?.width, 1_280);
	assertOwnedComposition(reprobed, 'left', composition(1), compositionOf(replaced, 'left'));

	const audioReplaced = apply(base, {
		type: 'clip/replace-source', clipId: 'audio', sourceId: 'audio-source-b',
	});
	const audio = timelineClip(audioReplaced, 'audio');
	assert.equal(audio.sourceId, 'audio-source-b');
	assert.equal(audio.renderCacheRevision, 1);
	assert.equal(Object.hasOwn(audio, 'videoComposition'), false);
});

test('Project Bin relink is document-neutral and roundtrip placement detaches composition', async () => {
	const base = timelineProject();
	const moved = apply(base, {
		type: 'project-bin/move-from-timeline', clipIds: ['left'],
	});
	const relinkProject = moved as unknown as ReturnType<
		ProjectBinLinkedVideoRelinkDependencies['getProject']
	>;
	const binned = binClip(moved, 'left');
	const binnedComposition = compositionRecord(binned.videoComposition);
	const beforeRelink = JSON.stringify(moved);
	const lifetime = new EditorControllerLifetime();
	const generation = new EditorProjectGeneration();
	generation.activate(moved.id);
	const missingSourceIds = new Set(['video-source-a']);
	const service = createProjectBinLinkedVideoRelinkService({
		lifetime,
		missingSourceIds,
		editingBlocked: () => false,
		getProject: () => relinkProject,
		captureProject: () => generation.capture(),
		assertProject: (token) => generation.assertCurrent(token),
		getLinkedVideoOriginalBinding: async () => ({
			locatorId: 'old-locator', locatorRevision: 'old-revision', bindingToken: 'old-token',
			byteLength: 10, sha256: 'digest:same video',
		}),
		digestContent: async (blob) => `digest:${await blob.text()}`,
		admitChangedContentCandidate: async () => undefined,
		deleteVideoDerivatives: async () => undefined,
		stopTimelinePlayback: async () => undefined,
		stopProjectBinPreview: async () => undefined,
		revokeVideoVisual: async () => undefined,
		relinkLinkedVideoOriginal: async (_projectId, _source, locatorId, options) => {
			options.assertCanPublish();
			return {
				locatorId, locatorRevision: options.expectedLocatorRevision,
				bindingToken: 'new-token', byteLength: 10, sha256: 'digest:same video',
			};
		},
		releaseLinkedVideoOriginalLocator: async () => true,
		activateVideoSource: async () => ({}),
		publish: () => undefined,
	});
	try {
		assert.equal(await service.relinkLinkedVideo(
			'left', new Blob(['same video']),
			{ locatorId: 'new-locator', locatorRevision: 'new-revision' },
		), 'video-source-a');
		assert.equal(JSON.stringify(moved), beforeRelink);
		assert.strictEqual(compositionRecord(binClip(moved, 'left').videoComposition), binnedComposition);
	} finally {
		await service.dispose();
	}

	const placed = apply(moved, {
		type: 'project-bin/place', binClipId: 'left', timelineStartFrame: 0,
		placements: [{ binClipId: 'left', trackId: 'video-track', clipId: 'roundtrip-left' }],
	});
	assertOwnedComposition(placed, 'roundtrip-left', composition(1), binnedComposition);
	assert.notStrictEqual(
		compositionRecord(timelineClip(placed, 'roundtrip-left').videoComposition).crop,
		binnedComposition.crop,
	);
});

test('ripple deletion preserves and detaches both surviving segments', () => {
	const base = singleVideoProject();
	const before = compositionOf(base, 'long');
	const command = prepareRangeDeleteCommand(commandProject(base), {
		startFrame: 10 * FRAME_SAMPLES,
		endFrame: 20 * FRAME_SAMPLES,
		trackIds: ['video-track'],
		rippleMode: 'track',
	}, stableIds());
	const deleted = apply(base, command);
	assertOwnedComposition(deleted, 'long', composition(1), before);
	assertOwnedComposition(deleted, 'clip-0', composition(1), before);
	assertDetachedFromEachOther(deleted, 'long', 'clip-0');
});

test('insert and overwrite preserve split survivors and default only new video media', () => {
	for (const mode of ['insert', 'overwrite'] as const) {
		const base = singleVideoProject();
		const command = prepareThreePointEditCommand(commandProject(base), {
			mode,
			startFrame: 10 * FRAME_SAMPLES,
			endFrame: (mode === 'insert' ? 11 : 20) * FRAME_SAMPLES,
			placements: [{
				trackId: 'video-track', clipId: `${mode}-media`, sourceId: 'video-source-b',
				sourceIn: 70, sourceCount: mode === 'insert' ? 1 : 10,
			}],
		}, stableIds());
		const edited = apply(base, command);
		assertOwnedComposition(edited, 'long', composition(1), compositionOf(base, 'long'));
		assertOwnedComposition(edited, 'clip-0', composition(1), compositionOf(base, 'long'));
		assertDetachedFromEachOther(edited, 'long', 'clip-0');
		assert.deepEqual(timelineClip(edited, `${mode}-media`).videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	}
});

test('video punch and range replacement remain transactionally gated before survivor mutation', () => {
	// Their generic wire has no video-kind/composition carrier, so current V19 must refuse them atomically.
	const punchBase = singleVideoProject();
	const punchBefore = JSON.stringify(punchBase);
	const punch = preparePunchCommand(commandProject(punchBase), {
		trackId: 'video-track', startFrame: 10 * FRAME_SAMPLES, endFrame: 20 * FRAME_SAMPLES,
		sourceId: 'video-source-b', sourceStartFrame: 70, sourceDurationFrames: 10,
		clipId: 'punch-media',
	}, stableIds());
	assert.throws(
		() => apply(punchBase, punch),
		/audio clip cannot be added to a video track/iu,
	);
	assert.equal(JSON.stringify(punchBase), punchBefore);
	assert.deepEqual(compositionOf(punchBase, 'long'), composition(1));

	const base = singleVideoProject();
	const before = JSON.stringify(base);
	const replacementSource = {
		...videoSource('range-source', '56'),
		frameCount: 10 * FRAME_SAMPLES,
		sampleFrameCount: 10 * FRAME_SAMPLES,
		sourceFrameCount: 10,
	};
	const command = prepareRangeReplacementCommand(commandProject(base), {
		trackId: 'video-track', startFrame: 10 * FRAME_SAMPLES, endFrame: 20 * FRAME_SAMPLES,
		source: replacementSource, clipId: 'range-media',
	}, stableIds());
	assert.throws(() => apply(base, command), /source bounds|audio.*video track/iu);
	assert.equal(JSON.stringify(base), before);
	assert.deepEqual(compositionOf(base, 'long'), composition(1));
});

test('removed occurrences do not influence surviving composition or owned requirements', () => {
	const base = timelineProject();
	const removed = apply(base, { type: 'clip/remove', clipId: 'left' });
	assert.equal(removed.clips.some(({ id }) => id === 'left'), false);
	assertOwnedComposition(removed, 'middle', composition(2), compositionOf(base, 'middle'));
	assert.ok(removed.featureRequirements.requirements.some(
		({ id }) => id === 'framescaper.video-geometry',
	));

	const only = singleVideoProject();
	const empty = apply(only, { type: 'clip/remove', clipId: 'long' });
	assert.deepEqual(empty.clips, []);
	assert.equal(empty.featureRequirements.requirements.some(
		({ id }) => id === 'framescaper.video-geometry',
	), false);
});

test('multicamera switching preserves output composition through persisted and playback projections', () => {
	const base = multicameraProject();
	const switched = apply(base, {
		type: 'multicamera/switch', projectId: base.id,
		expectedProjectRevision: base.revision,
		groupId: 'camera-group', expectedActiveMemberId: 'camera-a', memberId: 'camera-b',
	});
	assert.equal(switched.multicameraGroups[0]?.activeMemberId, 'camera-b');
	assert.equal(timelineClip(switched, 'output').sourceId, 'video-source-a');
	assertOwnedComposition(switched, 'output', composition(1), compositionOf(base, 'output'));

	const playback = createFramescaperPlaybackProjectServiceV19(PROFILE)
		.projectForPlayback(switched).project;
	const output = playback.clips.find(({ id }) => id === 'output');
	assert.ok(output);
	assert.equal(output.sourceId, 'video-source-b');
	assert.deepEqual(output.videoComposition, composition(1));
	assert.notStrictEqual(output.videoComposition, timelineClip(switched, 'output').videoComposition);
});

function timelineProject(): FramescaperProjectV19 {
	return projectWithVideoClips('composition-edit-matrix', [
		videoClip('left', 0, 20, 0, composition(1)),
		videoClip('middle', 20, 20, 20, composition(2)),
		videoClip('tail', 40, 20, 40, composition(3)),
	], true);
}

function singleVideoProject(): FramescaperProjectV19 {
	return projectWithVideoClips('composition-range-matrix', [
		videoClip('long', 0, 60, 0, composition(1)),
	], false);
}

function projectWithVideoClips(
	id: string,
	videoClips: readonly Readonly<Record<string, unknown>>[],
	withAudio: boolean,
): FramescaperProjectV19 {
	const audioClip = {
		kind: 'audio', id: 'audio', sourceId: 'audio-source', title: 'Audio',
		timelineStartFrame: 0, durationFrames: 20 * FRAME_SAMPLES,
		sourceStartFrame: 0, sourceDurationFrames: 20 * FRAME_SAMPLES,
		fadeInFrames: 0, fadeOutFrames: 0,
	};
	return createFramescaperProjectV19(PROFILE, {
		id, title: id, now: CREATED, sampleRate: SAMPLE_RATE,
		sources: [
			videoSource('video-source-a', '12'),
			videoSource('video-source-b', '34'),
			...(withAudio ? [createAudioSource({
				id: 'audio-source', name: 'Audio', storageKey: 'audio-source',
				mimeType: 'audio/wav', contentSha256: '78'.repeat(32),
				frameCount: 100 * FRAME_SAMPLES, sampleRate: SAMPLE_RATE, channelCount: 1,
			}), createAudioSource({
				id: 'audio-source-b', name: 'Audio B', storageKey: 'audio-source-b',
				mimeType: 'audio/wav', contentSha256: '9a'.repeat(32),
				frameCount: 100 * FRAME_SAMPLES, sampleRate: SAMPLE_RATE, channelCount: 1,
			})] : []),
		],
		clips: [...videoClips, ...(withAudio ? [audioClip] : [])],
		tracks: [
			createVideoTrack({
				id: 'video-track', name: 'Video',
				...(withAudio ? { laneGroupId: 'media-lanes' } : {}),
				clipIds: videoClips.map(({ id: clipId }) => String(clipId)), locked: false,
			}),
			...(withAudio ? [createAudioTrack({
				id: 'audio-track', name: 'Audio', laneGroupId: 'media-lanes',
				clipIds: ['audio'], locked: false,
			}, SAMPLE_RATE)] : []),
		],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 },
			trackIds: ['video-track', ...(withAudio ? ['audio-track'] : [])],
		}],
		primarySequenceId: 'main-sequence',
	});
}

function multicameraProject(): FramescaperProjectV19 {
	return createFramescaperProjectV19(PROFILE, {
		id: 'multicamera-composition-v19', title: 'Multicamera composition', now: CREATED,
		sources: [videoSource('video-source-a', '12'), videoSource('video-source-b', '34')],
		clips: [videoClip('output', 0, 10, 0, composition(1))],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['output'], locked: false,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
		multicameraGroups: [{
			id: 'camera-group', projectId: 'multicamera-composition-v19',
			sequenceId: 'main-sequence', outputClipId: 'output', activeMemberId: 'camera-a',
			members: [
				{ id: 'camera-a', groupId: 'camera-group', sourceId: 'video-source-a', syncOffsetSamples: 0 },
				{ id: 'camera-b', groupId: 'camera-group', sourceId: 'video-source-b', syncOffsetSamples: 0 },
			],
		}],
	});
}

function videoSource(id: string, digestByte: string): Record<string, unknown> {
	return createVideoSource({
		id, name: id, storageKey: id, mimeType: 'video/mp4',
		contentSha256: digestByte.repeat(32), sampleFrameCount: 100 * FRAME_SAMPLES,
		sourceFrameCount: 100, frameRate: { num: 10, den: 1 },
		width: 1_920, height: 1_080,
	});
}

function videoClip(
	id: string,
	sequenceStartFrame: number,
	sequenceFrameCount: number,
	sourceInFrame: number,
	videoComposition: VideoClipComposition,
): Readonly<Record<string, unknown>> {
	return {
		kind: 'video', id, sourceId: 'video-source-a', title: id,
		sequenceId: 'main-sequence', sequenceStartFrame, sequenceFrameCount,
		sourceInFrame, sourceFrameCount: sequenceFrameCount, retimeMap: null,
		videoComposition,
	};
}

function composition(variant: 1 | 2 | 3): VideoClipComposition {
	return normalizeVideoClipComposition({
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		crop: {
			left: variant * 0.02, top: variant * 0.01,
			right: variant * 0.01, bottom: variant * 0.02,
		},
		transform: {
			...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION.transform),
			positionX: 0.5 + variant * 0.05,
			rotationDegrees: variant * 5,
		},
		opacity: 1 - variant * 0.1,
		blendMode: variant === 1 ? 'multiply' : variant === 2 ? 'screen' : 'difference',
		compositingOrder: variant,
	});
}

function apply(project: FramescaperProjectV19, command: unknown): FramescaperProjectV19 {
	return applyFramescaperProjectCommandV19(
		PROFILE,
		project,
		command as FramescaperProjectCommandV19,
		{ now: EDITED },
	);
}

function commandProject(project: FramescaperProjectV19): Record<string, unknown> {
	return createEditorProjectRuntimeV19Selection(PROFILE)
		.projectForCommandConsumers(project) as Record<string, unknown>;
}

function stableIds(): (prefix?: string) => string {
	let next = 0;
	return (prefix = 'id') => `${prefix}-${String(next++)}`;
}

function timelineClip(project: FramescaperProjectV19, id: string): Readonly<Record<string, unknown>> {
	const result = project.clips.find((candidate) => candidate.id === id);
	assert.ok(result, `Missing timeline clip ${id}.`);
	return result;
}

function binClip(project: FramescaperProjectV19, id: string): Readonly<Record<string, unknown>> {
	const result = project.projectBin.clips.find((candidate) => candidate.id === id);
	assert.ok(result, `Missing Project Bin clip ${id}.`);
	return result;
}

function compositionOf(project: FramescaperProjectV19, id: string): CompositionRecord {
	return compositionRecord(timelineClip(project, id).videoComposition);
}

function assertOwnedComposition(
	project: FramescaperProjectV19,
	id: string,
	expected: VideoClipComposition,
	previous: CompositionRecord,
): void {
	const actual = compositionOf(project, id);
	assert.deepEqual(actual, expected);
	assert.notStrictEqual(actual, previous);
	assert.notStrictEqual(actual.crop, previous.crop);
	assert.notStrictEqual(actual.transform, previous.transform);
}

function assertDetachedFromEachOther(project: FramescaperProjectV19, leftId: string, rightId: string): void {
	const left = compositionOf(project, leftId);
	const right = compositionOf(project, rightId);
	assert.notStrictEqual(left, right);
	assert.notStrictEqual(left.crop, right.crop);
	assert.notStrictEqual(left.transform, right.transform);
}

interface CompositionRecord extends Readonly<Record<string, unknown>> {
	readonly crop: unknown;
	readonly transform: unknown;
}

function compositionRecord(value: unknown): CompositionRecord {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	const result = value as CompositionRecord;
	assert.ok(result.crop && typeof result.crop === 'object');
	assert.ok(result.transform && typeof result.transform === 'object');
	return result;
}
