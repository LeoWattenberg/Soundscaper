/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipboardDescriptor,
	preparePasteCommand,
} from '../src/common/editor/commands/clipboard-runtime.js';
import {
	normalizeAudioEditorClipboardDescriptor,
} from '../src/common/editor/commands/clipboard-codec.ts';
import {
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
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

const CREATED = '2026-08-13T14:00:00.000Z';
const EDITED = '2026-08-13T14:01:00.000Z';

test('split detaches equal composition children and join retains one detached value', () => {
	const project = projectFixture();
	const split = apply(project, {
		type: 'clip/split', clipId: 'video-clip', atFrame: 24_000, rightClipId: 'right-clip',
	});
	const left = clip(split, 'video-clip');
	const right = clip(split, 'right-clip');
	assert.deepEqual(left.videoComposition, authoredComposition());
	assert.deepEqual(right.videoComposition, authoredComposition());
	assert.notStrictEqual(left.videoComposition, right.videoComposition);
	assert.notStrictEqual(
		normalizeVideoClipComposition(left.videoComposition).transform,
		normalizeVideoClipComposition(right.videoComposition).transform,
	);

	const joined = apply(split, { type: 'clip/join', clipIds: ['video-clip', 'right-clip'] });
	assert.equal(joined.clips.length, 1);
	assert.deepEqual(joined.clips[0]?.videoComposition, authoredComposition());
	assert.notStrictEqual(joined.clips[0]?.videoComposition, left.videoComposition);
});

test('join refuses adjacent video clips whose canonical compositions differ', () => {
	const split = apply(projectFixture(), {
		type: 'clip/split', clipId: 'video-clip', atFrame: 24_000, rightClipId: 'right-clip',
	});
	const changed = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		split,
		{
			type: 'video-composition/set',
			clipId: 'right-clip',
			expectedComposition: authoredComposition(),
			composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		} as FramescaperProjectCommandV19,
		{ now: EDITED },
	);
	assert.throws(
		() => apply(changed, { type: 'clip/join', clipIds: ['video-clip', 'right-clip'] }),
		/different processing|composition/iu,
	);
});

test('Project Bin add, move, and placement preserve detached composition ownership', () => {
	const project = projectFixture();
	const moved = apply(project, {
		type: 'project-bin/move-from-timeline', clipIds: ['video-clip'],
	});
	const binned = moved.projectBin.clips.find(({ id }) => id === 'video-clip');
	assert.ok(binned);
	assert.deepEqual(binned.videoComposition, authoredComposition());
	assert.notStrictEqual(binned.videoComposition, project.clips[0]?.videoComposition);

	const placed = apply(moved, {
		type: 'project-bin/place',
		binClipId: 'video-clip',
		timelineStartFrame: 0,
		placements: [{ binClipId: 'video-clip', trackId: 'video-track', clipId: 'placed-video' }],
	});
	const placedClip = clip(placed, 'placed-video');
	assert.deepEqual(placedClip.videoComposition, authoredComposition());
	assert.notStrictEqual(placedClip.videoComposition, binned.videoComposition);
	assert.notStrictEqual(
		placedClip.videoComposition,
		placed.projectBin.clips.find(({ id }) => id === 'video-clip')?.videoComposition,
	);

	const commandComposition = structuredClone(authoredComposition());
	const added = apply(project, {
		type: 'project-bin/add',
		clip: {
			kind: 'video', id: 'added-bin-video', sourceId: 'video-source', title: 'Added',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			binItemId: 'added-bin-video', videoComposition: commandComposition,
		},
	});
	const addedClip = added.projectBin.clips.find(({ id }) => id === 'added-bin-video');
	assert.ok(addedClip);
	assert.deepEqual(addedClip.videoComposition, commandComposition);
	assert.notStrictEqual(addedClip.videoComposition, commandComposition);
});

test('generic clip add and trim carriers retain canonical detached composition', () => {
	const project = projectFixture();
	const commandComposition = structuredClone(authoredComposition());
	const added = apply(project, {
		type: 'clip/add', trackId: 'video-track', clip: {
			kind: 'video', id: 'added-video', sourceId: 'video-source', title: 'Added',
			sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			fadeInFrames: 0, fadeOutFrames: 0,
			videoComposition: commandComposition,
		},
	});
	const addedClip = clip(added, 'added-video');
	assert.deepEqual(addedClip.videoComposition, commandComposition);
	assert.notStrictEqual(addedClip.videoComposition, commandComposition);

	const trimmed = apply(added, {
		type: 'clip/trim', clipId: 'added-video', durationFrames: 24_000,
	});
	assert.deepEqual(clip(trimmed, 'added-video').videoComposition, commandComposition);
	assert.notStrictEqual(
		clip(trimmed, 'added-video').videoComposition,
		addedClip.videoComposition,
	);
});

