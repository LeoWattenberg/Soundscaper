/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	FramescaperProjectV20ReimportRequiredError,
	migrateFramescaperProjectV20,
} from '../src/framescaper/editor-project-v20-migration.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
	validateFramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import { createFramescaperScapeNativeRuntimeV20 } from '../src/framescaper/editor-scape-native-v20.ts';
import { opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;
const NOW = '2026-08-13T19:00:00.000Z';
const VIDEO_BYTES = new TextEncoder().encode('v20-keyframed-video');
const VIDEO_SHA256 = digestScapeBytes(VIDEO_BYTES);

test('portable Scape inspects, imports, and reopens exact V20 keyframes', async (context) => {
	const sender = memoryStore(context, 'sender');
	const recipient = memoryStore(context, 'recipient');
	const runtime = createFramescaperScapeNativeRuntimeV20(PROFILE);
	context.after(async () => {
		await sender.close();
		await recipient.close();
	});
	const project = authoredProject();
	await sender.writeMediaAsset('video-source', new Blob([VIDEO_BYTES], { type: 'video/mp4' }), {
		name: 'V20.mp4', mimeType: 'video/mp4',
	});

	const exported = await runtime.exportScapeProject(project, sender);
	assert.ok(exported.blob);
	const inspection = await runtime.inspectScapeProject(
		exported.blob,
		null,
		{ signal: new AbortController().signal },
		{ retain: () => undefined },
	);
	assert.equal(inspection.schemaVersion, 20);
	assert.equal(inspection.readOnly, false);
	assert.equal((inspection.featureRequirementsCompatibility as { compatible?: boolean } | null)
		?.compatible, false);

	const imported = await runtime.importScapeProject(exported.blob, recipient, { collision: 'copy' });
	assert.equal(imported.readOnly, false);
	assert.equal(validateFramescaperProjectV20(PROFILE, imported.project), true);
	assert.deepEqual(imported.project.clips[0]?.videoKeyframes, project.clips[0]?.videoKeyframes);
	assert.notStrictEqual(imported.project.clips[0]?.videoKeyframes, project.clips[0]?.videoKeyframes);
	const reopened = await recipient.loadProject(project.id);
	assert.ok(reopened);
	assert.deepEqual(
		(reopened.clips as ReadonlyArray<{ readonly videoKeyframes?: unknown }>)[0]?.videoKeyframes,
		project.clips[0]?.videoKeyframes,
	);
	const reopenedMedia = await recipient.loadMediaAsset('video-source');
	assert.ok(reopenedMedia);
	assert.deepEqual(new Uint8Array(await reopenedMedia.arrayBuffer()), VIDEO_BYTES);
});

test('V20 migration rejects prior authority and keeps future authority opaque', () => {
	assert.throws(
		() => migrateFramescaperProjectV20(PROFILE, { schemaVersion: 19 }),
		(error: unknown) => error instanceof FramescaperProjectV20ReimportRequiredError
			&& error.schemaVersion === 19 && error.currentSchemaVersion === 20,
	);
	const future = { schemaVersion: 21, id: 'future', nested: { retained: true } };
	const migrated = migrateFramescaperProjectV20(PROFILE, future);
	assert.equal(migrated.readOnly, true);
	assert.equal(migrated.reason, 'newer-schema');
	assert.deepEqual(migrated.project, future);
	assert.notStrictEqual(migrated.project, future);
});

function authoredProject() {
	const project = createFramescaperProjectV20(PROFILE, {
		id: 'framescaper-v20-scape', title: 'Framescaper V20 Scape', now: NOW,
		sources: [createVideoSourceV10({
			id: 'video-source', name: 'V20.mp4', storageKey: 'video-source',
			mimeType: 'video/mp4', contentSha256: VIDEO_SHA256,
			frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 10,
			frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'V20 clip',
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
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes();
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	assert.equal(validateFramescaperProjectV20(PROFILE, project), true);
	return project;
}

function memoryStore(context: TestContext, label: string) {
	return createProjectStore({
		databaseName: `framescaper-v20-scape-${label}-${context.name.replace(/\W+/gu, '-')}-${Date.now()}`,
	});
}
