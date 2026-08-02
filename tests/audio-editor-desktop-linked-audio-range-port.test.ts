/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

const LOCATOR_ID = 'a'.repeat(64);
const LOCATOR_REVISION = 'b'.repeat(64);
const READ_ID = 'c'.repeat(64);
const BODY = new TextEncoder().encode('RIFF-linked-audio-range');

test('desktop linked-audio range leases issue exact bounded reads and release once', async () => {
	const loads: unknown[] = [];
	const ranges: string[] = [];
	const releases: string[] = [];
	const bridge = rangeBridge({ loads, releases, requireReleaseReceiver: true });
	const service = createAudioEditorFileService({
		bridge,
		fetch: async (_url: string, init: RequestInit) => {
			const range = new Headers(init.headers).get('Range') ?? '';
			ranges.push(range);
			const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
			assert.ok(match);
			const start = Number(match[1]);
			const end = Number(match[2]);
			return exactRangeResponse(BODY.slice(start, end + 1), start, end, BODY.byteLength, 'audio/wav');
		},
	});

	const lease = await service.linkedOriginalPort?.leaseRange?.('audio', LOCATOR_ID, {
		expectedRevision: LOCATOR_REVISION,
	});
	assert.ok(lease);
	assert.deepEqual(Object.keys(lease).sort(), [
		'byteLength', 'locatorRevision', 'mimeType', 'readRange', 'release',
	]);
	assert.equal(lease.locatorRevision, LOCATOR_REVISION);
	assert.equal(lease.byteLength, BODY.byteLength);
	assert.equal(lease.mimeType, 'audio/wav');
	assert.deepEqual(await lease.readRange({ offset: 5, length: 6 }), BODY.slice(5, 11));
	assert.deepEqual(loads, [{
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
		range: true,
	}]);
	assert.deepEqual(ranges, ['bytes=5-10']);
	const firstRelease = lease.release();
	const secondRelease = lease.release();
	assert.strictEqual(firstRelease, secondRelease);
	await firstRelease;
	assert.deepEqual(releases, [READ_ID]);
	await assert.rejects(
		Promise.resolve(lease.readRange({ offset: 0, length: 1 })),
		/released/iu,
	);
});

test('desktop linked-audio range leases admit exact RF64 descriptors', async () => {
	const releases: string[] = [];
	const service = createAudioEditorFileService({
		bridge: rangeBridge({
			descriptor: audioRangeDescriptor({ mimeType: 'audio/rf64', name: 'selected.rf64' }),
			releases,
		}),
		fetch: async (_url: string, init: RequestInit) => {
			const range = new Headers(init.headers).get('Range');
			assert.equal(range, 'bytes=0-3');
			return exactRangeResponse(BODY.slice(0, 4), 0, 3, BODY.byteLength, 'audio/rf64');
		},
	});

	const lease = await service.linkedOriginalPort?.leaseRange?.('audio', LOCATOR_ID, {
		expectedRevision: LOCATOR_REVISION,
	});
	assert.ok(lease);
	assert.equal(lease.mimeType, 'audio/rf64');
	assert.deepEqual(await lease.readRange({ offset: 0, length: 4 }), BODY.slice(0, 4));
	await lease.release();
	assert.deepEqual(releases, [READ_ID]);
});

test('desktop linked-audio range admission rejects malformed descriptors with exact cleanup', async () => {
	for (const [name, descriptor] of [
		['profile', { ...audioRangeDescriptor(), readProfile: 'materialized-v1' }],
		['MIME', { ...audioRangeDescriptor(), mimeType: 'audio/rf64' }],
		['name', { ...audioRangeDescriptor(), name: 'selected.mp3' }],
		['open descriptor', { ...audioRangeDescriptor(), path: '/private/selected.wav' }],
	] as const) {
		const releases: string[] = [];
		const service = createAudioEditorFileService({
			bridge: rangeBridge({ descriptor, releases }),
			fetch: async () => { throw new Error('must not fetch'); },
		});
		await assert.rejects(
			Promise.resolve(service.linkedOriginalPort?.leaseRange?.('audio', LOCATOR_ID, {
				expectedRevision: LOCATOR_REVISION,
			})),
			/profile|MIME|WAV|RF64|name|unsupported|field/iu,
			name,
		);
		assert.deepEqual(releases, [READ_ID], name);
	}
});

