/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
	type VideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import {
	normalizeFramescaperProjectCommandV19,
	type FramescaperProjectCommandV19,
} from '../src/framescaper/editor-project-v19-commands.ts';
import {
	cloneFramescaperProjectHistoryV19,
	createFramescaperProjectHistoryV19,
	executeFramescaperProjectCommandV19,
	redoFramescaperProjectCommandV19,
	undoFramescaperProjectCommandV19,
	validateFramescaperProjectHistoryV19,
} from '../src/framescaper/editor-project-v19-history.ts';
import {
	createFramescaperProjectV19,
} from '../src/framescaper/editor-project-v19.ts';

const CREATED = '2026-08-13T12:00:00.000Z';
const EDITED = '2026-08-13T12:01:00.000Z';
const UNDONE = '2026-08-13T12:03:00.000Z';
const REDONE = '2026-08-13T12:04:00.000Z';

test('V19 history makes one detached entry and restores composition through undo and redo', () => {
	const project = projectFixture();
	const mutableComposition = structuredClone(authoredComposition());
	const command = setCommand('video-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, mutableComposition);
	let history = createFramescaperProjectHistoryV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		{ limit: 2 },
	);
	history = executeFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		history,
		command,
		{ now: EDITED },
	);
	assert.equal(history.undoStack.length, 1);
	assert.equal(history.redoStack.length, 0);
	assert.deepEqual(history.present.clips[0]?.videoComposition, mutableComposition);
	(mutableComposition as unknown as Record<string, unknown>).opacity = 0.25;
	assert.equal(
		normalizeVideoClipComposition(history.present.clips[0]?.videoComposition).opacity,
		0.5,
	);
	assert.equal(normalizeFramescaperProjectCommandV19(
		history.undoStack[0]?.command,
	).composition.opacity, 0.5);

	const editedRevision = history.present.revision;
	history = undoFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		history,
		{ now: UNDONE },
	);
	assert.deepEqual(history.present.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.equal(
		history.present.featureRequirements.requirements.length,
		project.featureRequirements.requirements.length,
	);
	assert.equal(history.present.revision, editedRevision + 1);
	assert.equal(history.present.updatedAt, UNDONE);
	assert.equal(history.undoStack.length, 0);
	assert.equal(history.redoStack.length, 1);

	const undoneRevision = history.present.revision;
	history = redoFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		history,
		{ now: REDONE },
	);
	assert.equal(
		normalizeVideoClipComposition(history.present.clips[0]?.videoComposition).opacity,
		0.5,
	);
	assert.equal(
		history.present.featureRequirements.requirements.length,
		project.featureRequirements.requirements.length + 1,
	);
	assert.equal(history.present.revision, undoneRevision + 1);
	assert.equal(history.present.updatedAt, REDONE);
	assert.equal(history.undoStack.length, 1);
	assert.equal(history.redoStack.length, 0);
	assert.equal(validateFramescaperProjectHistoryV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, history), true);
});

test('V19 history validates, clones, bounds stacks, and clears redo on a new command', () => {
	const project = projectFixture();
	const composition = authoredComposition();
	let history = createFramescaperProjectHistoryV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		{ limit: 1 },
	);
	history = executeFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		history,
		setCommand('video-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, composition),
		{ now: EDITED },
	);
	history = undoFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		history,
		{ now: UNDONE },
	);
	assert.equal(history.redoStack.length, 1);
	history = executeFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		history,
		setCommand('bin-video', DEFAULT_VIDEO_CLIP_COMPOSITION, composition),
		{ now: REDONE },
	);
	assert.equal(history.undoStack.length, 1);
	assert.equal(history.redoStack.length, 0);

	const clone = cloneFramescaperProjectHistoryV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, history);
	assert.deepEqual(clone, history);
	assert.notStrictEqual(clone, history);
	assert.notStrictEqual(clone.present, history.present);
	assert.notStrictEqual(clone.undoStack[0]?.command, history.undoStack[0]?.command);

	const malformed = structuredClone(history) as unknown as Record<string, unknown>;
	((malformed.undoStack as Record<string, unknown>[])[0]!.project as Record<string, unknown>).schemaVersion = 18;
	assert.throws(
		() => validateFramescaperProjectHistoryV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, malformed),
		/schema version/iu,
	);
	assert.throws(
		() => createFramescaperProjectHistoryV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			project,
			{ limit: 0 },
		),
		/limit.*positive safe integer/iu,
	);
});

function projectFixture() {
	return createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v19-commands',
		title: 'Framescaper V19 commands',
		now: CREATED,
		sources: [
			createVideoSource({
				id: 'video-source',
				name: 'Video',
				storageKey: 'video-source',
				mimeType: 'video/mp4',
				contentSha256: '12'.repeat(32),
				frameCount: 48_000,
				sampleFrameCount: 48_000,
				sourceFrameCount: 10,
				frameRate: { num: 10, den: 1 },
				width: 1_920,
				height: 1_080,
			}),
			{
				kind: 'audio', id: 'audio-source', name: 'Audio', storageKey: 'audio-source',
				mimeType: 'audio/wav', frameCount: 48_000, channelCount: 1,
				sampleRate: 48_000, originalSampleRate: 48_000,
			},
		],
		clips: [
			{
				kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			},
			{
				kind: 'audio', id: 'audio-clip', sourceId: 'audio-source', title: 'Audio',
				timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000,
				durationFrames: 48_000,
			},
		],
		projectBin: {
			clips: [{
				kind: 'video', id: 'bin-video', sourceId: 'video-source', title: 'Bin video',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null, binItemId: 'bin-video',
			}],
		},
		tracks: [
			createVideoTrack({
				id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
			}),
			{
				id: 'audio-track', name: 'Audio', type: 'audio', clipIds: ['audio-clip'],
				height: 96, collapsed: false,
			},
		],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 },
			trackIds: ['video-track', 'audio-track'],
		}],
		primarySequenceId: 'main-sequence',
	});
}

function authoredComposition() {
	return normalizeVideoClipComposition({
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		transform: {
			...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION.transform),
			positionX: 0.75,
			rotationDegrees: 15,
		},
		opacity: 0.5,
		blendMode: 'multiply',
		compositingOrder: 2,
	});
}

function setCommand(
	clipId: string,
	expectedComposition: VideoClipComposition,
	composition: VideoClipComposition,
): FramescaperProjectCommandV19 {
	return {
		type: 'video-composition/set',
		clipId,
		expectedComposition,
		composition,
	};
}
