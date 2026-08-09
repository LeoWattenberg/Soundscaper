/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createVideoClipV9, createVideoSourceV9 } from '../src/common/editor/project-v9.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import {
	DESKTOP_SHARED_VIDEO_ENCODING,
	DESKTOP_SHARED_VIDEO_TIMING_ENCODING,
	prepareDesktopSharedProjectMediaHandoff,
	type DesktopSharedSourceTransferBridge,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';
import {
	createVideoTimingAssetPublication,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';

test('sender transfers one shared timing body for distinct video-source aliases', async () => {
	const fixture = aliasFixture();
	const events: string[] = [];
	const declarations: Array<Readonly<{ encoding: string; sourceId: string }>> = [];
	const bridge = presentBridge(fixture, declarations);

	const descriptors = await prepareDesktopSharedProjectMediaHandoff(
		fixture.project,
		bridge,
		aliasStore(fixture, events),
	);

	assert.deepEqual(descriptors.map(({ kind }) => kind), ['video', 'video-timing', 'video']);
	assert.equal(declarations.filter(({ encoding }) => encoding === DESKTOP_SHARED_VIDEO_TIMING_ENCODING).length, 1);
	assert.equal(events.filter((event) => event === `metadata:${fixture.timing.reference.storageKey}`).length, 3);
	assert.equal(events.filter((event) => event === `load:${fixture.timing.reference.storageKey}`).length, 2);
});

test('sender capacity counts one shared timing body before reading retained media', async () => {
	const fixture = aliasFixture();
	const timingBytes = fixture.timing.reference.byteLength;
	const videoSize = Math.floor((SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes - timingBytes) / 2);
	let bodyReads = 0;
	const store = aliasStore(fixture, [], videoSize, () => { bodyReads += 1; });

	await assert.rejects(
		prepareDesktopSharedProjectMediaHandoff(fixture.project, presentBridge(fixture, []), store),
		/changed while preparing/iu,
	);
	assert.equal(bodyReads, 1, 'deduplicated preflight reaches its first bounded body validation');
});

function aliasFixture() {
	const videoBytes = Uint8Array.of(1, 3, 5, 7);
	const videoSha256 = digest(videoBytes);
	const timing = createVideoTimingAssetPublication(videoSha256, {
		timescale: 1_000,
		presentationTicks: [0n],
		finalFrameDurationTicks: 40n,
	});
	const videos = ['first', 'second'].map((name) => ({
		...createVideoSourceV9({
			id: `${name}-video`, storageKey: `${name}-storage`, name: `${name}.mp4`, mimeType: 'video/mp4',
			frameCount: 1_600, sampleRate: 48_000, width: 640, height: 360,
			frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
		}),
		contentSha256: videoSha256,
		sourceFrameCount: timing.reference.frameCount,
		timingAsset: timing.reference,
	}));
	const clips = videos.map((video, index) => createVideoClipV9({
		id: `${video.id}-clip`, sourceId: video.id, durationFrames: 1_600, binItemId: `item-${index}`,
	}));
	const project = createCurrentAudioEditorProject({
		id: 'timing-alias-project', revision: 1, now: '2026-08-01T12:00:00.000Z', sampleRate: 48_000,
		sources: videos,
		projectBin: { clips },
	});
	return Object.freeze({ project, timing, videoBytes, videoSha256, videos });
}

type AliasFixture = ReturnType<typeof aliasFixture>;

function aliasStore(fixture: AliasFixture, events: string[], videoSize = fixture.videoBytes.byteLength, onBody = () => {}) {
	return {
		getMediaAssetMetadata(storageKey: string) {
			events.push(`metadata:${storageKey}`);
			const timing = storageKey === fixture.timing.reference.storageKey;
			return {
				sourceId: storageKey, storage: 'indexeddb-blob', path: undefined,
				committedAt: '2026-08-01T12:00:00.000Z',
				mimeType: timing ? VIDEO_TIMING_ASSET_MIME_TYPE : 'video/mp4',
				size: timing ? fixture.timing.reference.byteLength : videoSize,
				sha256: timing ? fixture.timing.reference.sha256 : fixture.videoSha256,
			};
		},
		loadMediaAsset(storageKey: string) {
			events.push(`load:${storageKey}`);
			onBody();
			const timing = storageKey === fixture.timing.reference.storageKey;
			const bytes = timing ? fixture.timing.bytes : fixture.videoBytes;
			return Promise.resolve(blob(bytes, timing ? VIDEO_TIMING_ASSET_MIME_TYPE : 'video/mp4'));
		},
		readSourceChunks() { throw new Error('Unexpected PCM read.'); },
	};
}

function presentBridge(
	fixture: AliasFixture,
	declarations: Array<Readonly<{ encoding: string; sourceId: string }>>,
): DesktopSharedSourceTransferBridge {
	const unexpected = (): never => { throw new Error('Unexpected shared-source bridge call.'); };
	return {
		async beginSharedSourceWrite(declaration) {
			declarations.push(declaration);
			const timing = declaration.encoding === DESKTOP_SHARED_VIDEO_TIMING_ENCODING;
			if (timing) return { status: 'present', source: Object.freeze({
				bindingId: `t${'9'.repeat(64)}`,
				byteLength: declaration.byteLength,
				encoding: DESKTOP_SHARED_VIDEO_TIMING_ENCODING,
				kind: 'video-timing' as const,
				sha256: declaration.sha256,
				sourceId: declaration.sourceId,
				storageKey: fixture.timing.reference.storageKey,
			}) } as const;
			const video = fixture.videos.find(({ id }) => id === declaration.sourceId);
			if (!video) throw new Error('Unexpected video source declaration.');
			return { status: 'present', source: Object.freeze({
				bindingId: `v${(video.id === 'first-video' ? '7' : '8').repeat(64)}`,
				byteLength: declaration.byteLength,
				encoding: DESKTOP_SHARED_VIDEO_ENCODING,
				kind: 'video' as const,
				sha256: declaration.sha256,
				sourceId: declaration.sourceId,
				storageKey: video.storageKey,
			}) } as const;
		},
		writeSharedSourceChunk: async () => unexpected(),
		finishSharedSourceWrite: async () => unexpected(),
		abortSharedSourceWrite: async () => unexpected(),
		readSharedSourceChunk: async () => unexpected(),
	};
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function blob(bytes: Uint8Array, type: string): Blob {
	return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
}
