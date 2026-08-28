/* SPDX-License-Identifier: AGPL-3.0-only */

import { type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createAudioSource,
} from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	createBaselineAudioEditorProject as createCurrentAudioEditorProject,
	inspectBaselineScapeProject as inspectScapeProject,
} from './helpers/baseline-scape-runtime.ts';

const NOW = '2026-07-29T12:00:00.000Z';
const FALLBACK_SOURCE_ID = 'rendered-fallback-source';
const FALLBACK_SAMPLES = [0.25, -0.5, 0.75, 0] as const;
const FALLBACK_DIGEST = audioAssetDigest(FALLBACK_SAMPLES);
const FALLBACK_FEATURE_ID = 'org.soundscaper.native.linear-phase-eq';

type ProjectStore = ReturnType<typeof createProjectStore>;

test('Scape export aborts an unpublished destination when a rendered fallback digest mismatches', async () => {
	const sourceStore = memoryStore('scape-feature-export-mismatch');
	const project = featureProject('scape-feature-export-mismatch', 'f'.repeat(64));
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);
	let writes = 0;
	let closes = 0;
	let aborts = 0;
	const writable = new WritableStream<Uint8Array>({
		write() { writes += 1; },
		close() { closes += 1; },
		abort() { aborts += 1; },
	});

	await assert.rejects(
		() => exportScapeProject(project, sourceStore, { writable }),
		(error: unknown) => {
			const primary = error instanceof AggregateError ? error.errors[0] : error;
			assert.match(String(primary), /rendered fallback.*SHA-256.*asset/iu);
			return true;
		},
	);
	assert.ok(writes > 0);
	assert.equal(closes, 0);
	assert.equal(aborts, 1);
});

test('Scape export rejects a feature-requirements accessor without invoking it', async () => {
	const sourceStore = memoryStore('scape-feature-export-snapshot');
	const project = featureProject('scape-feature-export-snapshot');
	const admittedRequirements = project.featureRequirements;
	const driftedRequirements = {
		...admittedRequirements,
		requirements: admittedRequirements.requirements.map((requirement) => ({
			...requirement,
			fallback: requirement.fallback == null
				? null
				: { ...requirement.fallback, sha256: 'f'.repeat(64) },
		})),
	};
	let reads = 0;
	Object.defineProperty(project, 'featureRequirements', {
		enumerable: true,
		get() {
			reads += 1;
			return reads === 1 ? admittedRequirements : driftedRequirements;
		},
	});
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);

	await assert.rejects(
		() => exportScapeProject(project, sourceStore),
		/Project property featureRequirements accessors.*not supported/iu,
	);
	assert.equal(reads, 0);
});

test('Scape export rejects a project-level toJSON hook instead of bypassing its admitted snapshot', async () => {
	const project = featureProject('scape-feature-export-to-json');
	Reflect.set(project, 'toJSON', () => ({ ...project, featureRequirements: null }));

	await assert.rejects(
		() => exportScapeProject(project, memoryStore('scape-feature-export-to-json')),
		/toJSON hooks.*not supported/iu,
	);
});

test('Scape export rejects a source-identity accessor without invoking it', async () => {
	const sourceStore = memoryStore('scape-feature-export-source-snapshot');
	const project = featureProject('scape-feature-export-source-snapshot');
	const source = firstSource(project);
	let reads = 0;
	Object.defineProperty(source, 'id', {
		enumerable: true,
		get() {
			reads += 1;
			return reads === 1 ? FALLBACK_SOURCE_ID : 'drifted-source';
		},
	});
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);

	await assert.rejects(
		() => exportScapeProject(project, sourceStore),
		/Project source 1 property id accessors.*not supported/iu,
	);
	assert.equal(reads, 0);
});

test('Scape export rejects a source-level toJSON hook before it can rewrite source identity', async () => {
	const project = featureProject('scape-feature-export-source-to-json');
	const source = firstSource(project);
	let hookCalls = 0;
	Reflect.set(source, 'toJSON', () => {
		hookCalls += 1;
		return { ...source, id: 'drifted-source' };
	});

	await assert.rejects(
		() => exportScapeProject(project, memoryStore('scape-feature-export-source-to-json')),
		/Project source 1 toJSON hooks.*not supported/iu,
	);
	assert.equal(hookCalls, 0);
});

test('Scape export does not delegate source snapshotting to an input-controlled array map', async () => {
	const project = featureProject('scape-feature-export-source-map');
	const sources = project.sources as readonly Readonly<Record<string, unknown>>[];
	const source = firstSource(project);
	Reflect.set(source, 'toJSON', () => ({ ...source, id: 'drifted-source' }));
	let mapCalls = 0;
	Object.defineProperty(sources, 'map', {
		value() {
			mapCalls += 1;
			return [source];
		},
	});

	await assert.rejects(
		() => exportScapeProject(project, memoryStore('scape-feature-export-source-map')),
		/Project source 1 toJSON hooks.*not supported/iu,
	);
	assert.equal(mapCalls, 0);
});

