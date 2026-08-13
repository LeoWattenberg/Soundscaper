/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
} from '../src/common/editor/video-clip-composition.ts';
import {
	createFramescaperPlaybackProjectServiceV19,
} from '../src/framescaper/editor-project-playback-v19.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { applyFramescaperProjectCommandV19 } from '../src/framescaper/editor-project-v19-commands.ts';
import { createFramescaperProjectV19 } from '../src/framescaper/editor-project-v19.ts';

const PROFILE = FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE;

test('V19 playback authenticates its exact profile before observing project input', () => {
	let reads = 0;
	const hostile = new Proxy({}, {
		get() { reads += 1; throw new Error('project get'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('project descriptor'); },
		ownKeys() { reads += 1; throw new Error('project keys'); },
	});
	assert.throws(
		() => createFramescaperPlaybackProjectServiceV19({}).projectForPlayback(hostile),
		/exact Framescaper V19/iu,
	);
	assert.equal(reads, 0);
});

test('V19 geometry remains available through its V17 playback foundation', () => {
	const service = createFramescaperPlaybackProjectServiceV19(PROFILE);
	const neutral = videoProject();
	const composition = {
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		opacity: 0.4,
		transform: {
			...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION.transform),
			positionX: 0.75,
		},
	};
	const project = applyFramescaperProjectCommandV19(PROFILE, neutral, {
		type: 'video-composition/set',
		clipId: 'clip',
		expectedComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		composition,
	});
	const projection = service.projectForPlayback(project);
	assert.equal(projection.project.schemaVersion, 17);
	assert.equal(projection.featureRequirementsReport?.compatible, true);
	assert.deepEqual(projection.project.clips[0]?.videoComposition, composition);
	assert.notStrictEqual(
		projection.project.clips[0]?.videoComposition,
		project.clips[0]?.videoComposition,
	);
	assert.deepEqual(projection.requiredAudioSourceIds, []);
	assert.deepEqual(projection.requiredVideoSourceIds, []);
});

test('non-V19 projects stay opaque and produce no source requirements', () => {
	const service = createFramescaperPlaybackProjectServiceV19(PROFILE);
	let nestedReads = 0;
	const project = {
		schemaVersion: 20,
		id: 'future-v20',
		title: 'Future',
		sources: new Proxy([], {
			get() { nestedReads += 1; throw new Error('nested source read'); },
		}),
	};
	const projection = service.projectForPlayback(project);
	assert.equal(projection.project, project);
	assert.equal(projection.featureRequirementsReport, null);
	assert.deepEqual(projection.requiredAudioSourceIds, []);
	assert.deepEqual(projection.requiredVideoSourceIds, []);
	assert.equal(nestedReads, 0);
});

function videoProject() {
	const rate = { num: 30, den: 1 };
	return createFramescaperProjectV19(PROFILE, {
		id: 'playback-v19',
		title: 'Playback V19',
		now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSourceV10({
			id: 'source', name: 'Source', storageKey: 'source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), sampleFrameCount: 48_000,
			sourceFrameCount: 300, frameRate: rate, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'clip', sourceId: 'source', title: 'Clip', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0,
			sourceFrameCount: 30, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'track', name: 'Video', clipIds: ['clip'], locked: false,
		})],
		sequences: [{ id: 'main', rate, trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
}
