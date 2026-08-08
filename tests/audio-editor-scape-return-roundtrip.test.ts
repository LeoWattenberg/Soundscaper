/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { evaluateProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { PRODUCT_PROFILES } from '../src/common/products.js';

const NOW = '2026-08-08T15:00:00.000Z';
const PROJECT_ID = 'scape-return-roundtrip';
const TARGET_TRACK_ID = 'saturated-lane-track';
const LANE_SOURCE_ID = 'canonical-lane-source';
const FALLBACK_SOURCE_ID = 'rendered-track-source';
const LANE_SAMPLES = [0.5, -0.5, 0.25, -0.25] as const;
const FALLBACK_SAMPLES = [0.125, -0.75, 1, 0] as const;
const TRACK_EFFECTS = [{
	id: 'foreign-fx', type: 'com.example.saturator', enabled: true, params: { drive: 0.5 },
}] as const;

type ProjectStore = ReturnType<typeof createProjectStore>;

interface ScapeImportResult {
	readonly project: AudioEditorProjectV9;
	readonly readOnly: boolean;
	readonly collision: 'copy' | 'replace' | null;
}

test('a portable Scape roundtrip returns owned PCM and its track fallback to a natively editable sender', async (context) => {
	const sender = memoryStore(context, 'scape-return-sender');
	const recipient = memoryStore(context, 'scape-return-recipient');
	const home = memoryStore(context, 'scape-return-home');
	const project = trackFallbackProject();
	await persistPcm(sender, LANE_SOURCE_ID, LANE_SAMPLES);
	await persistPcm(sender, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);

	const outbound = await exportScapeProject(project, sender);
	const outboundDigests = assetDigests(outbound);
	assert.deepEqual(outboundDigests, [
		audioAssetDigest(LANE_SAMPLES), audioAssetDigest(FALLBACK_SAMPLES),
	].sort());

	const delivered = await importScapeProject(outbound.blob, recipient) as ScapeImportResult;
	assert.equal(delivered.readOnly, false);
	const deliveredReport = evaluateProjectFeatureRequirements(
		delivered.project.featureRequirements,
		{ ...productAvailability('framescaper'), ...projectStructures(delivered.project) },
	);
	assert.equal(deliveredReport.compatible, false, 'the recipient must treat the requirement as unavailable');
	assert.equal(deliveredReport.items[0]?.availability, 'unavailable');
	assert.equal(deliveredReport.items[0]?.disposition, 'rendered-fallback');
	assert.equal(deliveredReport.items[0]?.fallback?.role, 'audio-track-render-v1');

	const reopenedValue = await recipient.loadProject(PROJECT_ID);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as unknown as AudioEditorProjectV9;
	assert.deepEqual(reopened.featureRequirements, project.featureRequirements);
	assert.deepEqual(reopened.tracks[0]?.effects, [...TRACK_EFFECTS]);

	const returning = await exportScapeProject(reopened, recipient);
	assert.deepEqual(assetDigests(returning), outboundDigests,
		'the read-only recipient must return the exact portable bodies it received');

	const returned = await importScapeProject(returning.blob, home) as ScapeImportResult;
	assert.equal(returned.readOnly, false);
	const returnedReport = evaluateProjectFeatureRequirements(
		returned.project.featureRequirements,
		{ ...productAvailability('soundscaper'), ...projectStructures(returned.project) },
	);
	assert.equal(returnedReport.compatible, true, 'the returning sender must reopen natively editable');
	assert.equal(returnedReport.items[0]?.availability, 'available');
	assert.equal(returnedReport.items[0]?.disposition, 'native');
	assert.equal(returnedReport.items[0]?.fallback?.role, 'audio-track-render-v1',
		'the retained fallback must survive the return to the capable product');

	assert.deepEqual(returned.project.featureRequirements, project.featureRequirements);
	assert.deepEqual(returned.project.tracks[0]?.effects, [...TRACK_EFFECTS],
		'the native effect payload must survive both legs untouched');
	assert.deepEqual(await storedSamples(home, LANE_SOURCE_ID), [...LANE_SAMPLES]);
	assert.deepEqual(await storedSamples(home, FALLBACK_SOURCE_ID), [...FALLBACK_SAMPLES]);

	const homeValue = await home.loadProject(PROJECT_ID);
	assert.ok(homeValue);
	const reopenedHome = homeValue as unknown as AudioEditorProjectV9;
	assert.deepEqual(reopenedHome.featureRequirements, project.featureRequirements);
	assert.deepEqual(reopenedHome.tracks[0]?.effects, [...TRACK_EFFECTS]);
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
		title: 'Portable return roundtrip',
		now: NOW,
		sampleRate: 48_000,
		sources: [laneSource, fallbackSource],
		clips: [laneClip],
		tracks: [createAudioTrackV9({
			id: TARGET_TRACK_ID,
			name: 'Saturated lane',
			clipIds: [laneClip.id],
			effects: [...TRACK_EFFECTS],
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
					sha256: audioAssetDigest(FALLBACK_SAMPLES),
					targetTrackId: TARGET_TRACK_ID,
				},
			}],
		},
	});
}

function productAvailability(productId: 'soundscaper' | 'framescaper'): Readonly<{
	knownFeatureIds: ReadonlySet<string>;
	availableFeatureIds: ReadonlySet<string>;
}> {
	const capabilities = PRODUCT_PROFILES[productId].capabilities as Readonly<Record<string, unknown>>;
	const entries = Object.entries(PROJECT_FEATURE_CAPABILITY_IDS);
	return {
		knownFeatureIds: new Set(entries.map(([, featureId]) => featureId)),
		availableFeatureIds: new Set(entries
			.filter(([key]) => capabilities[key] === true)
			.map(([, featureId]) => featureId)),
	};
}

function projectStructures(project: AudioEditorProjectV9): Readonly<{
	sources: AudioEditorProjectV9['sources'];
	clips: AudioEditorProjectV9['clips'];
	tracks: AudioEditorProjectV9['tracks'];
}> {
	return { sources: project.sources, clips: project.clips, tracks: project.tracks };
}

function assetDigests(exported: Readonly<{
	manifest: Readonly<{ assets: ReadonlyArray<Readonly<{ sha256: string }>> }>;
}>): string[] {
	return exported.manifest.assets.map(({ sha256 }) => sha256).sort();
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