test('desktop linked-audio range admission cleans revision drift and preserves cancellation', async () => {
	const driftReleases: string[] = [];
	const drifted = createAudioEditorFileService({
		bridge: rangeBridge({ locatorRevision: 'd'.repeat(64), releases: driftReleases }),
		fetch: async () => { throw new Error('must not fetch'); },
	});
	await assert.rejects(
		Promise.resolve(drifted.linkedOriginalPort?.leaseRange?.('audio', LOCATOR_ID, {
			expectedRevision: LOCATOR_REVISION,
		})),
		/revision.*changed|changed.*revision/iu,
	);
	assert.deepEqual(driftReleases, [READ_ID]);

	const controller = new AbortController();
	const reason = new Error('cancel linked-audio range admission');
	const cancelledReleases: string[] = [];
	const cancelled = createAudioEditorFileService({
		bridge: rangeBridge({
			afterLoad: () => controller.abort(reason),
			releases: cancelledReleases,
		}),
		fetch: async () => { throw new Error('must not fetch'); },
	});
	await assert.rejects(
		Promise.resolve(cancelled.linkedOriginalPort?.leaseRange?.('audio', LOCATOR_ID, {
			expectedRevision: LOCATOR_REVISION,
			signal: controller.signal,
		})),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(cancelledReleases, [READ_ID]);
});

test('desktop linked-audio ranges reject inexact transport and the fixed range overflow', async () => {
	const releases: string[] = [];
	const service = createAudioEditorFileService({
		bridge: rangeBridge({ releases }),
		fetch: async () => exactRangeResponse(BODY.slice(0, 2), 0, 2, BODY.byteLength, 'audio/wav'),
	});
	const lease = await service.linkedOriginalPort?.leaseRange?.('audio', LOCATOR_ID, {
		expectedRevision: LOCATOR_REVISION,
	});
	assert.ok(lease);
	await assert.rejects(
		Promise.resolve(lease.readRange({ offset: 0, length: 2 })),
		/Content-Range|exact range/iu,
	);
	await assert.rejects(
		Promise.resolve(lease.readRange({ offset: 0, length: 4 * 1024 ** 2 + 1 })),
		/4 MiB|maximum/iu,
	);
	await lease.release();
	assert.deepEqual(releases, [READ_ID]);
});

function rangeBridge(options: Readonly<{
	afterLoad?: () => void;
	descriptor?: Readonly<Record<string, unknown>>;
	loads?: unknown[];
	locatorRevision?: string;
	releases: string[];
	requireReleaseReceiver?: boolean;
}>) {
	const bridge = {
		async chooseLinkedAudioOriginal() { return null; },
		async loadLinkedAudioOriginal(request: unknown) {
			options.loads?.push(request);
			options.afterLoad?.();
			return {
				locatorRevision: options.locatorRevision ?? LOCATOR_REVISION,
				descriptor: options.descriptor ?? audioRangeDescriptor(),
			};
		},
		async chooseLinkedVideoOriginal() { return null; },
		async loadLinkedVideoOriginal() { return null; },
		async reconcileLinkedVideoOriginals() { return 0; },
		async releaseLinkedVideoOriginal() { return true; },
		async reconcileLinkedOriginals() { return 0; },
		async releaseLinkedOriginal() { return true; },
		releaseRead(id: string) {
			if (options.requireReleaseReceiver) assert.equal(this, bridge);
			options.releases.push(id);
			return true;
		},
	};
	return bridge;
}

function audioRangeDescriptor(
	overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
	const name = String(overrides.name ?? 'selected.wav');
	return Object.freeze({
		id: READ_ID,
		url: `soundscaper-app://bundle/_desktop/read/linked-audio-range-v1/${READ_ID}/${name}`,
		name,
		size: BODY.byteLength,
		mimeType: 'audio/wav',
		readProfile: 'linked-audio-range-v1',
		lastModified: 123,
		...overrides,
	});
}

function exactRangeResponse(
	bytes: Uint8Array,
	start: number,
	end: number,
	total: number,
	mimeType: string,
): Response {
	const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	return new Response(body, {
		status: 206,
		headers: {
			'Accept-Ranges': 'bytes',
			'Content-Length': String(bytes.byteLength),
			'Content-Range': `bytes ${start}-${end}/${total}`,
			'Content-Type': mimeType,
		},
	});
}
