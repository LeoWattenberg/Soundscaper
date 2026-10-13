/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoPreviewSessionOwner } from '../src/common/editor/controller/clip-video/video-preview-session-owner.ts';
import { registerVideoPreviewAuthoringParticipantV1, subscribeVideoPreviewAuthoringV1, suspendVideoPreviewForAuthoringV1,
	videoPreviewAuthoringEpochV1, videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('Frame Original admission waits for the existing preview owner and its accepted late factory to join', async () => {
	const controller = {}, entered = deferred<void>(), release = deferred<void>(); let disposed = 0;
	const owner = createVideoPreviewSessionOwner(() => undefined), unregister = registerVideoPreviewAuthoringParticipantV1(controller, () => owner.close());
	const creating = owner.replace(async () => { entered.resolve(); await release.promise; return { dispose() { disposed++; } }; });
	await entered.promise; const opening = suspendVideoPreviewForAuthoringV1(controller);
	try {
		assert.equal(videoPreviewAuthoringPausedV1(controller), true); assert.equal(await remainsPending(opening), true);
		release.resolve(); const lease = await opening; await creating; assert.equal(disposed, 1);
		assert.equal(videoPreviewAuthoringPausedV1(controller), true); lease.release(); lease.release(); assert.equal(videoPreviewAuthoringPausedV1(controller), false);
	} finally { release.resolve(); await creating; const lease = await opening; lease.release(); unregister(); await owner.close(); }
});

test('a failed pause subscriber still joins every accepted preview before release', async () => {
	const controller = {}, entered = deferred<void>(), release = deferred<void>(), reason = Symbol('subscriber failed');
	const unsubscribe = subscribeVideoPreviewAuthoringV1(controller, () => { if (videoPreviewAuthoringPausedV1(controller)) throw reason; });
	const unregister = registerVideoPreviewAuthoringParticipantV1(controller, async () => { entered.resolve(); await release.promise; });
	const work = suspendVideoPreviewForAuthoringV1(controller).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await entered.promise; assert.equal(await remainsPending(work), true); assert.equal(videoPreviewAuthoringPausedV1(controller), true);
		release.resolve(); const result = await work; assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason), true);
		assert.equal(videoPreviewAuthoringPausedV1(controller), false);
	} finally { release.resolve(); await work; unregister(); unsubscribe(); }
});
test('Frame authoring refuses overlapping scopes and resumes the same controller through a new preview epoch', async () => {
	const controller = {}, observed: boolean[] = [], unsubscribe = subscribeVideoPreviewAuthoringV1(controller, () => { observed.push(videoPreviewAuthoringPausedV1(controller)); });
	const first = await suspendVideoPreviewForAuthoringV1(controller), epoch = videoPreviewAuthoringEpochV1(controller);
	try { await assert.rejects(suspendVideoPreviewForAuthoringV1(controller), /already open/u); first.release();
		assert.equal(videoPreviewAuthoringEpochV1(controller), epoch + 1); const next = await suspendVideoPreviewForAuthoringV1(controller); next.release();
		assert.deepEqual(observed, [true, false, true, false]); } finally { first.release(); unsubscribe(); }
});
test('Frame suspension joins all retirements before returning the exact failure and reopening admission', async () => {
	const controller = {}, entered = deferred<void>(), release = deferred<void>(), reason = Symbol('native retirement');
	const one = registerVideoPreviewAuthoringParticipantV1(controller, () => Promise.reject(reason));
	const two = registerVideoPreviewAuthoringParticipantV1(controller, async () => { entered.resolve(); await release.promise; });
	const work = suspendVideoPreviewForAuthoringV1(controller).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try { await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); const result = await work;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason), true); assert.equal(videoPreviewAuthoringPausedV1(controller), false);
	} finally { release.resolve(); await work; one(); two(); }
});
test('Frame suspension checks opaque pre-abort before observing or retiring preview participants', async () => {
	const controller = {}, stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy); let called = 0;
	const unregister = registerVideoPreviewAuthoringParticipantV1(controller, () => { called++; return Promise.resolve(); });
	try { const result = await suspendVideoPreviewForAuthoringV1(controller, stop.signal).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason.proxy), true); assert.equal(called, 0); assert.equal(videoPreviewAuthoringPausedV1(controller), false);
	} finally { unregister(); }
});
