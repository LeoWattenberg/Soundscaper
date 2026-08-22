/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts';
import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { editorProjectRuntimeProfilePrerequisiteDefinition } from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import {
	createDefaultDissolveVideoTransitionV1,
} from '../src/common/editor/video-transition-registry.ts';
import {
	FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v22.ts';
import { createFramescaperScapeNativeRuntimeV22 } from '../src/framescaper/editor-scape-native-v22.ts';
import {
	applyFramescaperProjectCommandV22,
	canonicalTransitionEdgesForProjectV22,
} from '../src/framescaper/editor-project-v22-commands.ts';
import {
	createFramescaperProjectHistoryV22,
	executeFramescaperProjectCommandV22,
	redoFramescaperProjectCommandV22,
	undoFramescaperProjectCommandV22,
} from '../src/framescaper/editor-project-v22-history.ts';
import {
	cloneFramescaperProjectV22,
	createFramescaperProjectV22,
	loadFramescaperProjectV22,
	validateFramescaperProjectV22,
	type FramescaperProjectV22,
} from '../src/framescaper/editor-project-v22.ts';
import {
	createFramescaperVideoClipboardV7,
	normalizeFramescaperVideoClipboardV7,
	prepareFramescaperVideoClipboardPasteV7,
} from '../src/framescaper/editor-session-clipboard-v7.ts';
import {
	FRAMESCAPER_V22_COMPATIBILITY_CONTRACT,
	framescaperDesktopProjectTransportV22,
} from '../src/framescaper/desktop-project-transport-v22.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE;

test('V22 candidate freezes its dormant compatibility identity without changing the selected route', () => {
	const definition = editorProjectRuntimeProfileDefinition(PROFILE);
	assert.deepEqual(editorProjectRuntimeProfilePrerequisiteDefinition(definition.prerequisite), {
		owner: 'framescaper',
		projectSchemaVersion: 22,
		storageProfile: editorProjectRuntimeProfilePrerequisiteDefinition(definition.prerequisite).storageProfile,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 13,
		desktopProjectSchemaVersion: 22,
		desktopDatabaseUserVersion: 15,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v13'],
	});
	assert.deepEqual(FRAMESCAPER_V22_COMPATIBILITY_CONTRACT, {
		projectSchemaVersion: 22,
		desktopLibrarySchemaVersion: 13,
		desktopDatabaseUserVersion: 15,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v13'],
		clipboardSchemaVersion: 7,
		renderPlanVersion: 9,
		activation: 'dormant-candidate',
	});
	const registrations = editorProjectFeatureCapabilityProfileDefinition(
		definition.capabilityProfile,
	).registrations;
	assert.equal(registrations.find(({ key }) => key === 'videoTransitions')?.available, true);
	assert.equal(registrations.find(({ key }) => key === 'videoTransitionDissolve')?.available, true);
	assert.deepEqual(Object.keys(createFramescaperScapeNativeRuntimeV22(PROFILE)), [
		'inspectScapeProject', 'importScapeProject', 'exportScapeProject', 'copyScapeArchive',
	]);
	assert.throws(() => createFramescaperScapeNativeRuntimeV22({}), /V22 candidate profile/iu);
});

test('V22 create, validate, clone, transport, and load preserve exact track-owned transitions', () => {
	const project = transitionProject();
	const videoTrack = project.tracks.find(({ id }) => id === 'video-track')!;
	const audioTrack = project.tracks.find(({ id }) => id === 'audio-track')!;
	assert.equal(project.schemaVersion, 22);
	assert.deepEqual(videoTrack.videoTransitions, [transitionFixture()]);
	assert.equal(Object.hasOwn(audioTrack, 'videoTransitions'), false);
	assert.equal(validateFramescaperProjectV22(PROFILE, project), true);
	const clone = cloneFramescaperProjectV22(PROFILE, project);
	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone.tracks, project.tracks);
	assert.notStrictEqual(clone.tracks[0]!.videoTransitions, project.tracks[0]!.videoTransitions);
	assert.deepEqual(framescaperDesktopProjectTransportV22(PROFILE).decode(
		framescaperDesktopProjectTransportV22(PROFILE).encode(project),
	), project);
	assert.throws(() => loadFramescaperProjectV22(PROFILE, { schemaVersion: 20 }), /re-import|reimport/iu);
	assert.deepEqual(loadFramescaperProjectV22(PROFILE, { schemaVersion: 24, future: true }), {
		project: { schemaVersion: 24, future: true },
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'newer-schema',
	});
});

