/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createFramescaperProjectStoreV19 } from '../src/framescaper/editor-project-store-v19.ts';
import { createFramescaperScapeNativeRuntimeV19 } from '../src/framescaper/editor-scape-native-v19.ts';
import { applyFramescaperProjectCommandV19 } from '../src/framescaper/editor-project-v19-commands.ts';
import {
	createFramescaperProjectV19,
	validateFramescaperProjectV19,
} from '../src/framescaper/editor-project-v19.ts';

const NOW = '2026-08-13T17:00:00.000Z';
const VIDEO_BYTES = new TextEncoder().encode('v19-video');
const VIDEO_SHA256 = digestScapeBytes(VIDEO_BYTES);

test('portable Scape inspects, imports, and reopens exact V19 video composition', async (context) => {
	const sender = memoryStore(context, 'sender');
	const recipient = createFramescaperProjectStoreV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		{ indexedDB: null },
	);
	const runtime = createFramescaperScapeNativeRuntimeV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
	);
	context.after(async () => {
		await sender.close();
		await recipient.close();
	});
	const composition = normalizeVideoClipComposition({
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		crop: { left: 0.125, top: 0, right: 0, bottom: 0.25 },
		transform: {
			...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION.transform),
			positionX: 0.75,
			rotationDegrees: 15,
		},
		opacity: 0.5,
		blendMode: 'screen',
		compositingOrder: 2,
	});
	const neutral = projectFixture();
	const project = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		neutral,
		{
			type: 'video-composition/set',
			clipId: 'video-clip',
			expectedComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			composition,
		},
		{ now: NOW },
	);
	await sender.writeMediaAsset('video-source', new Blob([VIDEO_BYTES], { type: 'video/mp4' }), {
		name: 'V19.mp4', mimeType: 'video/mp4',
	});

	const exported = await runtime.exportScapeProject(project, sender);
	assert.ok(exported.blob);
	const inspection = await runtime.inspectScapeProject(
		exported.blob,
		null,
		{ signal: new AbortController().signal },
		{ retain: () => undefined },
	);
	assert.equal(inspection.schemaVersion, 19);
	assert.equal(inspection.readOnly, false);
	assert.equal(inspection.id, project.id);

	const imported = await runtime.importScapeProject(exported.blob, recipient, {
		collision: 'copy',
	});
	assert.equal(imported.readOnly, false);
	assert.equal(validateFramescaperProjectV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		imported.project,
	), true);
	assert.deepEqual(imported.project.clips[0]?.videoComposition, composition);
	assert.notStrictEqual(imported.project.clips[0]?.videoComposition, project.clips[0]?.videoComposition);
	const reopened = await recipient.loadProject(project.id);
	assert.ok(reopened);
	assert.deepEqual(
		(reopened.clips as ReadonlyArray<{ readonly videoComposition?: unknown }>)[0]?.videoComposition,
		composition,
	);
	const mediaMetadata = await recipient.getMediaAssetMetadata('video-source');
	assert.ok(mediaMetadata);
	assert.equal(mediaMetadata.pendingProjectUntil, undefined);
	const reopenedMedia = await recipient.loadMediaAsset('video-source');
	assert.ok(reopenedMedia);
	assert.deepEqual(new Uint8Array(await reopenedMedia.arrayBuffer()), VIDEO_BYTES);
});

function projectFixture() {
	return createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v19-scape',
		title: 'Framescaper V19 Scape',
		now: NOW,
		sources: [createVideoSourceV10({
			id: 'video-source', name: 'V19.mp4', storageKey: 'video-source',
			mimeType: 'video/mp4', contentSha256: VIDEO_SHA256,
			frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 10,
			frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'V19 clip',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
		})],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
	});
}

function memoryStore(context: TestContext, label: string) {
	const store = createProjectStore({
		databaseName: `framescaper-v19-scape-${label}-${context.name.replace(/\W+/gu, '-')}-${Date.now()}`,
	});
	return store;
}
