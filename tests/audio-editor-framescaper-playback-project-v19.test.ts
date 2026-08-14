/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';
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

test('each nested playback occurrence owns a detached composition snapshot', () => {
	const service = createFramescaperPlaybackProjectServiceV19(PROFILE);
	const project = nestedVideoProject();
	const persistedComposition = project.clips[0]?.videoComposition;
	const clips = service.projectForPlayback(project).project.clips;

	assert.equal(clips.length, 2);
	assert.ok(clips.every((clip) => (
		clip.videoComposition === undefined
			? false
			: JSON.stringify(clip.videoComposition) === JSON.stringify(persistedComposition)
	)));
	assert.notStrictEqual(clips[0]?.videoComposition, persistedComposition);
	assert.notStrictEqual(clips[1]?.videoComposition, persistedComposition);
	assert.notStrictEqual(clips[0]?.videoComposition, clips[1]?.videoComposition);
	assert.notStrictEqual(
		(clips[0]?.videoComposition as Readonly<{ transform: unknown }>).transform,
		(clips[1]?.videoComposition as Readonly<{ transform: unknown }>).transform,
	);
});

test('V19 playback admits and projects one maintained whole-mix rendered fallback', () => {
	const service = createFramescaperPlaybackProjectServiceV19(PROFILE);
	const project = audioFallbackProject();
	const admission = service.projectForActivationAdmission?.(project);
	const playback = service.projectForPlayback(project);

	assert.equal(admission?.project, project);
	assert.equal(admission?.audioRenderedFallback?.sourceId, 'fallback-source');
	assert.deepEqual(admission?.requiredAudioSourceIds, ['fallback-source']);
	assert.equal(playback.project.schemaVersion, 17);
	assert.equal(playback.audioRenderedFallback?.sourceId, 'fallback-source');
	assert.deepEqual(playback.requiredAudioSourceIds, ['fallback-source']);
	assert.ok(playback.project.clips.some(({ sourceId }) => sourceId === 'fallback-source'));
	assert.equal(project.clips[0]?.sourceId, 'original-source');
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

function audioFallbackProject() {
	const original = {
		...createAudioSourceV9({
			id: 'original-source', storageKey: 'original-source', frameCount: 4,
			channelCount: 2, sampleRate: 48_000,
		}),
		contentSha256: '12'.repeat(32),
	};
	const fallback = {
		...createAudioSourceV9({
			id: 'fallback-source', storageKey: 'fallback-source', frameCount: 6,
			channelCount: 2, sampleRate: 48_000,
		}),
		contentSha256: '34'.repeat(32),
	};
	const clip = createAudioClipV9({
		id: 'original-clip', sourceId: original.id, durationFrames: original.frameCount,
	});
	return createFramescaperProjectV19(PROFILE, {
		id: 'fallback-v19',
		title: 'Fallback V19',
		now: '2026-08-13T12:00:00.000Z',
		sources: [original, fallback],
		clips: [clip],
		tracks: [createAudioTrackV9({ id: 'track', name: 'Audio', clipIds: [clip.id] })],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'publisher-render',
			featureId: 'org.example.future-mixer',
			displayName: 'Future mixer',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'project-audio-mix-v1', kind: 'audio',
				sourceId: fallback.id, sha256: fallback.contentSha256,
			},
		}] },
	});
}

function nestedVideoProject() {
	const rate = { num: 30, den: 1 };
	return createFramescaperProjectV19(PROFILE, {
		id: 'nested-playback-v19',
		title: 'Nested playback V19',
		now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSourceV10({
			id: 'source', name: 'Source', storageKey: 'source', mimeType: 'video/mp4',
			contentSha256: '34'.repeat(32), sampleFrameCount: 48_000,
			sourceFrameCount: 300, frameRate: rate, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'child-clip', sourceId: 'source', title: 'Child clip',
			sequenceId: 'child', sequenceStartFrame: 0, sequenceFrameCount: 30,
			sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null,
			videoComposition: {
				...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
				opacity: 0.4,
			},
		}],
		tracks: [createVideoTrackV10({
			id: 'child-track', name: 'Child video', clipIds: ['child-clip'], locked: false,
		})],
		sequences: [
			{ id: 'main', rate, trackIds: [] },
			{ id: 'child', rate, trackIds: ['child-track'] },
		],
		primarySequenceId: 'main',
		subsequences: [
			{
				id: 'nested-a', sequenceId: 'main', sourceSequenceId: 'child',
				sequenceStartFrame: 0, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 30,
			},
			{
				id: 'nested-b', sequenceId: 'main', sourceSequenceId: 'child',
				sequenceStartFrame: 60, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 30,
			},
		],
	});
}
