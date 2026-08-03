/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureVideoClipRenderFallback } from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioEditorProjectV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';

const NOW = '2026-08-03T12:00:00.000Z';
const PROJECT_ID = 'scape-video-clip-fallback';
const TARGET_CLIP_ID = 'canonical-target-video-clip';
const CANONICAL_SOURCE_ID = 'canonical-target-video-source';
const FALLBACK_SOURCE_ID = 'rendered-target-video-source';
const CANONICAL_BODY = new TextEncoder().encode('canonical target video body');
const FALLBACK_BODY = new TextEncoder().encode('rendered video-effects clip body');
const COLLIDING_BODY = new TextEncoder().encode('recipient-owned colliding video body');
const FALLBACK_DIGEST = digestScapeBytes(FALLBACK_BODY);

type ProjectStore = ReturnType<typeof createProjectStore>;

interface ScapeImportResult {
	readonly project: AudioEditorProjectV9;
	readonly collision: 'copy' | 'replace' | null;
}

test('portable Scape preserves a clip-local rendered fallback in a fresh recipient store', async (context) => {
	const sender = memoryStore(context, 'clip-fallback-sender');
	const recipient = memoryStore(context, 'clip-fallback-recipient');
	const project = clipFallbackProject();
	await persistProjectMedia(sender);

	const exported = await exportScapeProject(project, sender);
	const fallbackAsset = exported.manifest.assets.find(({ sourceId }) => sourceId === FALLBACK_SOURCE_ID);
	assert.ok(fallbackAsset);
	assert.equal(fallbackAsset.kind, 'video');
	assert.equal(fallbackAsset.sha256, FALLBACK_DIGEST);

	const imported = await importScapeProject(exported.blob, recipient) as ScapeImportResult;
	assert.equal(imported.collision, null);
	assertClipFallbackRelationship(imported.project, FALLBACK_SOURCE_ID);
	await assertStoredFallback(recipient, imported.project, FALLBACK_SOURCE_ID, FALLBACK_BODY);

	const reopenedValue = await recipient.loadProject(PROJECT_ID);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as unknown as AudioEditorProjectV9;
	assertClipFallbackRelationship(reopened, FALLBACK_SOURCE_ID);
	await assertStoredFallback(recipient, reopened, FALLBACK_SOURCE_ID, FALLBACK_BODY);
});

test('Scape collision-copy remaps only the fallback source identity, not its target clip', async (context) => {
	const sender = memoryStore(context, 'clip-fallback-copy-sender');
	const recipient = memoryStore(context, 'clip-fallback-copy-recipient');
	const project = clipFallbackProject();
	await persistProjectMedia(sender);
	const exported = await exportScapeProject(project, sender);

	await recipient.saveProject(createAudioEditorProjectV9({
		id: PROJECT_ID,
		title: 'Existing recipient project',
		now: NOW,
	}));
	await recipient.writeMediaAsset(FALLBACK_SOURCE_ID, new Blob([COLLIDING_BODY]), {
		name: 'Recipient collision.mp4',
		mimeType: 'video/mp4',
	});

	const copied = await importScapeProject(exported.blob, recipient, {
		collision: 'copy',
	}) as ScapeImportResult;
	const copiedFallback = clipFallback(copied.project);
	assert.equal(copied.collision, 'copy');
	assert.notEqual(copied.project.id, PROJECT_ID);
	assert.notEqual(copiedFallback.sourceId, FALLBACK_SOURCE_ID);
	assert.equal(copiedFallback.targetClipId, TARGET_CLIP_ID);
	assertClipFallbackRelationship(copied.project, copiedFallback.sourceId);
	await assertStoredFallback(recipient, copied.project, copiedFallback.sourceId, FALLBACK_BODY);
	assert.deepEqual(await storedMediaBytes(recipient, FALLBACK_SOURCE_ID), COLLIDING_BODY);

	const reopenedValue = await recipient.loadProject(copied.project.id);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as unknown as AudioEditorProjectV9;
	assertClipFallbackRelationship(reopened, copiedFallback.sourceId);
	assert.equal(clipFallback(reopened).targetClipId, TARGET_CLIP_ID);
});

