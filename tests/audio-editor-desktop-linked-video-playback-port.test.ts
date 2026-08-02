/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

const LOCATOR_ID = '1'.repeat(64);
const LOCATOR_REVISION = '2'.repeat(64);
const READ_ID = '3'.repeat(64);
const BODY = new TextEncoder().encode('linked playback bytes');

test('desktop linked-video playback leases issue exact bounded ranges and release once', async () => {
	const loads: unknown[] = [];
	const ranges: string[] = [];
	const releases: string[] = [];
	const service = createAudioEditorFileService({
		bridge: playbackBridge({ loads, releases, requireReleaseReceiver: true }),
		fetch: async (_url: string, init: RequestInit) => {
			const range = new Headers(init.headers).get('Range') ?? '';
			ranges.push(range);
			const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
			assert.ok(match);
			const start = Number(match[1]);
			const end = Number(match[2]);
			const bytes = BODY.slice(start, end + 1);
			return exactRangeResponse(bytes, start, end, BODY.byteLength);
		},
	});

	const lease = await service.linkedVideoOriginalPort?.leasePlayback?.(LOCATOR_ID, {
		expectedRevision: LOCATOR_REVISION,
	});
	assert.ok(lease);
	assert.equal(lease.locatorRevision, LOCATOR_REVISION);
	assert.equal(lease.mediaUrl, playbackDescriptor().url);
	assert.equal(lease.byteLength, BODY.byteLength);
	assert.equal(lease.mimeType, 'video/mp4');
	assert.deepEqual(await lease.readRange({ offset: 2, length: 4 }), BODY.slice(2, 6));
	assert.deepEqual(loads, [{
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
		playback: true,
	}]);
	assert.deepEqual(ranges, ['bytes=2-5']);
	await lease.release();
	await lease.release();
	assert.deepEqual(releases, [READ_ID]);
});

test('desktop playback rejects malformed descriptors and cancellation with exact cleanup', async () => {
	const releases: string[] = [];
	const malformed = createAudioEditorFileService({
		bridge: playbackBridge({
			releases,
			descriptor: { ...playbackDescriptor(), readProfile: 'materialized-v1' },
		}),
		fetch: async () => { throw new Error('must not fetch'); },
	});
	await assert.rejects(
		Promise.resolve(malformed.linkedVideoOriginalPort?.leasePlayback?.(LOCATOR_ID, {
			expectedRevision: LOCATOR_REVISION,
		})),
		/linked-video|playback|profile/iu,
	);
	assert.deepEqual(releases, [READ_ID]);

	const controller = new AbortController();
	const reason = new Error('cancel playback admission');
	const cancelledReleases: string[] = [];
	const cancelled = createAudioEditorFileService({
		bridge: playbackBridge({
			releases: cancelledReleases,
			afterLoad: () => { controller.abort(reason); },
		}),
		fetch: async () => { throw new Error('must not fetch'); },
	});
	await assert.rejects(
		Promise.resolve(cancelled.linkedVideoOriginalPort?.leasePlayback?.(LOCATOR_ID, {
			expectedRevision: LOCATOR_REVISION,
			signal: controller.signal,
		})),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(cancelledReleases, [READ_ID]);
});

test('desktop playback range readers reject inexact responses before retaining bytes', async () => {
	const releases: string[] = [];
	const service = createAudioEditorFileService({
		bridge: playbackBridge({ releases, releaseResult: false }),
		fetch: async () => exactRangeResponse(BODY.slice(0, 2), 0, 2, BODY.byteLength),
	});
	const lease = await service.linkedVideoOriginalPort?.leasePlayback?.(LOCATOR_ID, {
		expectedRevision: LOCATOR_REVISION,
	});
	assert.ok(lease);
	await assert.rejects(Promise.resolve(lease.readRange({
		offset: 0, length: 2,
	})), /Content-Range|exact range/iu);
	await assert.rejects(Promise.resolve(lease.readRange({
		offset: 0, length: 4 * 1024 ** 2 + 1,
	})), /4 MiB|maximum/iu);
	await lease.release();
	assert.deepEqual(releases, [READ_ID]);
});

test('desktop playback memoizes a synchronous release failure', async () => {
	const releases: string[] = [];
	const cleanupError = new Error('synchronous release failure');
	const service = createAudioEditorFileService({
		bridge: playbackBridge({ releases, releaseError: cleanupError }),
		fetch: async () => { throw new Error('must not fetch'); },
	});
	const lease = await service.linkedVideoOriginalPort?.leasePlayback?.(LOCATOR_ID, {
		expectedRevision: LOCATOR_REVISION,
	});
	assert.ok(lease);
	const first = lease.release();
	const second = lease.release();
	assert.equal(first, second);
	await assert.rejects(Promise.resolve(first), (error: unknown) => error === cleanupError);
	assert.deepEqual(releases, [READ_ID]);
});

test('desktop playback range readers preserve cancellation after the final body read', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel final playback read');
	const releases: string[] = [];
	let reads = 0;
	const service = createAudioEditorFileService({
		bridge: playbackBridge({ releases }),
		fetch: async () => ({
			ok: true,
			status: 206,
			headers: new Headers({
				'Accept-Ranges': 'bytes',
				'Content-Length': '2',
				'Content-Range': `bytes 0-1/${BODY.byteLength}`,
				'Content-Type': 'video/mp4',
			}),
			body: {
				getReader: () => ({
					async read() {
						reads += 1;
						if (reads === 1) return { done: false as const, value: BODY.slice(0, 2) };
						controller.abort(reason);
						return { done: true as const, value: undefined };
					},
					cancel: async () => undefined,
				}),
			} as unknown as ReadableStream<Uint8Array>,
		}),
	});
	const lease = await service.linkedVideoOriginalPort?.leasePlayback?.(LOCATOR_ID, {
		expectedRevision: LOCATOR_REVISION,
	});
	assert.ok(lease);
	await assert.rejects(Promise.resolve(lease.readRange({
		offset: 0,
		length: 2,
		signal: controller.signal,
	})), (error: unknown) => error === reason);
	await lease.release();
	assert.deepEqual(releases, [READ_ID]);
});

