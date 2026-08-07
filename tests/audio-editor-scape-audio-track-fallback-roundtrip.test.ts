/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureAudioTrackRenderFallback } from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';

const NOW = '2026-08-08T13:00:00.000Z';
const PROJECT_ID = 'scape-audio-track-fallback';
const TARGET_TRACK_ID = 'canonical-fx-track';
const LANE_SOURCE_ID = 'canonical-lane-source';
const FALLBACK_SOURCE_ID = 'rendered-track-source';
const LANE_SAMPLES = [0.5, -0.5, 0.25, -0.25] as const;
const FALLBACK_SAMPLES = [0.125, -0.75, 1, 0] as const;
const COLLIDING_SAMPLES = [0.875, -0.875] as const;
const FALLBACK_DIGEST = audioAssetDigest(FALLBACK_SAMPLES);

type ProjectStore = ReturnType<typeof createProjectStore>;

interface ScapeImportResult {
	readonly project: AudioEditorProjectV9;
	readonly collision: 'copy' | 'replace' | null;
}

test('portable Scape preserves a track-local audio fallback in a fresh recipient store', async (context) => {
	const sender = memoryStore(context, 'track-fallback-sender');
	const recipient = memoryStore(context, 'track-fallback-recipient');
	const project = trackFallbackProject();
	await persistProjectAudio(sender);

	const exported = await exportScapeProject(project, sender);
	const fallbackAsset = exported.manifest.assets.find(({ sourceId }) => sourceId === FALLBACK_SOURCE_ID);
	assert.ok(fallbackAsset);
	assert.equal(fallbackAsset.kind, 'audio');
	assert.equal(fallbackAsset.sha256, FALLBACK_DIGEST);

	const imported = await importScapeProject(exported.blob, recipient) as ScapeImportResult;
	assert.equal(imported.collision, null);
	assertTrackFallbackRelationship(imported.project, FALLBACK_SOURCE_ID);
	await assertStoredPcm(recipient, imported.project, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);

	const reopenedValue = await recipient.loadProject(PROJECT_ID);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as unknown as AudioEditorProjectV9;
	assertTrackFallbackRelationship(reopened, FALLBACK_SOURCE_ID);
	await assertStoredPcm(recipient, reopened, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);
});

test('Scape collision-copy remaps only the fallback source identity, not its target track', async (context) => {
	const sender = memoryStore(context, 'track-fallback-copy-sender');
	const recipient = memoryStore(context, 'track-fallback-copy-recipient');
	const project = trackFallbackProject();
	await persistProjectAudio(sender);
	const exported = await exportScapeProject(project, sender);

	await recipient.saveProject(createAudioEditorProjectV9({
		id: PROJECT_ID,
		title: 'Existing recipient project',
		now: NOW,
	}));
	await persistPcm(recipient, FALLBACK_SOURCE_ID, COLLIDING_SAMPLES);

	const copied = await importScapeProject(exported.blob, recipient, {
		collision: 'copy',
	}) as ScapeImportResult;
	const copiedFallback = trackFallback(copied.project);
	assert.equal(copied.collision, 'copy');
	assert.notEqual(copied.project.id, PROJECT_ID);
	assert.notEqual(copiedFallback.sourceId, FALLBACK_SOURCE_ID);
	assert.equal(copiedFallback.targetTrackId, TARGET_TRACK_ID);
	assertTrackFallbackRelationship(copied.project, copiedFallback.sourceId);
	await assertStoredPcm(recipient, copied.project, copiedFallback.sourceId, FALLBACK_SAMPLES);
	assert.deepEqual(await storedSamples(recipient, FALLBACK_SOURCE_ID), [...COLLIDING_SAMPLES]);

	const reopenedValue = await recipient.loadProject(copied.project.id);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as unknown as AudioEditorProjectV9;
	assertTrackFallbackRelationship(reopened, copiedFallback.sourceId);
	assert.equal(trackFallback(reopened).targetTrackId, TARGET_TRACK_ID);
});

