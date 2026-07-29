/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	BlobReader,
	BlobWriter,
	TextReader,
	TextWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

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
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { PRODUCT_PROFILES } from '../src/common/products.js';

const NOW = '2026-07-29T12:00:00.000Z';
const FALLBACK_SOURCE_ID = 'rendered-fallback-source';
const FALLBACK_STORAGE_KEY = 'rendered-fallback-storage';
const FALLBACK_SAMPLES = [0.25, -0.5, 0.75, 0] as const;
const FALLBACK_DIGEST = audioAssetDigest(FALLBACK_SAMPLES);
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
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);

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
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);
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

test('Scape inspection rejects a fallback digest mismatch before evaluation or collision lookup', async () => {
	const sourceStore = memoryStore('scape-feature-inspection-mismatch-source');
	const project = featureProject('scape-feature-inspection-mismatch');
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);
	const exported = await exportScapeProject(project, sourceStore);
	assert.ok(exported.blob instanceof Blob);
	const mismatched = await rewriteFallbackDigest(exported.blob, 'f'.repeat(64));
	let evaluations = 0;
	let collisionReads = 0;

	await assert.rejects(
		() => inspectScapeProject(mismatched, {
			loadProject() {
				collisionReads += 1;
				return null;
			},
		}, {
			projectFeatureCompatibility: {
				evaluate() {
					evaluations += 1;
					return null;
				},
			},
		}),
		/rendered fallback.*SHA-256.*asset/iu,
	);
	assert.equal(evaluations, 0);
	assert.equal(collisionReads, 0);
});

test('Scape copy import rejects a fallback digest mismatch before transactional store access', async () => {
	const sourceStore = memoryStore('scape-feature-import-mismatch-source');
	const project = featureProject('scape-feature-import-mismatch');
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);
	const exported = await exportScapeProject(project, sourceStore);
	assert.ok(exported.blob instanceof Blob);
	const mismatched = await rewriteFallbackDigest(exported.blob, 'f'.repeat(64));
	const backingStore = memoryStore('scape-feature-import-mismatch-target');
	await backingStore.saveProject(createAudioEditorProjectV9({
		id: project.id,
		title: 'Existing mismatch target',
		now: NOW,
	}));
	await persistFallbackSource(backingStore, FALLBACK_SOURCE_ID, [1, 1, 1, 1]);
	const beforeProjects = await backingStore.listProjects();
	const beforeSources = await backingStore.listSources();
	const calls = {
		loadProject: 0,
		getSourceMetadata: 0,
		beginSourceWrite: 0,
		saveProject: 0,
	};
	const targetStore = new Proxy(backingStore, {
		get(target, property, receiver) {
			const value: unknown = Reflect.get(target, property, receiver);
			if (typeof value !== 'function') return value;
			if (typeof property === 'string' && Object.hasOwn(calls, property)) {
				const operation = property as keyof typeof calls;
				return (...args: unknown[]) => {
					calls[operation] += 1;
					return Reflect.apply(value, target, args);
				};
			}
			return value.bind(target);
		},
	});

	await assert.rejects(
		() => importScapeProject(mismatched, targetStore, { collision: 'copy' }),
		/rendered fallback.*SHA-256.*asset/iu,
	);
	assert.deepEqual(calls, {
		loadProject: 0,
		getSourceMetadata: 0,
		beginSourceWrite: 0,
		saveProject: 0,
	});
	assert.deepEqual(await backingStore.listProjects(), beforeProjects);
	assert.deepEqual(await backingStore.listSources(), beforeSources);
	assert.deepEqual(await storedSamples(backingStore, FALLBACK_SOURCE_ID), [1, 1, 1, 1]);
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
	await persistFallbackSource(sourceStore, FALLBACK_STORAGE_KEY, FALLBACK_SAMPLES);
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
	assert.equal(copiedFallback?.sha256, FALLBACK_DIGEST);
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
	fallbackDigest = FALLBACK_DIGEST,
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
					sha256: fallbackDigest,
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
		featureRequirements: {
			schemaVersion: 999,
			requirements: [{
				disposition: 'rendered-fallback',
				fallback: { kind: 'future', sourceId: 'missing', sha256: 'not-a-digest' },
			}],
		},
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

function audioAssetDigest(samples: readonly number[]): string {
	const bytes = Buffer.alloc(4 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	bytes.writeUInt32LE(samples.length, 0);
	for (const [index, sample] of samples.entries()) {
		bytes.writeFloatLE(sample, 4 + index * Float32Array.BYTES_PER_ELEMENT);
	}
	return createHash('sha256').update(bytes).digest('hex');
}

async function rewriteFallbackDigest(blob: Blob, sha256: string): Promise<Blob> {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	try {
		const entries = (await reader.getEntries()).map(scapeFixtureEntry);
		const projectEntry = entries.find(({ filename }) => filename === 'project.json');
		const manifestEntry = entries.find(({ filename }) => filename === 'manifest.json');
		assert.ok(projectEntry);
		assert.ok(manifestEntry);
		const project = JSON.parse(await projectEntry.getData(new TextWriter())) as AudioEditorProjectV9;
		const fallback = project.featureRequirements.requirements.find(
			(requirement) => requirement.disposition === 'rendered-fallback',
		)?.fallback;
		assert.ok(fallback);
		Reflect.set(fallback, 'sha256', sha256);
		const projectText = JSON.stringify(project);
		const projectBytes = new TextEncoder().encode(projectText);
		const manifest = JSON.parse(await manifestEntry.getData(new TextWriter())) as {
			project: { size: number; sha256: string };
		};
		manifest.project.size = projectBytes.byteLength;
		manifest.project.sha256 = createHash('sha256').update(projectBytes).digest('hex');
		const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
			level: 0,
			useWebWorkers: false,
			zip64: true,
		});
		for (const entry of entries) {
			if (entry.filename === 'project.json') {
				await writer.add(entry.filename, new TextReader(projectText), { level: 0, zip64: true });
			} else if (entry.filename === 'manifest.json') {
				await writer.add(entry.filename, new TextReader(JSON.stringify(manifest)), { level: 0, zip64: true });
			} else {
				const asset = await entry.getData(new BlobWriter());
				await writer.add(entry.filename, asset.stream(), { level: 0, zip64: true });
			}
		}
		return writer.close(undefined, { zip64: true });
	} finally {
		await reader.close();
	}
}

interface ScapeFixtureEntry {
	readonly filename: string;
	getData(writer: TextWriter): Promise<string>;
	getData(writer: BlobWriter): Promise<Blob>;
}

function scapeFixtureEntry(value: unknown): ScapeFixtureEntry {
	if (!value || typeof value !== 'object' || typeof Reflect.get(value, 'filename') !== 'string'
		|| typeof Reflect.get(value, 'getData') !== 'function') {
		throw new TypeError('Expected a Scape fixture file entry.');
	}
	return value as ScapeFixtureEntry;
}