test('clipboard V5 copy and paste carry detached video composition', () => {
	const project = projectFixture();
	const runtime = createEditorProjectRuntimeV19Selection(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE);
	const commandProject = runtime.projectForCommandConsumers(project);
	const descriptor = createClipboardDescriptor(commandProject, {
		startFrame: 0, endFrame: 48_000, trackIds: ['video-track'], clipIds: ['video-clip'],
	});
	assert.equal(descriptor.schemaVersion, 5);
	const copied = descriptor.tracks[0]?.clips[0];
	assert.deepEqual(copied?.videoComposition, authoredComposition());
	assert.notStrictEqual(copied?.videoComposition, project.clips[0]?.videoComposition);

	let nextId = 0;
	const command = preparePasteCommand(descriptor, {
		atFrame: 48_000, mode: 'reject', project: commandProject,
	}, (prefix = 'id') => `${prefix}-${String(nextId++)}`);
	const pasted = apply(project, command);
	const pastedClipId = (command.clipIds as Record<string, string>)['video-clip:0:48000'];
	assert.ok(pastedClipId);
	const pastedClip = clip(pasted, pastedClipId);
	assert.deepEqual(pastedClip.videoComposition, authoredComposition());
	assert.notStrictEqual(pastedClip.videoComposition, copied?.videoComposition);
	assert.notStrictEqual(
		normalizeVideoClipComposition(pastedClip.videoComposition).crop,
		normalizeVideoClipComposition(copied?.videoComposition).crop,
	);
});

test('clipboard V5 requires composition only on video while V1 through V4 remain readable', () => {
	const descriptor = createClipboardDescriptor(
		createEditorProjectRuntimeV19Selection(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		).projectForCommandConsumers(projectFixture()),
		{ startFrame: 0, endFrame: 48_000, trackIds: ['video-track'] },
	);
	const missing = structuredClone(descriptor) as unknown as Record<string, unknown>;
	delete (((missing.tracks as Record<string, unknown>[])[0]!.clips as Record<string, unknown>[])[0]!
		.videoComposition);
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor(missing),
		/videoComposition.*required|required.*videoComposition/iu,
	);
	const onAudio = structuredClone(descriptor) as unknown as Record<string, unknown>;
	const track = (onAudio.tracks as Record<string, unknown>[])[0]!;
	track.sourceTrackType = 'audio';
	((track.clips as Record<string, unknown>[])[0]!).kind = 'audio';
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor(onAudio),
		/audio.*videoComposition|videoComposition.*audio/iu,
	);
	const disguised = structuredClone(descriptor) as unknown as Record<string, unknown>;
	const disguisedClip = (((disguised.tracks as Record<string, unknown>[])[0]!
		.clips as Record<string, unknown>[])[0]!);
	let reads = 0;
	Object.defineProperty(disguisedClip, 'videoComposition', {
		enumerable: true,
		get: () => { reads += 1; return authoredComposition(); },
	});
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor(disguised),
		/accessor|data propert/iu,
	);
	assert.equal(reads, 0);
	const mislabeledV4 = structuredClone(descriptor) as unknown as Record<string, unknown>;
	mislabeledV4.schemaVersion = 4;
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor(mislabeledV4),
		/V5 recopy/iu,
	);

	for (const schemaVersion of [1, 2, 3, 4] as const) {
		const legacy: Record<string, unknown> = {
			schemaVersion, sampleRate: 48_000, durationFrames: 1,
			tracks: [{
				sourceTrackId: 'audio-track',
				...(schemaVersion >= 2 ? { sourceTrackType: 'audio', sourceLaneGroupId: null } : {}),
				...(schemaVersion >= 3 ? {
					sourceTrackName: 'Audio', sourceSequenceId: 'main-sequence',
				} : {}),
				clips: [{
					key: 'audio:0:1', sourceId: 'audio-source', offsetFrame: 0,
					sourceStartFrame: 0, durationFrames: 1,
					...(schemaVersion >= 2 ? { kind: 'audio' } : {}),
				}],
			}],
			...(schemaVersion >= 3 ? { annotations: [] } : {}),
			...(schemaVersion === 4 ? { takeGroups: [] } : {}),
		};
		assert.equal(normalizeAudioEditorClipboardDescriptor(legacy).schemaVersion, schemaVersion);
	}
});

function projectFixture(): FramescaperProjectV19 {
	return createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, {
		id: 'composition-edit-preservation', title: 'Composition edit preservation', now: CREATED,
		sources: [createVideoSource({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			fadeInFrames: 0, fadeOutFrames: 0,
			videoComposition: authoredComposition(),
		}],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
		})],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
	});
}

function authoredComposition() {
	return normalizeVideoClipComposition({
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		crop: { left: 0.1, top: 0.2, right: 0.05, bottom: 0.1 },
		transform: {
			...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION.transform),
			positionX: 0.75, rotationDegrees: 15,
		},
		opacity: 0.5, blendMode: 'multiply', compositingOrder: 2,
	});
}

function apply(project: FramescaperProjectV19, command: unknown): FramescaperProjectV19 {
	return applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		command as FramescaperProjectCommandV19,
		{ now: EDITED },
	);
}

function clip(project: FramescaperProjectV19, id: string): Readonly<Record<string, unknown>> {
	const result = project.clips.find((candidate) => candidate.id === id);
	assert.ok(result);
	return result;
}
