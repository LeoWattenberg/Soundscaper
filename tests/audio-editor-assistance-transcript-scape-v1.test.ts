/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	BlobReader,
	BlobWriter,
	TextReader,
	TextWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import {
	ASSISTANCE_TRANSCRIPT_SCAPE_ENCODING_V1,
	ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1,
} from '../src/common/editor/assistance/transcript-scape-asset-extension-v1.ts';
import {
	createAssistanceTranscriptBodyPublicationV1,
} from '../src/common/editor/assistance/transcript-body-publication-v1.ts';
import { createAssistanceTranscript } from '../src/common/editor/assistance/transcript.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { canonicalMediaContentBlob } from '../src/common/editor/storage/media-content-digest.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import {
	createSoundscaperProject,
} from '../src/soundscaper/editor-project.ts';
import {
	createSoundscaperScapeNativeRuntime,
	type SoundscaperScapeNativeStore,
} from '../src/soundscaper/editor-scape-native.ts';

const SOURCE_ID = 'dialogue-source';
const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = 'cd'.repeat(32);
const NOW = '2026-08-26T00:00:00.000Z';
const PCM = Object.freeze([0.125, -0.25, 0.5, -0.75]);

type Store = ReturnType<typeof createProjectStore>;

test('Soundscaper v1 `.scape` round-trips authenticated transcript and native plug-in bodies together', async (context) => {
	const transcript = publication('soundscaper');
	const nativeBytes = Uint8Array.from([0, 7, 13, 255]);
	const nativeSha256 = digestScapeBytes(nativeBytes);
	const nativeBodyId = `native-plugin-state:${nativeSha256}`;
	const senderNative = new Map([[nativeBodyId, nativeBytes]]);
	const recipientNative = new Map<string, Uint8Array>();
	const sender = soundscaperStore(context, 's30-sender', senderNative);
	const recipient = soundscaperStore(context, 's30-recipient', recipientNative);
	const project = createSoundscaperProject({
		id: 's30-transcript-scape', title: 'Portable transcript', now: NOW,
		sources: [source()], assistanceAssets: [transcript.reference],
		nativePluginStates: [{
			instanceId: 'native-delay', format: 'clap', stablePluginId: 'org.example.delay',
			binarySha256: 'ef'.repeat(32),
			stateBody: {
				kind: 'native-plugin-state', bodyId: nativeBodyId,
				byteLength: nativeBytes.byteLength, sha256: nativeSha256,
			},
			enabled: true, bypassed: false, continuity: 'live', latencySamples: 32,
		}],
	} as never);
	await seedProjectBodies(sender, transcript);

	const runtime = createSoundscaperScapeNativeRuntime();
	const exported = await runtime.exportScapeProject(project, sender);
	assert.deepEqual(exported.manifest.assets.map(({ kind }) => kind), [
		'audio', 'native-plugin-state', ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1,
	]);
	const descriptor = exported.manifest.assets.at(-1)!;
	assert.equal(descriptor.encoding, ASSISTANCE_TRANSCRIPT_SCAPE_ENCODING_V1);
	assert.equal(descriptor.sourceId, transcript.reference.body.storageKey);

	const imported = await runtime.importScapeProject(exported.blob!, recipient);
	assert.equal(imported.readOnly, false);
	assert.deepEqual((imported.project as typeof project).assistanceAssets, project.assistanceAssets);
	assert.deepEqual(recipientNative.get(nativeBodyId), nativeBytes);
	await assertTranscriptBody(recipient, transcript.reference.body.storageKey, SOURCE_ID);
	const returned = await runtime.exportScapeProject(imported.project, recipient);
	assert.deepEqual(assetAuthority(returned.manifest), assetAuthority(exported.manifest));
});

test('Framescaper v1 `.scape` collision import rebinds transcript JSON and its immutable reference together', async (context) => {
	const transcript = publication('framescaper');
	const sender = memoryStore(context, 'f31-collision-sender');
	const recipient = memoryStore(context, 'f31-collision-recipient');
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'f31-transcript-scape', title: 'Portable transcript', now: NOW,
		sources: [source()], assistanceAssets: [transcript.reference],
	} as never);
	await seedProjectBodies(sender, transcript);
	await persistPcm(recipient, SOURCE_ID, [1]);

	const runtime = createFramescaperScapeNativeRuntime(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	);
	const exported = await runtime.exportScapeProject(project, sender);
	const imported = await runtime.importScapeProject(exported.blob!, recipient);
	const held = imported.project as typeof project;
	const reboundSources = held.sources as readonly Readonly<{ kind: string; id: string }>[];
	const reboundSource = reboundSources.find(({ kind }) => kind === 'audio')!;
	const reboundAsset = (held.assistanceAssets as readonly (typeof transcript.reference)[])[0]!;
	assert.notEqual(reboundSource.id, SOURCE_ID);
	assert.equal(reboundAsset.sourceId, reboundSource.id);
	assert.notEqual(reboundAsset.body.storageKey, transcript.reference.body.storageKey);
	assert.equal(reboundAsset.sourceSha256, transcript.reference.sourceSha256);
	await assertTranscriptBody(recipient, reboundAsset.body.storageKey, reboundSource.id);
	assert.equal(await recipient.getMediaAssetMetadata(transcript.reference.body.storageKey), null);

	const returned = await runtime.exportScapeProject(held, recipient);
	const descriptor = returned.manifest.assets.find(
		({ kind }) => kind === ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1,
	)!;
	assert.equal(descriptor.sourceId, reboundAsset.body.storageKey);
	assert.equal(descriptor.sha256, reboundAsset.body.sha256);
});