test('V22 rejects transition ownership, geometry, identity, and canonical-order violations', () => {
	const project = transitionProject();
	const audioOwned = structuredClone(project) as unknown as Record<string, unknown>;
	track(audioOwned, 'audio-track').videoTransitions = [];
	assert.throws(() => validateFramescaperProjectV22(PROFILE, audioOwned), /audio.*videoTransitions|must not carry/iu);

	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete track(missing, 'video-track').videoTransitions;
	assert.throws(() => validateFramescaperProjectV22(PROFILE, missing), /videoTransitions.*own enumerable/iu);

	const dangling = structuredClone(project) as unknown as Record<string, unknown>;
	(track(dangling, 'video-track').videoTransitions as Record<string, unknown>[])[0]!.incomingClipId = 'missing';
	assert.throws(() => validateFramescaperProjectV22(PROFILE, dangling), /missing|pair|overlap/iu);

	const duplicateIdentity = structuredClone(project) as unknown as Record<string, unknown>;
	(track(duplicateIdentity, 'video-track').videoTransitions as Record<string, unknown>[])[0]!.id = 'video-source';
	assert.throws(() => validateFramescaperProjectV22(PROFILE, duplicateIdentity), /identity|duplicate|collid/iu);

	const unowned = structuredClone(project) as unknown as Record<string, unknown>;
	track(unowned, 'video-track').videoTransitions = [];
	assert.throws(() => validateFramescaperProjectV22(PROFILE, unowned), /proper overlap|exactly one transition/iu);
});

test('V22 direct transition set and history compare edges and state atomically', () => {
	const project = transitionProject();
	const expectedTransition = transitionFixture();
	const edges = canonicalTransitionEdgesForProjectV22(PROFILE, project, 'video-track', 'transition-a');
	const transition = {
		...expectedTransition,
		alignment: 'start-at-cut' as const,
	};
	const command = {
		type: 'video-transition/set' as const,
		trackId: 'video-track',
		transitionId: 'transition-a',
		expectedTransition,
		transition,
		expectedEdges: edges,
		edges,
	};
	const changed = applyFramescaperProjectCommandV22(PROFILE, project, command, {
		now: '2026-08-22T12:00:00.000Z',
	});
	assert.equal(changed.revision, project.revision + 1);
	assert.equal(videoTransitions(changed)[0]!.alignment, 'start-at-cut');
	assert.throws(() => applyFramescaperProjectCommandV22(PROFILE, changed, command), /stale|expected/iu);

	const history = executeFramescaperProjectCommandV22(
		PROFILE,
		createFramescaperProjectHistoryV22(PROFILE, project),
		command,
	);
	assert.equal(videoTransitions(history.present)[0]!.alignment, 'start-at-cut');
	const undone = undoFramescaperProjectCommandV22(PROFILE, history);
	assert.equal(videoTransitions(undone.present)[0]!.alignment, 'center-on-cut');
	const redone = redoFramescaperProjectCommandV22(PROFILE, undone);
	assert.equal(videoTransitions(redone.present)[0]!.alignment, 'start-at-cut');
});

test('V22 inherited topology edits remove destroyed transitions and require explicit allocations for new pairs', () => {
	const project = transitionProject();
	const removed = applyFramescaperProjectCommandV22(PROFILE, project, {
		type: 'clip/remove', clipId: 'incoming-clip', videoTransitionAllocations: [],
	});
	assert.deepEqual(videoTransitions(removed), []);
	assert.equal(removed.featureRequirements.requirements.some(
		({ id }) => id === 'framescaper.video-transitions',
	), false);
});

