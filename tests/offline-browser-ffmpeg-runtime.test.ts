/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	InstallLatestFfmpegRuntimeOptions,
	InstallLatestFfmpegRuntimeResult,
	VerifiedRuntimeRelease,
	VerifiedRuntimeStore,
} from '../src/common/offline/ffmpeg-runtime-cache.ts';
import {
	DEFAULT_FFMPEG_RUNTIME_POINTER_URL,
	createBrowserFfmpegRuntimeManager,
} from '../src/common/offline/browser-ffmpeg-runtime.ts';

const RELEASE_ID = 'a'.repeat(64);
const RELEASE = Object.freeze({
	schemaVersion: 1 as const,
	releaseId: RELEASE_ID,
	manifestSha256: RELEASE_ID,
	baseUrl: `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${RELEASE_ID}/`,
	files: Object.freeze([]),
});

test('browser runtime manager reports unsupported storage without starting a download', async () => {
	let installs = 0;
	const manager = createBrowserFfmpegRuntimeManager({
		createStore: () => null,
		installLatest: async () => {
			installs += 1;
			return { status: 'installed', release: RELEASE };
		},
	});

	assert.deepEqual(await manager.read(), { status: 'unsupported' });
	assert.equal(
		await manager.resolveCoreBaseUrl('https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/'),
		'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10',
	);
	await assert.rejects(() => manager.install(), /CacheStorage is unavailable/u);
	assert.equal(installs, 0);
});

test('browser runtime manager exposes the verified active release to the FFmpeg loader', async () => {
	const store = runtimeStore(RELEASE);
	const manager = createBrowserFfmpegRuntimeManager({ createStore: () => store });

	assert.deepEqual(await manager.read(), { status: 'ready', release: RELEASE });
	assert.equal(await manager.resolveCoreBaseUrl('https://fallback.invalid/core'), RELEASE.baseUrl.slice(0, -1));
});

test('explicit installation uses the production pointer and forwards bounded progress', async () => {
	const store = runtimeStore(null);
	const progress: number[] = [];
	const received: InstallLatestFfmpegRuntimeOptions[] = [];
	const installLatest = async (
		options: InstallLatestFfmpegRuntimeOptions,
	): Promise<InstallLatestFfmpegRuntimeResult> => {
		received.push(options);
		options.onProgress?.({ completedBytes: 3, totalBytes: 4 });
		return { status: 'installed', release: RELEASE };
	};
	const manager = createBrowserFfmpegRuntimeManager({
		createStore: () => store,
		installLatest,
	});

	const result = await manager.install({
		onProgress: ({ completedBytes }) => progress.push(completedBytes),
	});

	assert.equal(String(received[0]?.pointerUrl), DEFAULT_FFMPEG_RUNTIME_POINTER_URL);
	assert.equal(received[0]?.store, store);
	assert.deepEqual(progress, [3]);
	assert.deepEqual(result, { status: 'installed', release: RELEASE });
});

test('a failed update leaves the manager able to report the previous verified release', async () => {
	const store = runtimeStore(RELEASE);
	const manager = createBrowserFfmpegRuntimeManager({
		createStore: () => store,
		installLatest: async () => { throw new Error('candidate digest mismatch'); },
	});

	await assert.rejects(() => manager.install(), /candidate digest mismatch/u);
	assert.deepEqual(await manager.read(), { status: 'ready', release: RELEASE });
});

function runtimeStore(active: VerifiedRuntimeRelease | null): VerifiedRuntimeStore {
	return {
		readActive: async () => active,
		begin: async () => { throw new Error('Unexpected direct transaction.'); },
	};
}