test('both v1 families refuse missing and semantically corrupt transcript bodies', async (context) => {
	const transcript = publication('soundscaper');
	const missing = memoryStore(context, 'transcript-missing');
	await persistPcm(missing, SOURCE_ID, PCM);
	const soundscaper = createSoundscaperProject({
		id: 's30-missing-transcript', title: 'Missing transcript', now: NOW,
		sources: [source()], assistanceAssets: [transcript.reference],
	} as never);
	await assert.rejects(
		createSoundscaperScapeNativeRuntime().exportScapeProject(soundscaper, missing as never),
		/unavailable|metadata|missing/iu,
	);

	const wrongBody = createAssistanceTranscript({
		sourceId: 'different-source', sampleRate: 48_000, language: 'en', modelId: 'parakeet',
		segments: [{
			startFrame: 0, endFrame: 4, text: 'Hello', speaker: null,
			words: [{ text: 'Hello', startFrame: 0, endFrame: 4, confidence: 0.9 }],
		}],
	});
	const wrongBytes = new TextEncoder().encode(JSON.stringify(wrongBody));
	const wrongSha256 = digestScapeBytes(wrongBytes);
	const wrongReference = {
		...transcript.reference,
		body: {
			...transcript.reference.body,
			storageKey: `assistance-transcript-sha256:${wrongSha256}`,
			byteLength: wrongBytes.byteLength,
			sha256: wrongSha256,
		},
	};
	const corrupt = memoryStore(context, 'transcript-corrupt');
	await persistPcm(corrupt, SOURCE_ID, PCM);
	await persistTranscriptBody(corrupt, wrongReference.body, wrongBytes);
	const framescaper = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'f31-corrupt-transcript', title: 'Corrupt transcript', now: NOW,
		sources: [source()], assistanceAssets: [wrongReference],
	} as never);
	await assert.rejects(
		createFramescaperScapeNativeRuntime(FRAMESCAPER_PROJECT_RUNTIME_PROFILE)
			.exportScapeProject(framescaper, corrupt),
		/source identity|source ID|project reference/iu,
	);
});

test('a later corrupt archive entry rolls back an owned transcript-body import', async (context) => {
	const transcript = publication('framescaper');
	const sender = memoryStore(context, 'f31-rollback-sender');
	const recipient = memoryStore(context, 'f31-rollback-recipient');
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'f31-transcript-rollback', title: 'Rollback transcript', now: NOW,
		sources: [source()], assistanceAssets: [transcript.reference],
	} as never);
	await seedProjectBodies(sender, transcript);
	const runtime = createFramescaperScapeNativeRuntime(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	);
	const exported = await runtime.exportScapeProject(project, sender);
	const audio = exported.manifest.assets.find(({ kind }) => kind === 'audio')!;
	const corrupt = await corruptArchiveEntry(exported.blob!, audio.entry);

	await assert.rejects(runtime.importScapeProject(corrupt, recipient), /digest|SHA|verification/iu);
	assert.equal(await recipient.loadProject(project.id), null);
	assert.equal(await recipient.getMediaAssetMetadata(transcript.reference.body.storageKey), null);
});

function publication(schemaFamily: 'soundscaper' | 'framescaper') {
	return createAssistanceTranscriptBodyPublicationV1({
		assetId: 'transcript-dialogue',
		review: {
			kind: 'transcript', language: 'en',
			segments: [{
				startSeconds: 0, endSeconds: 4 / 48_000, text: 'Hello', speaker: null,
				words: [{
					text: 'Hello', startSeconds: 0, endSeconds: 4 / 48_000, confidence: 0.9,
				}],
			}],
		},
		selectedMedia: {
			selectionFence: {
				schemaFamily, schemaVersion: 1,
				projectId: `project-${schemaFamily}`, revision: 0,
				sequenceId: 'main-sequence', occurrenceIds: ['dialogue-clip'],
				sourceId: SOURCE_ID, sourceSha256: SOURCE_SHA256,
				sourceStartFrame: 0, sourceEndFrame: 4,
				linkMembershipSha256: '11'.repeat(32), timingAuthoritySha256: '22'.repeat(32),
			},
			sampleRate: 48_000, sourceVideoTimingSha256: null,
		},
		model: { modelId: 'parakeet', artifactSha256s: [MODEL_SHA256] },
		recipe: { id: 'speech-transcript', version: 1 },
	});
}