test('Framescaper clipboard V7 carries only complete pairs and consumes exact paste allocations', () => {
	const project = transitionProject();
	const complete = createFramescaperVideoClipboardV7(PROFILE, project, {
		trackId: 'video-track', clipIds: ['outgoing-clip', 'incoming-clip'],
	});
	assert.equal(complete.schemaVersion, 7);
	assert.deepEqual(complete.transitions, [transitionFixture()]);
	assert.deepEqual(normalizeFramescaperVideoClipboardV7(structuredClone(complete)), complete);
	assert.throws(
		() => normalizeFramescaperVideoClipboardV7({ ...complete, schemaVersion: 6 }),
		/V7|recopy|re-copy/iu,
	);
	const partial = createFramescaperVideoClipboardV7(PROFILE, project, {
		trackId: 'video-track', clipIds: ['outgoing-clip'],
	});
	assert.deepEqual(partial.transitions, []);
	const paste = prepareFramescaperVideoClipboardPasteV7(complete, {
		trackId: 'video-track-copy',
		clipIdMap: new Map([
			['outgoing-clip', 'outgoing-copy'], ['incoming-clip', 'incoming-copy'],
		]),
		videoTransitionAllocations: [{
			trackId: 'video-track-copy', outgoingClipId: 'outgoing-copy',
			incomingClipId: 'incoming-copy', transitionId: 'transition-copy',
		}],
	});
	assert.deepEqual(paste.transitions.map(({ id, outgoingClipId, incomingClipId }) => ({
		id, outgoingClipId, incomingClipId,
	})), [{
		id: 'transition-copy', outgoingClipId: 'outgoing-copy', incomingClipId: 'incoming-copy',
	}]);
	assert.throws(() => prepareFramescaperVideoClipboardPasteV7(complete, {
		trackId: 'video-track-copy',
		clipIdMap: new Map([
			['outgoing-clip', 'outgoing-clip'], ['incoming-clip', 'incoming-copy'],
		]),
		videoTransitionAllocations: [{
			trackId: 'video-track-copy', outgoingClipId: 'outgoing-clip',
			incomingClipId: 'incoming-copy', transitionId: 'transition-copy',
		}],
	}), /fresh/iu);
	assert.throws(() => prepareFramescaperVideoClipboardPasteV7(complete, {
		trackId: 'video-track-copy',
		clipIdMap: new Map([
			['outgoing-clip', 'outgoing-copy'], ['incoming-clip', 'incoming-copy'],
			['unused-clip', 'unused-copy'],
		]),
		videoTransitionAllocations: [{
			trackId: 'video-track-copy', outgoingClipId: 'outgoing-copy',
			incomingClipId: 'incoming-copy', transitionId: 'transition-copy',
		}],
	}), /unused/iu);
	assert.throws(() => prepareFramescaperVideoClipboardPasteV7(complete, {
		trackId: 'video-track-copy',
		clipIdMap: new Map([
			['outgoing-clip', 'outgoing-copy'], ['incoming-clip', 'incoming-copy'],
		]),
		videoTransitionAllocations: [{
			trackId: 'video-track-copy', outgoingClipId: 'outgoing-copy',
			incomingClipId: 'incoming-copy', transitionId: 'outgoing-copy',
		}],
	}), /collid|unique/iu);
});

function transitionProject(): FramescaperProjectV22 {
	const options = framescaperV20Options();
	const clips = options.clips as Record<string, unknown>[];
	clips[0]!.id = 'outgoing-clip';
	clips.push({
		...structuredClone(clips[0]),
		id: 'incoming-clip', title: 'Incoming', sequenceStartFrame: 6,
	});
	const tracks = options.tracks as Record<string, unknown>[];
	(tracks[0]!.clipIds as string[]) = ['outgoing-clip', 'incoming-clip'];
	return createFramescaperProjectV22(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [transitionFixture()] },
	});
}

function transitionFixture() {
	return createDefaultDissolveVideoTransitionV1({
		id: 'transition-a', outgoingClipId: 'outgoing-clip',
		incomingClipId: 'incoming-clip', durationFrames: 4,
	});
}

function track(project: Record<string, unknown>, id: string): Record<string, unknown> {
	return (project.tracks as Record<string, unknown>[]).find((candidate) => candidate.id === id)!;
}

function videoTransitions(project: FramescaperProjectV22) {
	return project.tracks.find(({ id }) => id === 'video-track')!.videoTransitions!;
}
