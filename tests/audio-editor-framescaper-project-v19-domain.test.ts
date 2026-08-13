/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import {
	cloneFramescaperProjectV19,
	createFramescaperProjectV19,
	loadFramescaperProjectV19,
	validateFramescaperProjectV19,
} from '../src/framescaper/editor-project-v19.ts';
import {
	FramescaperProjectV19ReimportRequiredError,
	migrateFramescaperProjectV19,
} from '../src/framescaper/editor-project-v19-migration.ts';
import {
	framescaperProjectForRuntimeConsumersV19,
} from '../src/framescaper/editor-project-v19-runtime.ts';

const NOW = '2026-08-13T12:00:00.000Z';

test('V19 requires its exact product authority before project traversal', () => {
	let traps = 0;
	const project = new Proxy({}, { get() { traps += 1; throw new Error('project trap'); } });
	for (const operation of [
		() => validateFramescaperProjectV19({}, project),
		() => createFramescaperProjectV19({}, project),
		() => cloneFramescaperProjectV19({}, project),
		() => loadFramescaperProjectV19({}, project),
		() => migrateFramescaperProjectV19({}, project),
		() => framescaperProjectForRuntimeConsumersV19({}, project),
	] as const) assert.throws(operation, /exact Framescaper V19 runtime profile/iu);
	assert.equal(traps, 0);
});

test('V19 creation owns a neutral composition on every video occurrence', () => {
	const project = createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, options());
	assert.equal(project.schemaVersion, 19);
	assert.deepEqual(project.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.notStrictEqual(project.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.deepEqual(project.projectBin.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.equal(Object.hasOwn(project.clips[1]!, 'videoComposition'), false);
	assert.equal(Object.isFrozen(project.clips[0]?.videoComposition), true);
	assert.equal(Object.isFrozen(project.clips[0]?.videoComposition.transform), true);
	assert.equal(validateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, project), true);
});

test('V19 validation rejects missing video composition and composition on audio', () => {
	const project = createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, options());
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete ((missing.clips as Record<string, unknown>[])[0]!).videoComposition;
	assert.throws(
		() => validateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, missing),
		/video.*videoComposition.*own enumerable data property/iu,
	);
	const audio = structuredClone(project) as unknown as Record<string, unknown>;
	((audio.clips as Record<string, unknown>[])[1]!).videoComposition = structuredClone(
		DEFAULT_VIDEO_CLIP_COMPOSITION,
	);
	assert.throws(
		() => validateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, audio),
		/audio.*must not carry videoComposition/iu,
	);
});

test('V19 clone detaches composition and runtime projection preserves it', () => {
	const project = createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, options());
	const clone = cloneFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, project);
	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone, project);
	assert.notStrictEqual(clone.clips[0]?.videoComposition, project.clips[0]?.videoComposition);
	assert.equal(Object.isFrozen(clone.clips[0]?.videoComposition), true);

	const runtime = framescaperProjectForRuntimeConsumersV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
	);
	assert.equal(runtime.schemaVersion, 17);
	assert.deepEqual(runtime.clips[0]?.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.notStrictEqual(runtime.clips[0]?.videoComposition, project.clips[0]?.videoComposition);
});

test('V19 exact-current loading rejects prior schemas and preserves future schemas opaquely', () => {
	const project = createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, options());
	assert.deepEqual(loadFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, project), {
		project,
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	});
	assert.throws(
		() => migrateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, { schemaVersion: 18 }),
		(error: unknown) => error instanceof FramescaperProjectV19ReimportRequiredError
			&& error.schemaVersion === 18
			&& error.currentSchemaVersion === 19,
	);
	const future = { schemaVersion: 20, future: { retained: true } };
	assert.deepEqual(migrateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, future), {
		project: future,
		migrated: false,
		fromVersion: 20,
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'newer-schema',
	});
});

function options(): Record<string, unknown> {
	return {
		id: 'framescaper-v19',
		title: 'Framescaper V19',
		now: NOW,
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
	};
}
