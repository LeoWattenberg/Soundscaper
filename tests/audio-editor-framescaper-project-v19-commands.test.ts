/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
	type VideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV19,
} from '../src/framescaper/editor-project-feature-requirements-v19.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import {
	applyFramescaperProjectCommandV19,
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
	validateFramescaperProjectV19,
} from '../src/framescaper/editor-project-v19.ts';

const CREATED = '2026-08-13T12:00:00.000Z';
const EDITED = '2026-08-13T12:01:00.000Z';
const RESET = '2026-08-13T12:02:00.000Z';
const UNDONE = '2026-08-13T12:03:00.000Z';
const REDONE = '2026-08-13T12:04:00.000Z';

test('a V19 set command atomically replaces timeline composition and reconciles ownership', () => {
	const project = projectFixture();
	const composition = authoredComposition();
	const edited = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		setCommand('video-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, composition),
		{ now: EDITED },
	);
	assert.deepEqual(project.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.deepEqual(edited.clips[0]?.videoComposition, composition);
	assert.notStrictEqual(edited.clips[0]?.videoComposition, composition);
	assert.equal(Object.isFrozen(edited.clips[0]?.videoComposition), true);
	assert.equal(Object.isFrozen(edited.clips[0]?.videoComposition.transform), true);
	assert.equal(edited.revision, project.revision + 1);
	assert.equal(edited.updatedAt, EDITED);
	assert.equal(
		edited.featureRequirements.requirements.length,
		project.featureRequirements.requirements.length + 1,
	);
	assert.equal(validateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, edited), true);

	const reset = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		edited,
		setCommand('video-clip', composition, DEFAULT_VIDEO_CLIP_COMPOSITION),
		{ now: RESET },
	);
	assert.deepEqual(reset.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.notStrictEqual(reset.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.deepEqual(reset.featureRequirements, project.featureRequirements);
	assert.equal(reset.revision, edited.revision + 1);
	assert.equal(reset.updatedAt, RESET);
});

test('the same exact command targets Project Bin video and rejects audio or missing targets', () => {
	const project = projectFixture();
	const composition = authoredComposition();
	const edited = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		setCommand('bin-video', DEFAULT_VIDEO_CLIP_COMPOSITION, composition),
		{ now: EDITED },
	);
	assert.deepEqual(edited.projectBin.clips[0]?.videoComposition, composition);
	assert.deepEqual(edited.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.throws(
		() => applyFramescaperProjectCommandV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			project,
			setCommand('audio-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, composition),
		),
		/audio.*video composition|video.*clip/iu,
	);
	assert.throws(
		() => applyFramescaperProjectCommandV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			project,
			setCommand('missing-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, composition),
		),
		/missing-clip.*missing|missing.*clip/iu,
	);
});

test('commands are closed snapshots and fail stale or invalid replacement values without mutation', () => {
	const project = projectFixture();
	const before = structuredClone(project);
	const composition = authoredComposition();
	assert.throws(
		() => applyFramescaperProjectCommandV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			project,
			setCommand('video-clip', composition, composition),
		),
		/stale.*composition|composition.*stale/iu,
	);
	assert.deepEqual(project, before);

	const invalid = structuredClone(composition) as unknown as Record<string, unknown>;
	invalid.opacity = 2;
	assert.throws(
		() => applyFramescaperProjectCommandV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			project,
			setCommand(
				'video-clip',
				DEFAULT_VIDEO_CLIP_COMPOSITION,
				invalid as unknown as VideoClipComposition,
			),
		),
		/opacity.*range/iu,
	);
	assert.throws(
		() => normalizeFramescaperProjectCommandV19({
			...setCommand('video-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, composition),
			future: true,
		}),
		/unsupported field/iu,
	);
	const accessor = setCommand('video-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, composition);
	Object.defineProperty(accessor, 'clipId', { enumerable: true, get: () => 'video-clip' });
	assert.throws(() => normalizeFramescaperProjectCommandV19(accessor), /clipId.*data property/iu);
	assert.throws(
		() => normalizeFramescaperProjectCommandV19({ ...accessor, type: 'video-composition/reset' }),
		/type.*video-composition\/set/iu,
	);
});

test('proxy-attached V19 projects are intrinsically read-only before command publication', () => {
	const attached = structuredClone(projectFixture()) as unknown as Record<string, unknown>;
	(attached.sources as Record<string, unknown>[])[0]!.proxyAttachment = attachment();
	attached.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		attached,
	);
	assert.equal(validateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, attached), true);
	assert.throws(
		() => applyFramescaperProjectCommandV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			attached,
			setCommand('video-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, authoredComposition()),
		),
		/proxy-attached.*read-only|intrinsically read-only/iu,
	);
});

