/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { VideoSourceUpgradeRefusedError } from '../src/common/editor/video-source-upgrade.ts';
import { createVideoSourceReprobeService } from '../src/common/editor/controller/video-source-reprobe-service.ts';
import { createUnreportedVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const MEDIA_BYTES = new Uint8Array(Array.from({ length: 512 }, (_, index) => index % 251));
const FABRICATED_RATE = Object.freeze({ num: 30, den: 1 });
const EXACT_RATE = Object.freeze({ num: 24, den: 1 });

function mediaBlob(): Blob {
	return new Blob([MEDIA_BYTES], { type: 'video/mp4' });
}

/** An in-memory owned-asset store: enough to publish one timing asset. */
function createStore(media: Blob | null) {
	const assets = new Map<string, Uint8Array>();
	const discarded: string[] = [];
	return {
		assets,
		discarded,
		loadMediaAsset: (storageKey: string) => Promise.resolve(
			storageKey === 'video-source' ? media : (assets.get(storageKey)
				? new Blob([assets.get(storageKey)!.slice().buffer])
				: null),
		),
		getMediaAssetMetadata: (storageKey: string) => Promise.resolve(
			assets.has(storageKey)
				? { sha256: '', size: assets.get(storageKey)!.byteLength }
				: null,
		),
		beginMediaAssetWrite: (
			storageKey: string,
			metadata: Readonly<Record<string, unknown>>,
			options: Readonly<{ expectedBytes: number; expectedSha256: string }>,
		) => {
			const chunks: Uint8Array[] = [];
			let bytesWritten = 0;
			return Promise.resolve({
				maximumChunkBytes: 1_024,
				get bytesWritten() { return bytesWritten; },
				write(chunk: Uint8Array) {
					chunks.push(chunk.slice());
					bytesWritten += chunk.byteLength;
					return Promise.resolve();
				},
				commitOwned() {
					const bytes = new Uint8Array(bytesWritten);
					let offset = 0;
					for (const chunk of chunks) {
						bytes.set(chunk, offset);
						offset += chunk.byteLength;
					}
					assets.set(storageKey, bytes);
					return Promise.resolve({
						metadata: { sha256: options.expectedSha256, size: options.expectedBytes, ...metadata },
						discardIfCurrent: () => {
							assets.delete(storageKey);
							discarded.push(storageKey);
							return Promise.resolve(true);
						},
					});
				},
				commit: () => Promise.resolve({}),
				abort: () => Promise.resolve(),
			});
		},
	};
}

async function harness(overrides: Readonly<Record<string, unknown>> = {}) {
	const contentSha256 = await digestMediaContent(mediaBlob());
	const source = {
		kind: 'video',
		id: 'video-source',
		storageKey: 'video-source',
		name: 'phone.mp4',
		contentSha256,
		sampleFrameCount: 480_000,
		sampleRate: 48_000,
		width: 640,
		height: 360,
		frameRate: FABRICATED_RATE,
		sourceFrameCount: 300,
		timingAsset: null,
		timingDecision: {
			mode: 'conform-cfr-at-ingest',
			rate: FABRICATED_RATE,
			reason: 'timing-probe-unavailable',
			failures: [],
		},
		characteristics: createUnreportedVideoSourceCharacteristics(),
		videoCodec: 'unknown',
		audioCodec: null,
		hasAudio: false,
		...(overrides.source as Record<string, unknown> ?? {}),
	};
	const project = {
		id: 'reprobe-project',
		sources: [source],
		clips: (overrides.clips as unknown[]) ?? [
			{ kind: 'video', id: 'timeline-clip', sourceId: 'video-source', sourceInFrame: 0, sourceFrameCount: 300 },
		],
		projectBin: { clips: [] },
	};
	const commands: AudioEditorCommand[] = [];
	const activated: unknown[] = [];
	const store = createStore(overrides.media === undefined ? mediaBlob() : (overrides.media as Blob | null));
	const service = createVideoSourceReprobeService({
		lifetime: new EditorControllerLifetime(),
		store,
		ffmpeg: {
			probeVideoTiming: overrides.probeVideoTiming as never ?? (() => Promise.resolve({
				nominalRate: EXACT_RATE,
				timescale: 24_000,
				presentationTicks: Array.from({ length: 240 }, (_, index) => BigInt(index) * 1_000n),
				finalFrameDurationTicks: 1_000n,
				characteristics: { backend: 'ffmpeg', codedWidth: 640, codedHeight: 360, videoCodec: 'h264' },
			})),
		},
		getProject: () => project,
		captureProject: () => 'token',
		assertProject: (token: unknown) => {
			if (token !== 'token') throw new Error('The project changed.');
		},
		editingBlocked: () => Boolean(overrides.blocked),
		commit: (command: AudioEditorCommand) => {
			commands.push(command);
			return command;
		},
		publishProjectState: () => undefined,
		createAudioEditorVideoFrameExtractor: () => ({
			metadata: { width: 640, height: 360 },
			dispose: () => undefined,
		}),
		activateVideoSource: (value: unknown) => {
			activated.push(value);
			return Promise.resolve(null);
		},
	});
	return { activated, commands, contentSha256, service, source, store };
}

test('a re-probe reads the source\'s own bytes and commits one command', async () => {
	const { commands, contentSha256, service, store, activated } = await harness();
	const result = await service.reprobe('video-source');

	assert.equal(result.upgraded, true);
	assert.deepEqual(result.clampedClipIds, []);
	assert.deepEqual(commands.length, 1);
	const command = commands[0] as unknown as Record<string, unknown>;
	assert.equal(command.type, 'source/reprobe');
	assert.equal(command.sourceId, 'video-source');
	const changes = command.changes as Record<string, unknown>;
	assert.deepEqual(changes.frameRate, EXACT_RATE);
	assert.equal(changes.sourceFrameCount, 240);
	assert.deepEqual(changes.timingDecision, { mode: 'exact', rate: EXACT_RATE, backend: 'ffmpeg' });
	// The published asset is bound to the digest of the bytes actually read back.
	assert.equal((changes.timingAsset as Record<string, unknown>).sourceSha256, contentSha256);
	assert.deepEqual(command.clips, [{
		clipId: 'timeline-clip', sourceInFrame: 0, sourceFrameCount: 240, clamped: false,
	}]);
	assert.equal(store.assets.size, 1);
	// The registered timing index came from the old reading, so it is re-bound.
	assert.equal(activated.length, 1);
});

test('a probe that cannot reach exact timing commits nothing and keeps no asset', async () => {
	const { commands, service, store } = await harness({
		probeVideoTiming: () => Promise.reject(new Error('no demuxer')),
	});
	await assert.rejects(service.reprobe('video-source'), (error: unknown) => {
		assert.ok(error instanceof VideoSourceUpgradeRefusedError);
		assert.equal(error.reason, 'probe-unavailable');
		return true;
	});
	assert.equal(commands.length, 0);
	assert.equal(store.assets.size, 0);
});

test('bytes that no longer digest to the document\'s content are refused', async () => {
	const { commands, service } = await harness({ media: new Blob([new Uint8Array([1, 2, 3])]) });
	await assert.rejects(service.reprobe('video-source'), (error: unknown) => {
		assert.ok(error instanceof VideoSourceUpgradeRefusedError);
		assert.equal(error.reason, 'content-changed');
		return true;
	});
	assert.equal(commands.length, 0);
});

test('media the store cannot return is refused rather than guessed at', async () => {
	const { service } = await harness({ media: null });
	await assert.rejects(service.reprobe('video-source'), (error: unknown) => {
		assert.ok(error instanceof VideoSourceUpgradeRefusedError);
		assert.equal(error.reason, 'media-unavailable');
		return true;
	});
});

test('a re-read that agrees with the document commits nothing', async () => {
	const first = await harness();
	await first.service.reprobe('video-source');
	const changes = (first.commands[0] as unknown as Record<string, unknown>).changes as Record<string, unknown>;

	const second = await harness({
		source: { ...changes },
		clips: [{ kind: 'video', id: 'timeline-clip', sourceId: 'video-source', sourceInFrame: 0, sourceFrameCount: 240 }],
	});
	const result = await second.service.reprobe('video-source');
	assert.equal(result.upgraded, false);
	assert.deepEqual(result.changedFields, []);
	assert.equal(second.commands.length, 0);
	assert.equal(second.activated.length, 0);
	// Re-publishing an immutable asset that already exists creates nothing, so
	// there is no orphan to discard either.
	assert.deepEqual(second.store.discarded, []);
});

test('blocked editing refuses before any media is read', async () => {
	const { commands, service, store } = await harness({ blocked: true });
	await assert.rejects(service.reprobe('video-source'), /Editing is blocked/);
	assert.equal(commands.length, 0);
	assert.equal(store.assets.size, 0);
});

test('an unknown or non-video source is a reference error, not a refusal', async () => {
	const { service } = await harness();
	await assert.rejects(service.reprobe('missing-source'), ReferenceError);
});
