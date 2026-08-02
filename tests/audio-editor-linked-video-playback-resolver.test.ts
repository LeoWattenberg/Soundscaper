/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LINKED_VIDEO_PLAYBACK_VERIFY_CHUNK_BYTES,
	LinkedVideoOriginalResolver,
	type LinkedVideoOriginalPlaybackLease,
	type LinkedVideoOriginalPort,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { LinkedVideoOriginalRepository } from '../src/common/editor/storage/linked-video-original-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const PROJECT_ID = 'linked-playback-project';
const LOCATOR_ID = 'locator_linked_playback_0001';
const LOCATOR_REVISION = 'revision_linked_playback_001';
const MEDIA_URL = 'soundscaper-app://bundle/_desktop/read/linked-video-range-v1/lease/video.mp4';

test('linked-video playback verifies sequential 4 MiB ranges without another Blob load', async () => {
	const bytes = new Uint8Array(LINKED_VIDEO_PLAYBACK_VERIFY_CHUNK_BYTES + 3);
	bytes.fill(7);
	const ranges: Array<readonly [number, number]> = [];
	let loads = 0;
	let releases = 0;
	let platformLease: LinkedVideoOriginalPlaybackLease;
	const { resolver } = fixtureResolver({
		load() {
			loads += 1;
			return { blob: new Blob([bytes], { type: 'video/mp4' }), locatorRevision: LOCATOR_REVISION };
		},
		leasePlayback: () => platformLease = playbackLease(bytes, {
			onRange: (offset, length) => { ranges.push([offset, length]); },
			onRelease: () => { releases += 1; },
			onReadReceiver: (receiver) => { assert.equal(receiver, platformLease); },
			onReleaseReceiver: (receiver) => { assert.equal(receiver, platformLease); },
		}),
	});
	const source = videoSource();
	const binding = await resolver.bind(PROJECT_ID, source, LOCATOR_ID);
	assert.equal(loads, 1);

	const lease = await resolver.leasePlayback(PROJECT_ID, source);
	assert.ok(lease);
	assert.equal(lease.binding.bindingToken, binding.bindingToken);
	assert.equal(lease.mediaUrl, MEDIA_URL);
	assert.equal(loads, 1, 'playback verification does not materialize another Blob');
	assert.deepEqual(ranges, [
		[0, LINKED_VIDEO_PLAYBACK_VERIFY_CHUNK_BYTES],
		[LINKED_VIDEO_PLAYBACK_VERIFY_CHUNK_BYTES, 3],
	]);
	await lease.release();
	await lease.release();
	assert.equal(releases, 1);
});