test('desktop playback range readers preserve cancellation over fetch failures', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel failed playback fetch');
	const releases: string[] = [];
	const service = createAudioEditorFileService({
		bridge: playbackBridge({ releases }),
		fetch: async () => {
			controller.abort(reason);
			throw new Error('transport failure after cancellation');
		},
	});
	const lease = await service.linkedVideoOriginalPort?.leasePlayback?.(LOCATOR_ID, {
		expectedRevision: LOCATOR_REVISION,
	});
	assert.ok(lease);
	await assert.rejects(Promise.resolve(lease.readRange({
		offset: 0,
		length: 2,
		signal: controller.signal,
	})), (error: unknown) => error === reason);
	await lease.release();
	assert.deepEqual(releases, [READ_ID]);
});

function playbackBridge(options: Readonly<{
	afterLoad?: () => void;
	descriptor?: Readonly<Record<string, unknown>>;
	loads?: unknown[];
	releaseError?: Error;
	releaseResult?: unknown;
	requireReleaseReceiver?: boolean;
	releases: string[];
}>) {
	const bridge = {
		chooseLinkedVideoOriginal: async () => null,
		async loadLinkedVideoOriginal(request: unknown) {
			options.loads?.push(request);
			options.afterLoad?.();
			return {
				locatorRevision: LOCATOR_REVISION,
				descriptor: options.descriptor ?? playbackDescriptor(),
			};
		},
		reconcileLinkedVideoOriginals: async () => 0,
		releaseLinkedVideoOriginal: async () => true,
		releaseRead(id: string) {
			if (options.requireReleaseReceiver) assert.equal(this, bridge);
			options.releases.push(id);
			if (options.releaseError) throw options.releaseError;
			return options.releaseResult ?? true;
		},
	};
	return bridge;
}

function playbackDescriptor() {
	return Object.freeze({
		id: READ_ID,
		url: `soundscaper-app://bundle/_desktop/read/linked-video-range-v1/${READ_ID}/selected.mp4`,
		name: 'selected.mp4',
		size: BODY.byteLength,
		mimeType: 'video/mp4',
		readProfile: 'linked-video-range-v1',
		lastModified: 123,
	});
}

function exactRangeResponse(bytes: Uint8Array, start: number, end: number, total: number): Response {
	const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	return new Response(body, {
		status: 206,
		headers: {
			'Accept-Ranges': 'bytes',
			'Content-Length': String(bytes.byteLength),
			'Content-Range': `bytes ${start}-${end}/${total}`,
			'Content-Type': 'video/mp4',
		},
	});
}
