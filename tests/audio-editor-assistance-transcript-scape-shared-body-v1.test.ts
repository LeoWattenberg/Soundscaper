/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	ASSISTANCE_TRANSCRIPT_SCAPE_ENCODING_V1,
	ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1,
} from '../src/common/editor/assistance/transcript-scape-asset-extension-v1.ts';
import {
	createAssistanceTranscriptBodyPublicationV1,
	type AssistanceSpeechRecognitionReviewSegmentV1,
} from '../src/common/editor/assistance/transcript-body-publication-v1.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';

const SOURCE_ID = 'dialogue-source';
const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = 'cd'.repeat(32);
const NOW = '2026-09-07T00:00:00.000Z';
const PCM = Object.freeze([0.125, -0.25, 0.5, -0.75, 0.25, -0.5, 0.75, -0.125, 0, 0, 0, 0]);
const SPEECH: readonly AssistanceSpeechRecognitionReviewSegmentV1[] = Object.freeze([{
	startSeconds: 0, endSeconds: 4 / 48_000, text: 'Hello', speaker: null,
	words: Object.freeze([{
		text: 'Hello', startSeconds: 0, endSeconds: 4 / 48_000, confidence: 0.9,
	}]),
}]);

type Store = ReturnType<typeof createProjectStore>;

test('`.scape` re-imports non-adjacent transcript assets that share one content-addressed body', async (context) => {
	const silentA = publication('transcript-dialogue-a', 0, 4, []);
	const speech = publication('transcript-dialogue-b', 4, 8, SPEECH);
	const silentC = publication('transcript-dialogue-c', 8, 12, []);
	assert.equal(silentA.reference.body.storageKey, silentC.reference.body.storageKey);
	assert.notEqual(speech.reference.body.storageKey, silentA.reference.body.storageKey);

	const sender = memoryStore(context, 'shared-body-sender');
	const recipient = memoryStore(context, 'shared-body-recipient');
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'f31-shared-transcript-body', title: 'Shared transcript body', now: NOW,
		sources: [source()],
		assistanceAssets: [silentA.reference, speech.reference, silentC.reference],
	} as never);
	await persistPcm(sender, SOURCE_ID, PCM);
	await persistTranscriptBody(sender, silentA.reference.body, silentA.bytes);
	await persistTranscriptBody(sender, speech.reference.body, speech.bytes);

	const runtime = createFramescaperScapeNativeRuntime(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const exported = await runtime.exportScapeProject(project, sender);
	assert.equal(
		exported.manifest.assets.filter(({ kind }) => kind === ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1).length,
		2,
	);

	const imported = await runtime.importScapeProject(exported.blob!, recipient);
	assert.equal(imported.readOnly, false);
	const held = imported.project as typeof project;
	const assets = held.assistanceAssets as readonly (typeof silentA.reference)[];
	assert.deepEqual(assets.map(({ id }) => id), [
		'transcript-dialogue-a', 'transcript-dialogue-b', 'transcript-dialogue-c',
	]);
	assert.equal(assets[0]!.body.storageKey, assets[2]!.body.storageKey);
	assert.notEqual(assets[1]!.body.storageKey, assets[0]!.body.storageKey);
	assert.deepEqual(assets.map(({ sourceStartFrame, sourceEndFrame }) => (
		[sourceStartFrame, sourceEndFrame]
	)), [[0, 4], [4, 8], [8, 12]]);
	assert.ok(await recipient.getMediaAssetMetadata(assets[0]!.body.storageKey));
	assert.ok(await recipient.getMediaAssetMetadata(assets[1]!.body.storageKey));
});

function publication(
	assetId: string,
	sourceStartFrame: number,
	sourceEndFrame: number,
	segments: readonly AssistanceSpeechRecognitionReviewSegmentV1[],
) {
	return createAssistanceTranscriptBodyPublicationV1({
		assetId,
		review: { kind: 'transcript', language: 'en', segments },
		selectedMedia: {
			selectionFence: {
				schemaFamily: 'framescaper', schemaVersion: 1,
				projectId: 'project-framescaper', revision: 0,
				sequenceId: 'main-sequence', occurrenceIds: ['dialogue-clip'],
				sourceId: SOURCE_ID, sourceSha256: SOURCE_SHA256,
				sourceStartFrame, sourceEndFrame,
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

function memoryStore(context: TestContext, label: string): Store {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false,
		databaseName: `${label}-${String(Date.now())}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}
