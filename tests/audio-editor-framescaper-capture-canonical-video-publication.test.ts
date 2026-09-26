/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	publishFramescaperCaptureCanonicalAsset,
	type FramescaperCaptureCanonicalStore,
	type FramescaperCaptureVideoProbeResult,
} from '../src/common/editor/controller/capture/internal/framescaper-capture-canonical-assets.ts';
import { createFramescaperCaptureDurableSessionCoordinator } from
	'../src/common/editor/controller/capture/internal/framescaper-capture-durable-session.ts';
import { createFramescaperCaptureAssetStreams } from
	'../src/common/editor/controller/capture/internal/framescaper-capture-stream-timing.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';

const PROJECT_ID = 'canonical-video-publication-project';
const SOURCE_ID = 'canonical-video-publication-source';
const VIDEO_BYTES = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4);
const VIDEO_PROBE: FramescaperCaptureVideoProbeResult = Object.freeze({
	backend: 'canonical-video-publication-test',
	nominalRate: { num: 2, den: 1 },
	timing: {
		timescale: 1_000,
		presentationTicks: [0n, 500n],
		finalFrameDurationTicks: 500n,
	},
	width: 640,
	height: 480,
});

test('a failed video probe rolls back its committed body and a retry publishes body and timing', async (context) => {
	const fixture = await captureFixture(context);
	let sawCommittedBody = false;
	const failedOptions = {
		...fixture.options,
		probeVideo: async (retained: Blob) => {
			assert.deepEqual(new Uint8Array(await retained.arrayBuffer()), VIDEO_BYTES);
			sawCommittedBody = Boolean(await fixture.store.getMediaAssetMetadata(SOURCE_ID));
			throw new Error('video timing probe failed after body commit');
		},
	};
	await assert.rejects(
		publishFramescaperCaptureCanonicalAsset(
			failedOptions, fixture.manifest, fixture.streamManifest, fixture.stream, 48_000, null, 'publish',
		),
		/video timing probe failed after body commit/u,
	);
	assert.equal(sawCommittedBody, true);
	assert.equal(await fixture.store.getMediaAssetMetadata(SOURCE_ID), null, 'failed probe must remove its owned body');

	const published = await fixture.publish();
	assert.equal(published.source.kind, 'video');
	assert.ok(await fixture.store.getMediaAssetMetadata(SOURCE_ID));
	const timing = published.source.timingAsset as Readonly<{ storageKey: string }>;
	assert.ok(await fixture.store.getMediaAssetMetadata(timing.storageKey));
	assert.equal(await published.discardIfCurrent(), true);
	assert.equal(await fixture.store.getMediaAssetMetadata(SOURCE_ID), null);
	assert.equal(await fixture.store.getMediaAssetMetadata(timing.storageKey), null);
});

test('reconciliation refuses a missing timing asset without discarding a retained video body', async (context) => {
	const fixture = await captureFixture(context);
	const published = await fixture.publish();
	const timing = published.source.timingAsset as Readonly<{ storageKey: string }>;
	const missingTimingStore: FramescaperCaptureCanonicalStore = {
		...fixture.options.store,
		async getMediaAssetMetadata(key) {
			return key === timing.storageKey ? null : fixture.store.getMediaAssetMetadata(key);
		},
	};
	await assert.rejects(
		publishFramescaperCaptureCanonicalAsset(
			{ ...fixture.options, store: missingTimingStore },
			fixture.manifest, fixture.streamManifest, fixture.stream, 48_000, null, 'reconcile-only',
		),
		/immutable capture timing asset is missing/u,
	);
	assert.ok(await fixture.store.getMediaAssetMetadata(SOURCE_ID), 'reconciliation cannot discard the prior body');
	const reconciled = await fixture.publish('reconcile-only');
	assert.deepEqual(reconciled.source.timingAsset, timing);
	assert.equal(await reconciled.discardIfCurrent(), true, 'reconciliation borrows the original publication');
	assert.ok(await fixture.store.getMediaAssetMetadata(SOURCE_ID));
	assert.equal(await published.discardIfCurrent(), true);
});

async function captureFixture(context: TestContext) {
	const store = createFramescaperProjectStore(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		indexedDB: null,
		preferOpfs: false,
	});
	context.after(async () => {
		await store.clear();
		await store.close();
	});
	const encodedSpools = store.encodedCaptureSpoolRepository;
	const rawPcmSpools = store.rawPcmSpoolRepository;
	const manifests = store.framescaperCaptureManifestRepository;
	assert.ok(encodedSpools);
	assert.ok(rawPcmSpools);
	assert.ok(manifests);
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools, rawPcmSpools, manifests, now: () => 100,
	});
	const session = await coordinator.create({
		sessionId: 'canonical-video-publication-session',
		generation: 1,
		projectFence: {
			schemaFamily: 'framescaper', schemaVersion: 1, projectId: PROJECT_ID,
			baseRevision: 1, baseSha256: 'ab'.repeat(32),
		},
		origin: { sequenceId: 'main-sequence', playheadMicroseconds: 0, destination: 'timeline' },
		monotonicOriginMicroseconds: 0,
		streams: [{
			kind: 'encoded-media', role: 'camera', required: true,
			streamId: 'camera-stream', spoolId: 'camera-spool', sourceId: SOURCE_ID,
			mimeType: 'video/webm',
		}],
	});
	for (const [sequence, bytes] of [VIDEO_BYTES.slice(0, 4), VIDEO_BYTES.slice(4)].entries()) {
		await session.append({
			kind: 'encoded-video', sessionId: session.manifest.sessionId, streamId: 'camera-stream', role: 'camera',
			sequence, presentationTimeUs: sequence * 500_000, durationUs: 500_000,
			receiptTimeMs: sequence, droppedBefore: { value: 0, confidence: 'exact' },
			byteLength: bytes.byteLength, bytes, mimeType: 'video/webm', keyFrame: sequence === 0,
		});
	}
	await session.seal();
	const manifest = session.manifest;
	const streamManifest = manifest.streams[0]!;
	const stream = createFramescaperCaptureAssetStreams(manifest, [], 48_000)[0]!;
	const options = { store: captureStore(store), encodedSpools, rawPcmSpools, probeVideo: () => VIDEO_PROBE };
	return {
		store, options, manifest, streamManifest, stream,
		publish: (mode: 'publish' | 'reconcile-only' = 'publish') => publishFramescaperCaptureCanonicalAsset(
			options, manifest, streamManifest, stream, 48_000, null, mode,
		),
	};
}

function captureStore(store: AudioEditorProjectStore): FramescaperCaptureCanonicalStore {
	return {
		getSourceMetadata: store.getSourceMetadata.bind(store),
		beginSourceWrite: store.beginSourceWrite.bind(store),
		discardSourceIfCurrent: store.discardSourceIfCurrent.bind(store),
		getMediaAssetMetadata: store.getMediaAssetMetadata.bind(store),
		beginMediaAssetWrite: store.beginMediaAssetWrite.bind(store),
		async loadMediaAsset(key, options) {
			const loaded = await store.loadMediaAsset(key, options);
			return loaded === null || loaded instanceof Blob
				? loaded
				: new Blob([await loaded.arrayBuffer()], { type: loaded.type });
		},
	};
}
