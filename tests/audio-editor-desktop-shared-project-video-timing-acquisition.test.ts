/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { createVideoClipV9, createVideoSourceV9 } from '../src/common/editor/project-v9.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	acquireDesktopSharedProjectMedia,
	DESKTOP_SHARED_VIDEO_ENCODING,
	DESKTOP_SHARED_VIDEO_TIMING_ENCODING,
	type DesktopSharedManagedSourceDescriptor,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';
import {
	createVideoTimingAssetPublication,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';

const SAMPLE_RATE = 48_000;

test('video timing handoff publishes exact bytes and rolls back the original when timing is corrupt', async (context) => {
	const videoBytes = Uint8Array.of(1, 3, 5, 7, 9);
	const videoSha256 = digest(videoBytes);
	const timing = createVideoTimingAssetPublication(videoSha256, {
		timescale: 90_000,
		presentationTicks: [0n, 3_003n, 6_007n],
		finalFrameDurationTicks: 3_002n,
	});
	const video = createVideoSourceV9({
		id: 'timed-video', storageKey: 'timed-video-storage', name: 'timed.mp4', mimeType: 'video/mp4',
		frameCount: 4_805, sampleRate: SAMPLE_RATE, width: 1_920, height: 1_080,
		frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const clip = createVideoClipV9({
		id: 'timed-video-clip', sourceId: video.id, durationFrames: video.frameCount,
		binItemId: 'timed-video-item',
	});
	const project = createCurrentAudioEditorProject({
		id: 'timed-video-project', title: 'Timed video', revision: 2,
		now: '2026-08-01T12:00:00.000Z', sampleRate: SAMPLE_RATE,
		sources: [{
			...video,
			frameRate: { num: 30_000, den: 1_001 },
			sourceFrameCount: timing.reference.frameCount,
			contentSha256: videoSha256,
			timingAsset: timing.reference,
		}],
		projectBin: { clips: [clip] },
	});
	const descriptors: readonly DesktopSharedManagedSourceDescriptor[] = Object.freeze([{
		bindingId: `v${'8'.repeat(64)}`, byteLength: videoBytes.byteLength,
		encoding: DESKTOP_SHARED_VIDEO_ENCODING, kind: 'video', sha256: videoSha256,
		sourceId: video.id, storageKey: video.storageKey,
	}, {
		bindingId: `t${'9'.repeat(64)}`, byteLength: timing.bytes.byteLength,
		encoding: DESKTOP_SHARED_VIDEO_TIMING_ENCODING, kind: 'video-timing', sha256: timing.reference.sha256,
		sourceId: video.id, storageKey: timing.reference.storageKey,
	}]);
	const bodies = new Map([
		[descriptors[0]!.bindingId, videoBytes],
		[descriptors[1]!.bindingId, timing.bytes],
	]);
	const transfer = async (request: Readonly<{ bindingId: string; length: number; offset: number }>) => {
		const body = bodies.get(request.bindingId);
		if (!body) throw new Error('Unexpected managed binding');
		return body.slice(request.offset, request.offset + request.length);
	};
	const store = memoryStore(context, 'timing-success');
	const acquired = await acquireDesktopSharedProjectMedia(
		project, null, descriptors, { readSharedSourceChunk: transfer }, store,
	);
	assert.deepEqual(await readMediaBytes(store, video.storageKey), videoBytes);
	assert.deepEqual(await readMediaBytes(store, timing.reference.storageKey), timing.bytes);
	assert.equal(
		(await store.getMediaAssetMetadata(timing.reference.storageKey))?.mimeType,
		VIDEO_TIMING_ASSET_MIME_TYPE,
	);
	acquired.commit();

	const corruptStore = memoryStore(context, 'timing-corrupt');
	const corruptTiming = timing.bytes.slice();
	corruptTiming[corruptTiming.byteLength - 1] ^= 1;
	bodies.set(descriptors[1]!.bindingId, corruptTiming);
	await assert.rejects(
		acquireDesktopSharedProjectMedia(
			project, null, descriptors, { readSharedSourceChunk: transfer }, corruptStore,
		),
		/digest|sha-256|immutable/iu,
	);
	assert.equal(await readMediaBytes(corruptStore, video.storageKey), null);
	assert.equal(await readMediaBytes(corruptStore, timing.reference.storageKey), null);

	const malformedBytes = new Uint8Array(timing.bytes.byteLength);
	const malformedSha256 = digest(malformedBytes);
	const malformedReference = Object.freeze({
		...timing.reference,
		storageKey: `video-timing-sha256:${malformedSha256}`,
		sha256: malformedSha256,
	});
	const malformedProject = createCurrentAudioEditorProject({
		...project,
		sources: project.sources.map((source) => source.id === video.id
			? { ...source, timingAsset: malformedReference }
			: source),
	});
	const malformedDescriptors: readonly DesktopSharedManagedSourceDescriptor[] = Object.freeze([
		descriptors[0]!,
		Object.freeze({
			...descriptors[1]!,
			sha256: malformedSha256,
			storageKey: malformedReference.storageKey,
		}),
	]);
	bodies.set(descriptors[1]!.bindingId, malformedBytes);
	const malformedStore = memoryStore(context, 'timing-malformed');
	await assert.rejects(
		acquireDesktopSharedProjectMedia(
			malformedProject, null, malformedDescriptors, { readSharedSourceChunk: transfer }, malformedStore,
		),
		/magic|timing asset|codec/iu,
	);
	assert.equal(await readMediaBytes(malformedStore, video.storageKey), null);
	assert.equal(await readMediaBytes(malformedStore, malformedReference.storageKey), null);
});

function memoryStore(context: TestContext, label: string): AudioEditorProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `timing-acquisition-${label}-${Date.now()}-${Math.random()}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

async function readMediaBytes(store: AudioEditorProjectStore, sourceId: string): Promise<Uint8Array | null> {
	const blob = await store.loadMediaAsset(sourceId);
	return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