test('inherited editor commands preserve exact V19 composition and remain history-owned', () => {
	const project = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		projectFixture(),
		setCommand('video-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, authoredComposition()),
		{ now: EDITED },
	);
	const renamed = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		{ type: 'project/rename', title: 'Renamed V19' },
		{ now: RESET },
	);
	assert.equal(renamed.title, 'Renamed V19');
	assert.deepEqual(renamed.clips[0]?.videoComposition, authoredComposition());
	assert.equal(renamed.schemaVersion, 19);
	assert.equal(validateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, renamed), true);

	const history = executeFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		createFramescaperProjectHistoryV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, project),
		{ type: 'project/rename', title: 'History rename' },
		{ now: RESET },
	);
	assert.equal(history.present.title, 'History rename');
	assert.equal(history.undoStack[0]?.command.type, 'project/rename');
	assert.deepEqual(history.present.clips[0]?.videoComposition, authoredComposition());
});

test('V19 rejects legacy video clipboard content instead of inventing neutral composition', () => {
	const clipboard = {
		schemaVersion: 4,
		sampleRate: 48_000,
		durationFrames: 1,
		tracks: [{
			sourceTrackId: 'legacy-video',
			sourceTrackName: 'Legacy video',
			sourceTrackType: 'video',
			sourceLaneGroupId: null,
			sourceSequenceId: 'main-sequence',
			clips: [],
		}],
		annotations: [],
		takeGroups: [],
	};
	assert.throws(
		() => applyFramescaperProjectCommandV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			projectFixture(),
			{ type: 'clipboard/paste', clipboard, atFrame: 0 } as unknown as FramescaperProjectCommandV19,
		),
		/V5 recopy/iu,
	);
});

test('a V19 composition batch publishes all stale-safe children in one revision', () => {
	const project = projectFixture();
	const composition = authoredComposition();
	const edited = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		{
			type: 'batch',
			commands: [
				setCommand('video-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, composition),
				setCommand('bin-video', DEFAULT_VIDEO_CLIP_COMPOSITION, composition),
			],
		} as FramescaperProjectCommandV19,
		{ now: EDITED },
	);
	assert.equal(edited.revision, project.revision + 1);
	assert.deepEqual(edited.clips[0]?.videoComposition, composition);
	assert.deepEqual(edited.projectBin.clips[0]?.videoComposition, composition);
});

test('direct composition editing rejects a locked owning timeline track', () => {
	const project = structuredClone(projectFixture());
	(project.tracks[0] as Record<string, unknown>).locked = true;
	assert.throws(
		() => applyFramescaperProjectCommandV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			project,
			setCommand('video-clip', DEFAULT_VIDEO_CLIP_COMPOSITION, authoredComposition()),
		),
		/locked.*video-track|video-track.*locked/iu,
	);
});

test('V19 validation refuses transition peers with different blend or order', () => {
	const project = structuredClone(projectFixture()) as unknown as Record<string, unknown>;
	const clips = project.clips as Record<string, unknown>[];
	const incoming = structuredClone(clips[0])!;
	incoming.id = 'incoming-video';
	incoming.sequenceStartFrame = 5;
	incoming.videoComposition = authoredComposition();
	clips.push(incoming);
	((project.tracks as Record<string, unknown>[])[0]!.clipIds as string[]).push('incoming-video');
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
	);
	assert.throws(
		() => validateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, project),
		/transition.*blend mode|blend mode.*transition/iu,
	);
});

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
			createVideoSourceV10({
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
			createVideoTrackV10({
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

function attachment(): Record<string, unknown> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${'34'.repeat(32)}`, mimeType: 'video/mp4', byteLength: 1,
		sha256: '34'.repeat(32), originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${'56'.repeat(32)}`,
			sha256: '56'.repeat(32), sourceSha256: '34'.repeat(32), byteLength: 112,
			frameCount: 10, timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}