test('linked-video playback releases exact leases on metadata, digest, and cancellation failure', async (context) => {
	for (const scenario of [
		{ name: 'revision', mutate: (lease: LinkedVideoOriginalPlaybackLease) => ({ ...lease, locatorRevision: 'changed_revision' }) },
		{ name: 'size', mutate: (lease: LinkedVideoOriginalPlaybackLease) => ({ ...lease, byteLength: lease.byteLength + 1 }) },
		{ name: 'MIME', mutate: (lease: LinkedVideoOriginalPlaybackLease) => ({ ...lease, mimeType: 'video/webm' }) },
		{ name: 'digest', mutate: (lease: LinkedVideoOriginalPlaybackLease) => ({
			...lease,
			readRange: async ({ offset, length }: Readonly<{ offset: number; length: number }>) => new Uint8Array(length).fill(offset + 9),
		}) },
	] as const) {
		await context.test(scenario.name, async () => {
			const bytes = new TextEncoder().encode('verified linked playback');
			let releases = 0;
			const { resolver } = fixtureResolver({
				load: () => ({ blob: new Blob([bytes], { type: 'video/mp4' }), locatorRevision: LOCATOR_REVISION }),
				leasePlayback: () => scenario.mutate(playbackLease(bytes, {
					onRelease: () => { releases += 1; },
				})),
			});
			const source = videoSource();
			await resolver.bind(PROJECT_ID, source, LOCATOR_ID);
			await assert.rejects(resolver.leasePlayback(PROJECT_ID, source), /revision|size|MIME|SHA-256|digest|changed/iu);
			assert.equal(releases, 1);
		});
	}

	const bytes = new TextEncoder().encode('cancelled linked playback');
	const controller = new AbortController();
	const reason = new Error('cancel linked playback');
	let releases = 0;
	const { resolver } = fixtureResolver({
		load: () => ({ blob: new Blob([bytes], { type: 'video/mp4' }), locatorRevision: LOCATOR_REVISION }),
		leasePlayback: () => ({
			...playbackLease(bytes, { onRelease: () => { releases += 1; } }),
			async readRange() {
				controller.abort(reason);
				throw new Error('range transport failure after cancellation');
			},
		}),
	});
	const source = videoSource();
	await resolver.bind(PROJECT_ID, source, LOCATOR_ID);
	await assert.rejects(
		resolver.leasePlayback(PROJECT_ID, source, { signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.equal(releases, 1);
});

test('linked-video playback preserves verification and cleanup failures', async () => {
	const bytes = new TextEncoder().encode('linked cleanup failure');
	const { resolver } = fixtureResolver({
		load: () => ({ blob: new Blob([bytes], { type: 'video/mp4' }), locatorRevision: LOCATOR_REVISION }),
		leasePlayback: () => ({
			...playbackLease(bytes),
			readRange: async ({ length }) => new Uint8Array(length),
			release: async () => { throw new Error('playback cleanup failed'); },
		}),
	});
	const source = videoSource();
	await resolver.bind(PROJECT_ID, source, LOCATOR_ID);
	await assert.rejects(resolver.leasePlayback(PROJECT_ID, source), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(String(error.errors[0]), /SHA-256|digest/iu);
		assert.match(String(error.errors[1]), /cleanup failed/iu);
		return true;
	});
});

test('linked-video playback cleans malformed and post-admission cancelled port leases', async () => {
	const bytes = new TextEncoder().encode('admission cleanup');
	let malformedReleases = 0;
	const malformed = fixtureResolver({
		load: () => ({ blob: new Blob([bytes], { type: 'video/mp4' }), locatorRevision: LOCATOR_REVISION }),
		leasePlayback: () => ({
			...playbackLease(bytes, { onRelease: () => { malformedReleases += 1; } }),
			unsupported: true,
		}) as unknown as LinkedVideoOriginalPlaybackLease,
	});
	const source = videoSource();
	await malformed.resolver.bind(PROJECT_ID, source, LOCATOR_ID);
	await assert.rejects(
		malformed.resolver.leasePlayback(PROJECT_ID, source),
		/closed object/iu,
	);
	assert.equal(malformedReleases, 1);

	const controller = new AbortController();
	const reason = new Error('cancel after playback admission');
	let cancelledReleases = 0;
	const cancelled = fixtureResolver({
		load: () => ({ blob: new Blob([bytes], { type: 'video/mp4' }), locatorRevision: LOCATOR_REVISION }),
		leasePlayback: () => {
			controller.abort(reason);
			return playbackLease(bytes, { onRelease: () => { cancelledReleases += 1; } });
		},
	});
	await cancelled.resolver.bind(PROJECT_ID, source, LOCATOR_ID);
	await assert.rejects(
		cancelled.resolver.leasePlayback(PROJECT_ID, source, { signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.equal(cancelledReleases, 1);
});

test('linked-video playback releases its lease when the binding changes during verification', async () => {
	const bytes = new TextEncoder().encode('raced linked playback');
	let bindingToken = '';
	let releases = 0;
	let replaced = false;
	const fixture = fixtureResolver({
		load: () => ({ blob: new Blob([bytes], { type: 'video/mp4' }), locatorRevision: LOCATOR_REVISION }),
		leasePlayback: () => ({
			...playbackLease(bytes, { onRelease: () => { releases += 1; } }),
			async readRange({ offset, length }) {
				if (!replaced) {
					replaced = true;
					assert.equal(await fixture.repository.deleteIfCurrent(
						PROJECT_ID,
						videoSource().id,
						bindingToken,
					), true);
				}
				return bytes.slice(offset, offset + length);
			},
		}),
	});
	const source = videoSource();
	const binding = await fixture.resolver.bind(PROJECT_ID, source, LOCATOR_ID);
	bindingToken = binding.bindingToken;
	await assert.rejects(
		fixture.resolver.leasePlayback(PROJECT_ID, source),
		/binding.*changed|changed.*binding/iu,
	);
	assert.equal(releases, 1);
});

function fixtureResolver(port: LinkedVideoOriginalPort) {
	let token = 0;
	const repository = new LinkedVideoOriginalRepository({
		memory: getMemoryDatabase(`linked-playback-${Date.now()}-${Math.random()}`),
		database: async () => null,
	}, {
		now: () => new Date('2026-08-02T10:11:12.345Z'),
		createBindingToken: () => `binding_token_${String(++token).padStart(8, '0')}`,
	});
	return { repository, resolver: new LinkedVideoOriginalResolver(repository, port) };
}

function playbackLease(
	bytes: Uint8Array,
	options: Readonly<{
		onRange?: (offset: number, length: number) => void;
		onRelease?: () => void;
		onReadReceiver?: (receiver: unknown) => void;
		onReleaseReceiver?: (receiver: unknown) => void;
	}> = {},
): LinkedVideoOriginalPlaybackLease {
	const lease = {
		locatorRevision: LOCATOR_REVISION,
		mediaUrl: MEDIA_URL,
		byteLength: bytes.byteLength,
		mimeType: 'video/mp4',
		async readRange({ offset, length }: Readonly<{ offset: number; length: number }>) {
			options.onReadReceiver?.(this);
			options.onRange?.(offset, length);
			return bytes.slice(offset, offset + length);
		},
		async release() {
			options.onReleaseReceiver?.(this);
			options.onRelease?.();
		},
	};
	return Object.freeze(lease);
}

function videoSource() {
	return Object.freeze({
		kind: 'video' as const,
		id: 'source-linked-playback',
		storageKey: 'external/linked-playback',
		mimeType: 'video/mp4',
		frameCount: 96_000,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
	});
}
