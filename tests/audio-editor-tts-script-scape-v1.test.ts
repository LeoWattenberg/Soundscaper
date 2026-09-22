/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createAssistanceTtsScriptBodyPublicationV1 } from
	'../src/common/editor/assistance/tts-script-body-publication-v1.ts';
import { ASSISTANCE_TTS_SCRIPT_SCAPE_ENCODING_V1, ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1 } from
	'../src/common/editor/assistance/tts-script-scape-asset-extension-v1.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { collectProjectSourceIds, collectProjectStorageKeys } from
	'../src/common/editor/retention.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { canonicalMediaContentBlob } from '../src/common/editor/storage/media-content-digest.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { prepareFramescaperDesktopPublicationBodies } from
	'../src/framescaper/desktop-project-library-body-transfer.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';

const SOURCE_ID = 'generated-tts-audio';
const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = 'cd'.repeat(32);
const NOW = '2026-09-22T00:00:00.000Z';
const PCM = Object.freeze([0.125, -0.25, 0.5, -0.75]);

function publication() {
	return createAssistanceTtsScriptBodyPublicationV1({
		assetId: 'tts-script-one', text: 'Welcome to Soundscaper.', language: 'en-US',
		voiceId: 'en_US-lessac-medium', speed: 1.15,
		source: { sourceId: SOURCE_ID, sourceSha256: SOURCE_SHA256,
			sourceStartFrame: 0, sourceEndFrame: PCM.length },
		model: { modelId: 'piper-en-us-lessac-medium', modelVersion: '1.0.0',
			artifactSha256s: [MODEL_SHA256] },
		recipe: { id: 'text-to-speech', version: 1 },
	});
}

function source() {
	return createAudioSource({
		id: SOURCE_ID, name: 'Generated speech', storageKey: SOURCE_ID,
		contentSha256: SOURCE_SHA256, frameCount: PCM.length, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
}

function memoryStore(context: TestContext, label: string) {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false,
		databaseName: `${label}-${String(Date.now())}-${String(Math.random())}` });
	context.after(async () => { await store.close(); });
	return store;
}

async function seed(store: ReturnType<typeof memoryStore>, result: ReturnType<typeof publication>) {
	const writer = await store.beginSourceWrite(SOURCE_ID, {
		name: 'tts.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	await writer.write([Float32Array.from(PCM)]);
	await writer.commit();
	await store.writeMediaAsset(result.reference.body.storageKey,
		new Blob([Uint8Array.from(result.bytes).buffer], { type: result.reference.body.mimeType }), {
			name: `${result.reference.body.sha256}.json`,
			mimeType: result.reference.body.mimeType,
			kind: ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1,
			encoding: ASSISTANCE_TTS_SCRIPT_SCAPE_ENCODING_V1,
		});
}

test('Soundscaper .scape round-trips source-bound TTS script and generation settings', async (context) => {
	const result = publication();
	const sender = memoryStore(context, 'soundscaper-tts-sender');
	const recipient = memoryStore(context, 'soundscaper-tts-recipient');
	const project = createSoundscaperProject({ id: 's30-tts', title: 'Speech', now: NOW,
		sources: [source()], assistanceAssets: [result.reference] } as never);
	await seed(sender, result);
	const runtime = createSoundscaperScapeNativeRuntime();
	const exported = await runtime.exportScapeProject(project, sender as never);
	const descriptor = exported.manifest.assets.find(
		({ kind }) => kind === ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1)!;
	assert.equal(descriptor.sourceId, result.reference.body.storageKey);
	assert.equal(descriptor.encoding, ASSISTANCE_TTS_SCRIPT_SCAPE_ENCODING_V1);
	const imported = await runtime.importScapeProject(exported.blob!, recipient as never);
	assert.deepEqual((imported.project as typeof project).assistanceAssets, project.assistanceAssets);
	const stored = await recipient.loadMediaAsset(result.reference.body.storageKey);
	assert.ok(stored);
	assert.deepEqual(JSON.parse(await canonicalMediaContentBlob(stored).text()), result.body);
});

test('a TTS script retains its generated source and immutable body without a timeline clip', () => {
	const result = publication();
	const project = createSoundscaperProject({ id: 's30-tts-retention', title: 'Speech', now: NOW,
		sources: [source()], assistanceAssets: [result.reference] } as never);
	assert.equal(collectProjectSourceIds(project).has(SOURCE_ID), true);
	assert.equal(collectProjectStorageKeys(project).has(result.reference.body.storageKey), true);
});

test('Framescaper .scape collision rebinds TTS script body and source together', async (context) => {
	const result = publication();
	const sender = memoryStore(context, 'framescaper-tts-sender');
	const recipient = memoryStore(context, 'framescaper-tts-recipient');
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'f31-tts', title: 'Speech', now: NOW,
		sources: [source()], assistanceAssets: [result.reference],
	} as never);
	await seed(sender, result);
	const conflict = await recipient.beginSourceWrite(SOURCE_ID, {
		name: 'existing.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	await conflict.write([Float32Array.from([1])]);
	await conflict.commit();
	const runtime = createFramescaperScapeNativeRuntime(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const exported = await runtime.exportScapeProject(project, sender);
	const imported = await runtime.importScapeProject(exported.blob!, recipient);
	const held = imported.project as typeof project;
	const rebound = held.assistanceAssets[0]!;
	assert.equal(rebound.kind, 'tts-script-v1');
	assert.notEqual(rebound.sourceId, SOURCE_ID);
	assert.notEqual(rebound.body.storageKey, result.reference.body.storageKey);
	assert.equal(rebound.sourceSha256, SOURCE_SHA256);
	const stored = await recipient.loadMediaAsset(rebound.body.storageKey);
	assert.ok(stored);
	const body = JSON.parse(await canonicalMediaContentBlob(stored).text());
	assert.equal(body.sourceId, rebound.sourceId);
	assert.equal(body.text, result.body.text);
	assert.equal(body.voiceId, result.body.voiceId);
	assert.equal(body.speed, result.body.speed);
	assert.equal(body.modelId, result.body.modelId);
	assert.equal(body.modelVersion, result.body.modelVersion);
	assert.deepEqual(body.artifactSha256s, result.body.artifactSha256s);
	assert.deepEqual(body.recipe, result.body.recipe);
});

test('Framescaper desktop handoff prepares the authenticated TTS script body', async (context) => {
	const result = publication();
	const store = memoryStore(context, 'framescaper-tts-handoff');
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'f31-tts-handoff', title: 'Speech', now: NOW,
		sources: [source()], assistanceAssets: [result.reference],
	} as never);
	await seed(store, result);
	const prepared = await prepareFramescaperDesktopPublicationBodies(
		project, 'ef'.repeat(32), store);
	const script = prepared.find(({ descriptor }) => descriptor.kind === ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1);
	assert.ok(script);
	assert.equal(script.descriptor.storageKey, result.reference.body.storageKey);
	assert.deepEqual(new Uint8Array(await script.blob!.arrayBuffer()), result.bytes);
});