function source() {
	return createAudioSource({
		id: SOURCE_ID, name: 'Dialogue', storageKey: SOURCE_ID,
		contentSha256: SOURCE_SHA256, frameCount: PCM.length, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
}

async function seedProjectBodies(
	store: Store,
	transcript: ReturnType<typeof publication>,
): Promise<void> {
	await persistPcm(store, SOURCE_ID, PCM);
	await persistTranscriptBody(store, transcript.reference.body, transcript.bytes);
}

async function persistPcm(store: Store, sourceId: string, samples: readonly number[]): Promise<void> {
	const writer = await store.beginSourceWrite(sourceId, {
		name: `${sourceId}.wav`, mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	await writer.write([Float32Array.from(samples)]);
	await writer.commit();
}

async function persistTranscriptBody(
	store: Store,
	reference: Readonly<{ storageKey: string; mimeType: string; sha256: string }>,
	bytes: Uint8Array,
): Promise<void> {
	await store.writeMediaAsset(reference.storageKey, new Blob([Uint8Array.from(bytes).buffer], {
		type: reference.mimeType,
	}), {
		name: `${reference.sha256}.json`, mimeType: reference.mimeType,
		kind: ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1,
		encoding: ASSISTANCE_TRANSCRIPT_SCAPE_ENCODING_V1,
	});
}

async function assertTranscriptBody(store: Store, storageKey: string, sourceId: string): Promise<void> {
	const body = await store.loadMediaAsset(storageKey);
	assert.ok(body);
	assert.equal(JSON.parse(await canonicalMediaContentBlob(body).text()).sourceId, sourceId);
}

function memoryStore(context: TestContext, label: string): Store {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false,
		databaseName: `${label}-${String(Date.now())}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

function soundscaperStore(
	context: TestContext,
	label: string,
	bodies: Map<string, Uint8Array>,
): AudioEditorProjectStore & SoundscaperScapeNativeStore {
	const base = memoryStore(context, label);
	const extensions: SoundscaperScapeNativeStore = {
		getNativePluginStateBodyMetadata: (bodyId) => {
			const bytes = bodies.get(bodyId);
			return bytes ? { byteLength: bytes.byteLength, sha256: digestScapeBytes(bytes) } : null;
		},
		loadNativePluginStateBody: (bodyId) => {
			const bytes = bodies.get(bodyId);
			return bytes ? Uint8Array.from(bytes) : null;
		},
		persistNativePluginStateBody: (bytes, expected) => {
			const copy = Uint8Array.from(bytes);
			if (digestScapeBytes(copy) !== expected.sha256 || copy.byteLength !== expected.byteLength) {
				throw new Error('Test native-state persistence changed its identity.');
			}
			bodies.set(expected.bodyId, copy);
			return expected;
		},
	};
	return new Proxy(base as AudioEditorProjectStore & SoundscaperScapeNativeStore, {
		get(target, property) {
			if (Object.hasOwn(extensions, property)) {
				const value = Reflect.get(extensions, property);
				return typeof value === 'function' ? value.bind(extensions) : value;
			}
			const value = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

function assetAuthority(manifest: Readonly<{ readonly assets: readonly Readonly<{
	readonly sourceId: string; readonly kind: string; readonly entry: string;
	readonly encoding: string; readonly mimeType?: string; readonly size: number; readonly sha256: string;
}>[] }>) {
	return manifest.assets.map(({ sourceId, kind, entry, encoding, mimeType, size, sha256 }) => ({
		sourceId, kind, entry, encoding, mimeType, size, sha256,
	}));
}

async function corruptArchiveEntry(blob: Blob, filename: string): Promise<Blob> {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const contents = await Promise.all(entries.map(async (entry) => {
		if (!('getData' in entry) || typeof entry.getData !== 'function') {
			throw new Error(`Unexpected directory entry ${entry.filename}.`);
		}
		if (entry.filename === 'project.json' || entry.filename === 'manifest.json') return {
			filename: entry.filename,
			value: await entry.getData(new TextWriter()),
		};
		const value = await entry.getData(new BlobWriter());
		if (entry.filename !== filename) return { filename: entry.filename, value };
		const bytes = new Uint8Array(await value.arrayBuffer());
		bytes[bytes.byteLength - 1] = (bytes[bytes.byteLength - 1] ?? 0) ^ 0xff;
		return { filename: entry.filename, value: new Blob([bytes.buffer]) };
	}));
	await reader.close();
	const output = new BlobWriter('application/vnd.soundscaper.scape+zip');
	const writer = new ZipWriter(output, { zip64: true, useWebWorkers: false, level: 0 });
	for (const content of contents) await writer.add(
		content.filename,
		typeof content.value === 'string' ? new TextReader(content.value) : content.value.stream(),
		{ zip64: true, level: 0 },
	);
	return writer.close(undefined, { zip64: true });
}
