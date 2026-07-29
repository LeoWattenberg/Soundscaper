/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createScapeProjectFileService } from '../src/common/editor/controller/scape-project-file-service.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { evaluateProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioEditorProjectV9,
	createAudioSourceV9,
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { PRODUCT_PROFILES } from '../src/common/products.js';

const NOW = '2026-07-29T12:00:00.000Z';
const FALLBACK_SOURCE_ID = 'rendered-fallback-source';
const FALLBACK_STORAGE_KEY = 'rendered-fallback-storage';
const FALLBACK_DIGEST = 'ab'.repeat(32);
const NATIVE_FEATURE_ID = 'org.soundscaper.native.spectral-repair';
const FALLBACK_FEATURE_ID = 'org.soundscaper.native.linear-phase-eq';

type ProjectStore = ReturnType<typeof createProjectStore>;

interface ScapeImportResult {
	readonly project: AudioEditorProjectV9;
	readonly readOnly: boolean;
	readonly reason: string | null;
	readonly collision: 'copy' | 'replace' | null;
}

test('schema-V9 feature requirements retain their compatibility semantics through a Scape round trip', async () => {
	const sourceStore = memoryStore('scape-feature-roundtrip-source');
	const targetStore = memoryStore('scape-feature-roundtrip-target');
	const project = featureProject('scape-feature-roundtrip');
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, [0.25, -0.5, 0.75, 0]);

	const exported = await exportScapeProject(project, sourceStore);
	const imported = await importScapeProject(exported.blob, targetStore) as ScapeImportResult;
	const availability = {
		knownFeatureIds: new Set([NATIVE_FEATURE_ID, FALLBACK_FEATURE_ID]),
		availableFeatureIds: new Set([NATIVE_FEATURE_ID]),
	};

	assert.equal(imported.readOnly, false);
	assert.equal(imported.reason, null);
	assert.equal(imported.project.schemaVersion, 9);
	assert.deepEqual(imported.project.featureRequirements, project.featureRequirements);
	assert.equal(Object.isFrozen(imported.project.featureRequirements), true);
	assert.equal(Object.isFrozen(imported.project.featureRequirements.requirements), true);
	assert.deepEqual(
		evaluateProjectFeatureRequirements(imported.project.featureRequirements, availability),
		evaluateProjectFeatureRequirements(project.featureRequirements, availability),
	);
	assert.equal(validateAudioEditorProjectV9(imported.project), true);
	const reopenedValue = await targetStore.loadProject(project.id);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as unknown as AudioEditorProjectV9;
	assert.deepEqual(reopened.featureRequirements, project.featureRequirements);
	const reopenedSources = reopened.sources as readonly Readonly<Record<string, unknown>>[];
	assert.equal(String(reopenedSources[0]?.id), FALLBACK_SOURCE_ID);
	assert.equal(validateAudioEditorProjectV9(reopened), true);
});

test('pre-open Scape inspection reports selected-product feature compatibility', async () => {
	const sourceStore = memoryStore('scape-feature-inspection-source');
	const project = featureProject('scape-feature-inspection', FALLBACK_SOURCE_ID, {
		native: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		fallback: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
	});
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, [0.25, -0.5, 0.75, 0]);
	const exported = await exportScapeProject(project, sourceStore);
	assert.ok(exported.blob instanceof Blob);
	const service = createScapeProjectFileService({
		lifetime: new EditorControllerLifetime(),
		store: null,
		productCapabilities: PRODUCT_PROFILES.soundscaper.capabilities,
		openScape: () => { throw new Error('Inspection must not open the archive.'); },
	});

	const inspected = await service.inspectScape(exported.blob, {
		projectFeatureCompatibility: {
			evaluate() {
				throw new Error('Caller compatibility evaluators must not replace the selected product.');
			},
		},
	});
	const report = inspected.featureRequirementsCompatibility;
	assert.ok(report);
	assert.deepEqual(report.items.map(({ availability }) => availability), ['available', 'unavailable']);
	assert.deepEqual(report.counts, { available: 1, unavailable: 1, unknown: 0 });
	assert.equal(report.compatible, false);
	assert.equal(Object.isFrozen(report), true);
	assert.equal(Object.isFrozen(report.items), true);
});

test('pre-open Scape inspection leaves future project feature requirements opaque', async () => {
	const archive = await futureProjectArchive();
	const service = createScapeProjectFileService({
		lifetime: new EditorControllerLifetime(),
		store: null,
		productCapabilities: PRODUCT_PROFILES.soundscaper.capabilities,
		openScape: () => { throw new Error('Inspection must not open the archive.'); },
	});

	const inspected = await service.inspectScape(archive);

	assert.equal(inspected.schemaVersion, 10);
	assert.equal(inspected.readOnly, true);
	assert.equal(inspected.featureRequirementsCompatibility, null);
});