function clipFallbackProject(): AudioEditorProjectV9 {
	const canonicalSource = createVideoSourceV9({
		id: CANONICAL_SOURCE_ID,
		storageKey: CANONICAL_SOURCE_ID,
		name: 'Canonical target.mp4',
		mimeType: 'video/mp4',
		frameCount: 80,
		sampleRate: 48_000,
		width: 1_280,
		height: 720,
		frameRate: 24,
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
	});
	const fallbackSource = createVideoSourceV9({
		id: FALLBACK_SOURCE_ID,
		storageKey: FALLBACK_SOURCE_ID,
		name: 'Rendered target.mp4',
		mimeType: 'video/mp4',
		frameCount: 20,
		sampleRate: 48_000,
		width: 1_280,
		height: 720,
		frameRate: 24,
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
	});
	const target = createVideoClipV9({
		id: TARGET_CLIP_ID,
		sourceId: CANONICAL_SOURCE_ID,
		title: 'Canonical target clip',
		timelineStartFrame: 120,
		sourceStartFrame: 8,
		sourceDurationFrames: 40,
		durationFrames: 20,
		speedRatio: 2,
		videoEffects: [{
			id: 'pixelate-a',
			type: 'pixelate',
			enabled: true,
			params: { blockSize: 12 },
		}],
	});
	return createAudioEditorProjectV9({
		id: PROJECT_ID,
		title: 'Portable video clip fallback',
		now: NOW,
		sampleRate: 48_000,
		sources: [canonicalSource, fallbackSource],
		clips: [target],
		tracks: [createVideoTrackV9({
			id: 'canonical-video-track',
			name: 'Canonical video',
			clipIds: [TARGET_CLIP_ID],
		})],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-video-effects-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
				displayName: 'Publisher video-effects render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'video-clip-render-v1',
					kind: 'video',
					sourceId: FALLBACK_SOURCE_ID,
					sha256: FALLBACK_DIGEST,
					targetClipId: TARGET_CLIP_ID,
				},
			}],
		},
	});
}

function assertClipFallbackRelationship(project: AudioEditorProjectV9, fallbackSourceId: string): void {
	const fallback = clipFallback(project);
	assert.deepEqual(fallback, {
		role: 'video-clip-render-v1',
		kind: 'video',
		sourceId: fallbackSourceId,
		sha256: FALLBACK_DIGEST,
		targetClipId: TARGET_CLIP_ID,
	});
	const target = project.clips.find((clip) => clip.id === TARGET_CLIP_ID);
	assert.ok(target);
	assert.equal(target.sourceId, CANONICAL_SOURCE_ID);
	assert.ok(project.sources.some((source) => source.id === fallbackSourceId));
}

function clipFallback(project: AudioEditorProjectV9): ProjectFeatureVideoClipRenderFallback {
	const fallback = project.featureRequirements.requirements.find(
		({ id }) => id === 'publisher-video-effects-render',
	)?.fallback;
	if (fallback?.role !== 'video-clip-render-v1') {
		throw new TypeError('Expected one video-clip-render-v1 fallback.');
	}
	return fallback;
}

async function assertStoredFallback(
	store: ProjectStore,
	project: AudioEditorProjectV9,
	fallbackSourceId: string,
	expectedBody: Uint8Array,
): Promise<void> {
	const source = project.sources.find(({ id }) => id === fallbackSourceId);
	assert.ok(source);
	const storageKey = String(source.storageKey);
	const body = await storedMediaBytes(store, storageKey);
	const metadata = await store.getMediaAssetMetadata(storageKey);
	assert.deepEqual(body, expectedBody);
	assert.equal(digestScapeBytes(body), FALLBACK_DIGEST);
	assert.equal(metadata?.sha256, FALLBACK_DIGEST);
	assert.equal(clipFallback(project).sha256, FALLBACK_DIGEST);
}

async function persistProjectMedia(store: ProjectStore): Promise<void> {
	await store.writeMediaAsset(CANONICAL_SOURCE_ID, new Blob([CANONICAL_BODY]), {
		name: 'Canonical target.mp4',
		mimeType: 'video/mp4',
	});
	await store.writeMediaAsset(FALLBACK_SOURCE_ID, new Blob([FALLBACK_BODY]), {
		name: 'Rendered target.mp4',
		mimeType: 'video/mp4',
	});
}

async function storedMediaBytes(store: ProjectStore, storageKey: string): Promise<Uint8Array> {
	const body = await store.loadMediaAsset(storageKey);
	if (!body) throw new ReferenceError(`Missing stored media asset ${storageKey}.`);
	return new Uint8Array(await body.arrayBuffer());
}

function memoryStore(context: TestContext, label: string): ProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${label}-${String(Date.now())}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}