test('Scape export rejects a non-primitive source kind before plan classification can drift', async () => {
	const project = featureProject('scape-feature-export-source-kind');
	Reflect.set(project, 'featureRequirements', { schemaVersion: 1, requirements: [] });
	Reflect.set(firstSource(project), 'kind', new String('video'));

	await assert.rejects(
		() => exportScapeProject(project, memoryStore('scape-feature-export-source-kind')),
		/Project source 1 kind must be audio or video/iu,
	);
});

test('Scape export serializes canonical primitive PCM geometry used by its asset plan', async () => {
	const sourceStore = memoryStore('scape-feature-export-source-geometry');
	const project = featureProject('scape-feature-export-source-geometry');
	const source = firstSource(project);
	const chunkFrames = Reflect.get(source, 'chunkFrames');
	assert.equal(typeof chunkFrames, 'number');
	Reflect.set(source, 'chunkFrames', {
		valueOf() { return chunkFrames; },
		toJSON() { return 0; },
	});
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);

	const exported = await exportScapeProject(project, sourceStore);
	assert.ok(exported.blob instanceof Blob);
	assert.equal((await inspectScapeProject(exported.blob)).id, project.id);
});

test('Scape export rejects a zero-frame source that the project schema cannot reopen', async () => {
	const project = featureProject('scape-feature-export-zero-frame-source');
	Reflect.set(firstSource(project), 'frameCount', 0);

	await assert.rejects(
		() => exportScapeProject(project, memoryStore('scape-feature-export-zero-frame-source')),
		/Project source 1 must contain at least one frame/iu,
	);
});

test('Scape export writes canonical audio kind when the maintained source omitted it', async () => {
	const sourceStore = memoryStore('scape-feature-export-source-kind-default');
	const project = featureProject('scape-feature-export-source-kind-default');
	Reflect.deleteProperty(firstSource(project), 'kind');
	await persistFallbackSource(sourceStore, FALLBACK_SOURCE_ID, FALLBACK_SAMPLES);

	const exported = await exportScapeProject(project, sourceStore);
	assert.ok(exported.blob instanceof Blob);
	assert.equal((await inspectScapeProject(exported.blob)).id, project.id);
});

test('Scape export rejects a whitespace-only source storage key before store access', async () => {
	const project = featureProject('scape-feature-export-source-storage-key');
	Reflect.set(firstSource(project), 'storageKey', '   ');

	await assert.rejects(
		() => exportScapeProject(project, memoryStore('scape-feature-export-source-storage-key')),
		/Storage key.*is required/iu,
	);
});

test('the unified Scape v1 baseline exports video media bodies', async () => {
	const project = createCurrentAudioEditorProject({
		id: 'scape-v1-video',
		title: 'Scape v1 video',
		now: NOW,
		sources: [{
			kind: 'video',
			id: 'video-source',
			storageKey: 'video-source',
			name: 'picture.mp4',
			mimeType: 'video/mp4',
			frameCount: 4,
			sampleRate: 48_000,
			width: 16,
			height: 16,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: null,
			hasAudio: false,
		}],
	});
	let mediaReads = 0;
	const backingStore = memoryStore('scape-v1-video');
	const store = new Proxy(backingStore, {
		get(target, property) {
			if (property === 'getMediaAssetMetadata') return () => {
				return { size: 1 };
			};
			if (property === 'loadMediaAsset') return () => {
				mediaReads += 1;
				return new Blob(['x']);
			};
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	const exported = await exportScapeProject(project, store);
	assert.equal(exported.manifest.formatVersion, 1);
	assert.equal(exported.manifest.assets[0]?.kind, 'video');
	assert.equal(mediaReads, 1);
});

function featureProject(id: string, fallbackDigest = FALLBACK_DIGEST): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: FALLBACK_SOURCE_ID,
		storageKey: FALLBACK_SOURCE_ID,
		name: 'Rendered fallback.wav',
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	});
	return createCurrentAudioEditorProject({
		id,
		title: 'Feature requirements project',
		now: NOW,
		sources: [source],
		featureRequirements: {
			schemaVersion: 1,
			requirements: [{
				id: 'fallback-linear-phase-eq',
				featureId: FALLBACK_FEATURE_ID,
				displayName: 'Linear phase EQ',
				disposition: 'rendered-fallback',
				fallback: { kind: 'audio', sourceId: FALLBACK_SOURCE_ID, sha256: fallbackDigest },
			}],
		},
	});
}

function firstSource(project: AudioEditorProjectCurrent): Readonly<Record<string, unknown>> {
	const source = (project.sources as readonly Readonly<Record<string, unknown>>[])[0];
	assert.ok(source);
	return source;
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

function audioAssetDigest(samples: readonly number[]): string {
	const bytes = Buffer.alloc(4 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	bytes.writeUInt32LE(samples.length, 0);
	for (const [index, sample] of samples.entries()) {
		bytes.writeFloatLE(sample, 4 + index * Float32Array.BYTES_PER_ELEMENT);
	}
	return createHash('sha256').update(bytes).digest('hex');
}