function trackFallbackProject(): AudioEditorProjectV9 {
	const laneSource = createAudioSourceV9({
		id: LANE_SOURCE_ID,
		storageKey: LANE_SOURCE_ID,
		name: 'Canonical lane.wav',
		mimeType: 'audio/wav',
		frameCount: LANE_SAMPLES.length,
		channelCount: 1,
	});
	const fallbackSource = createAudioSourceV9({
		id: FALLBACK_SOURCE_ID,
		storageKey: FALLBACK_SOURCE_ID,
		name: 'Rendered lane.wav',
		mimeType: 'audio/wav',
		frameCount: FALLBACK_SAMPLES.length,
		channelCount: 1,
	});
	const laneClip = createAudioClipV9({
		id: 'canonical-lane-clip',
		sourceId: LANE_SOURCE_ID,
		timelineStartFrame: 0,
		durationFrames: LANE_SAMPLES.length,
	});
	return createAudioEditorProjectV9({
		id: PROJECT_ID,
		title: 'Portable audio track fallback',
		now: NOW,
		sampleRate: 48_000,
		sources: [laneSource, fallbackSource],
		clips: [laneClip],
		tracks: [createAudioTrackV9({
			id: TARGET_TRACK_ID,
			name: 'Saturated lane',
			clipIds: [laneClip.id],
			effects: [{ id: 'foreign-fx', type: 'com.example.saturator', enabled: true, params: {} }],
		})],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-track-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
				displayName: 'Publisher track render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'audio-track-render-v1',
					kind: 'audio',
					sourceId: FALLBACK_SOURCE_ID,
					sha256: FALLBACK_DIGEST,
					targetTrackId: TARGET_TRACK_ID,
				},
			}],
		},
	});
}

function assertTrackFallbackRelationship(project: AudioEditorProjectV9, fallbackSourceId: string): void {
	const fallback = trackFallback(project);
	assert.deepEqual(fallback, {
		role: 'audio-track-render-v1',
		kind: 'audio',
		sourceId: fallbackSourceId,
		sha256: FALLBACK_DIGEST,
		targetTrackId: TARGET_TRACK_ID,
	});
	const target = project.tracks.find((track) => track.id === TARGET_TRACK_ID);
	assert.ok(target);
	assert.deepEqual(target.clipIds, ['canonical-lane-clip'], 'the canonical lane must stay unprojected');
	assert.ok(project.sources.some((source) => source.id === fallbackSourceId));
}

function trackFallback(project: AudioEditorProjectV9): ProjectFeatureAudioTrackRenderFallback {
	const fallback = project.featureRequirements.requirements.find(
		({ id }) => id === 'publisher-track-render',
	)?.fallback;
	if (fallback?.role !== 'audio-track-render-v1') {
		throw new TypeError('Expected one audio-track-render-v1 fallback.');
	}
	return fallback;
}

async function assertStoredPcm(
	store: ProjectStore,
	project: AudioEditorProjectV9,
	fallbackSourceId: string,
	expectedSamples: readonly number[],
): Promise<void> {
	const source = project.sources.find(({ id }) => id === fallbackSourceId);
	assert.ok(source);
	const storageKey = String(source.storageKey ?? source.id);
	assert.deepEqual(await storedSamples(store, storageKey), [...expectedSamples]);
	assert.equal(trackFallback(project).sha256, FALLBACK_DIGEST);
}

async function storedSamples(store: ProjectStore, storageKey: string): Promise<number[]> {
	const samples: number[] = [];
	for await (const value of store.readSourceChunks(storageKey)) {
		const channels = Array.isArray(value)
			? value
			: (value as Readonly<{ channels: readonly Float32Array[] }>).channels;
		samples.push(...channels[0] ?? []);
	}
	return samples;
}

async function persistProjectAudio(store: ProjectStore): Promise<void> {
	await persistPcm(store, LANE_SOURCE_ID, LANE_SAMPLES);
	await persistPcm(store, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);
}

async function persistPcm(store: ProjectStore, sourceId: string, samples: readonly number[]): Promise<void> {
	const writer = await store.beginSourceWrite(sourceId, {
		name: `${sourceId}.wav`,
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: 1,
	});
	await writer.write([Float32Array.from(samples)]);
	await writer.commit();
}

function audioAssetDigest(samples: readonly number[]): string {
	const bytes = Buffer.alloc(4 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	bytes.writeUInt32LE(samples.length, 0);
	for (const [index, sample] of samples.entries()) {
		bytes.writeFloatLE(sample, 4 + index * Float32Array.BYTES_PER_ELEMENT);
	}
	return createHash('sha256').update(bytes).digest('hex');
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
