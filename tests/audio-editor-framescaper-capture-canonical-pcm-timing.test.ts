/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	publishFramescaperCaptureCanonicalAsset,
	type FramescaperCaptureCanonicalStore,
} from '../src/common/editor/controller/framescaper-capture-canonical-assets.ts';
import { createFramescaperCaptureDurableSessionCoordinator } from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import { createFramescaperCaptureAssetStreams } from '../src/common/editor/controller/framescaper-capture-stream-timing.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

test('canonical PCM publication materializes an exact internal hole without shifting captured samples', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `capture-pcm-timing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
	});
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: store.encodedCaptureSpoolRepository,
		rawPcmSpools: store.rawPcmSpoolRepository,
		manifests: store.framescaperCaptureManifestRepository,
		now: () => 100,
	});
	const session = await coordinator.create({
		sessionId: 'capture-session', generation: 1,
		projectFence: { projectId: 'capture-project', baseRevision: 1, baseSha256: 'ab'.repeat(32) },
		origin: { sequenceId: 'main-sequence', playheadMicroseconds: 0, destination: 'timeline' },
		monotonicOriginMicroseconds: 0,
		streams: [{
			kind: 'raw-pcm', role: 'microphone', required: true,
			streamId: 'microphone-stream', spoolId: 'microphone-spool', sourceId: 'microphone-source',
			sampleRate: 8_000, channelCount: 2, chunkFrames: 8_000,
		}],
	});
	await session.append({
		kind: 'pcm-audio', sessionId: 'capture-session', streamId: 'microphone-stream',
		role: 'microphone', sequence: 0, presentationTimeUs: 100_000, durationUs: 250,
		receiptTimeMs: 0, droppedBefore: { value: 0, confidence: 'exact' },
		frameCount: 2, sampleRate: 8_000, channelCount: 2,
		samples: Float32Array.of(0.25, -0.25, 0.5, -0.5),
	});
	await session.append({
		kind: 'pcm-audio', sessionId: 'capture-session', streamId: 'microphone-stream',
		role: 'microphone', sequence: 1, presentationTimeUs: 100_625, durationUs: 250,
		receiptTimeMs: 1, droppedBefore: { value: 3, confidence: 'exact' },
		frameCount: 2, sampleRate: 8_000, channelCount: 2,
		samples: Float32Array.of(0.75, -0.75, 1, -1),
	});
	await session.seal();
	const manifest = session.manifest;
	const streamManifest = manifest.streams[0]!;
	const [stream] = createFramescaperCaptureAssetStreams(manifest, [], 48_000);
	assert.ok(stream);

	const publication = await publishFramescaperCaptureCanonicalAsset({
		store: canonicalStore(store),
		encodedSpools: store.encodedCaptureSpoolRepository,
		rawPcmSpools: store.rawPcmSpoolRepository,
		probeVideo: () => { throw new Error('PCM publication cannot probe video.'); },
	}, manifest, streamManifest, stream, 48_000, null, 'publish');

	assert.equal(stream.startOffsetFrames, 4_800);
	assert.equal(stream.presentationEndOffsetFrames, 4_842);
	assert.equal(stream.exactPresentationRange, '100000:100875');
	assert.equal(publication.timelineDurationFrames, 42);
	assert.equal(publication.source.frameCount, 7);
	assert.equal((await store.getSourceMetadata('microphone-source'))?.frameCount, 7);
	const channels: number[][] = [[], []];
	for await (const chunk of store.readSourceChunks('microphone-source')) {
		for (let channel = 0; channel < channels.length; channel += 1) {
			channels[channel]!.push(...chunk.channels[channel]!);
		}
	}
	assert.deepEqual(channels, [
		[0.25, 0.5, 0, 0, 0, 0.75, 1],
		[-0.25, -0.5, 0, 0, 0, -0.75, -1],
	]);
});

function canonicalStore(store: ReturnType<typeof createProjectStore>): FramescaperCaptureCanonicalStore {
	return {
		getSourceMetadata: store.getSourceMetadata.bind(store),
		beginSourceWrite: store.beginSourceWrite.bind(store),
		discardSourceIfCurrent: store.discardSourceIfCurrent.bind(store),
		getMediaAssetMetadata: store.getMediaAssetMetadata.bind(store),
		beginMediaAssetWrite: store.beginMediaAssetWrite.bind(store),
		async loadMediaAsset(sourceId, options) {
			const loaded = await store.loadMediaAsset(sourceId, options);
			if (!loaded) return null;
			return loaded instanceof Blob
				? loaded
				: new Blob([await loaded.arrayBuffer()], { type: loaded.type });
		},
	};
}