test('Scape copy import admits collisions against destination IDs and remaps rendered fallbacks', async () => {
	const sourceStore = memoryStore('scape-feature-copy-source');
	const targetStore = memoryStore('scape-feature-copy-target');
	const project = featureProject('scape-feature-collision', FALLBACK_STORAGE_KEY);
	await persistFallbackSource(sourceStore, FALLBACK_STORAGE_KEY, [0.25, -0.5, 0.75, 0]);
	await targetStore.saveProject(createAudioEditorProjectV9({
		id: project.id,
		title: 'Existing project',
		now: NOW,
	}));
	await persistFallbackSource(targetStore, FALLBACK_SOURCE_ID, [1, 1, 1, 1]);
	const exported = await exportScapeProject(project, sourceStore);

	const copied = await importScapeProject(exported.blob, targetStore, {
		collision: 'copy',
	}) as ScapeImportResult;
	const copiedSources = copied.project.sources;
	assert.ok(Array.isArray(copiedSources));
	const copiedSource = copiedSources[0];
	assert.ok(copiedSource && typeof copiedSource === 'object');
	const copiedSourceId = String(Reflect.get(copiedSource, 'id'));
	const copiedFallback = copied.project.featureRequirements.requirements.find(
		(requirement) => requirement.disposition === 'rendered-fallback',
	)?.fallback;

	assert.equal(copied.collision, 'copy');
	assert.notEqual(copied.project.id, project.id);
	assert.notEqual(copiedSourceId, FALLBACK_SOURCE_ID);
	assert.equal(copiedFallback?.sourceId, copiedSourceId);
	assert.equal(Object.isFrozen(copied.project.featureRequirements), true);
	assert.ok(await targetStore.getSourceMetadata(FALLBACK_SOURCE_ID));
	assert.ok(await targetStore.getSourceMetadata(copiedSourceId));
	assert.deepEqual(await storedSamples(targetStore, FALLBACK_SOURCE_ID), [1, 1, 1, 1]);
	assert.deepEqual(await storedSamples(targetStore, copiedSourceId), [0.25, -0.5, 0.75, 0]);
	assert.equal(validateAudioEditorProjectV9(copied.project), true);
	const reopenedValue = await targetStore.loadProject(copied.project.id);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as unknown as AudioEditorProjectV9;
	assert.equal(reopened.featureRequirements.requirements[1]?.fallback?.sourceId, copiedSourceId);
	assert.equal(validateAudioEditorProjectV9(reopened), true);
});

function featureProject(
	id: string,
	storageKey = FALLBACK_SOURCE_ID,
	featureIds = { native: NATIVE_FEATURE_ID, fallback: FALLBACK_FEATURE_ID },
): AudioEditorProjectV9 {
	const source = createAudioSourceV9({
		id: FALLBACK_SOURCE_ID,
		storageKey,
		name: 'Rendered fallback.wav',
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	});
	return createAudioEditorProjectV9({
		id,
		title: 'Feature requirements project',
		now: NOW,
		sources: [source],
		featureRequirements: {
			schemaVersion: 1,
			requirements: [{
				id: 'native-spectral-repair',
				featureId: featureIds.native,
				displayName: 'Spectral repair',
				disposition: 'bypass',
				fallback: null,
			}, {
				id: 'fallback-linear-phase-eq',
				featureId: featureIds.fallback,
				displayName: 'Linear phase EQ',
				disposition: 'rendered-fallback',
				fallback: {
					kind: 'audio',
					sourceId: FALLBACK_SOURCE_ID,
					sha256: FALLBACK_DIGEST,
				},
			}],
		},
	});
}

function memoryStore(prefix: string): ProjectStore {
	return createProjectStore({
		indexedDB: null,
		databaseName: `${prefix}-${String(Date.now())}-${String(Math.random())}`,
	});
}

async function persistFallbackSource(
	store: ProjectStore,
	sourceId: string,
	samples: readonly number[],
): Promise<void> {
	const writer = await store.beginSourceWrite(sourceId, {
		name: 'Rendered fallback.wav',
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: 1,
	});
	await writer.write([Float32Array.from(samples)]);
	await writer.commit();
}

async function storedSamples(store: ProjectStore, sourceId: string): Promise<number[]> {
	const samples: number[] = [];
	for await (const chunk of store.readSourceChunks(sourceId)) {
		samples.push(...chunk.channels[0]);
	}
	return samples;
}

async function futureProjectArchive(): Promise<Blob> {
	const projectText = JSON.stringify({
		schemaVersion: 10,
		id: 'future-feature-project',
		title: 'Future feature project',
		sources: [],
		featureRequirements: null,
	});
	const projectBytes = new TextEncoder().encode(projectText);
	const manifest = {
		format: 'scape-project',
		formatVersion: 1,
		project: {
			entry: 'project.json',
			mimeType: 'application/json',
			schemaVersion: 10,
			size: projectBytes.byteLength,
			sha256: createHash('sha256').update(projectBytes).digest('hex'),
		},
		assets: [],
	};
	const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
		level: 0,
		useWebWorkers: false,
		zip64: true,
	});
	await writer.add('project.json', new TextReader(projectText), { level: 0, zip64: true });
	await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)), { level: 0, zip64: true });
	return writer.close(undefined, { zip64: true });
}
