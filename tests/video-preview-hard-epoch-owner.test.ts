/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/clip-video/exact-preview-render-coordinator.ts';
import { createVideoPreviewHardEpochOwner } from '../src/common/editor/controller/clip-video/video-preview-hard-epoch-owner.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('explicit supersession joins the held actual frame before admitting only the latest redraw', async () => {
	const held = deferred<void>(), entered = deferred<void>(); let redraws = 0, publishes = 0, clockRedraws = 0;
	const coordinator = createExactPreviewRenderCoordinator(() => { clockRedraws++; }, { mode: 'continuous' });
	const owner = createVideoPreviewHardEpochOwner(coordinator, () => { assert.equal(owner.mayRender(), true); redraws++; });
	const frame = coordinator.run({ render: async signal => { entered.resolve(); await held.promise; signal.throwIfAborted(); return 1; },
		isCurrent: () => true, publish: () => { publishes++; }, onError: () => assert.fail('Canceled frame must not publish.') });
	try {
		await entered.promise; coordinator.deferWhileActive();
		const first = owner.supersede(), latest = owner.supersede(); assert.equal(owner.mayRender(), false);
		assert.equal(await remainsPending(latest), true); assert.equal(redraws, 0); held.resolve();
		await frame; await first; await latest; assert.equal(publishes, 0); assert.equal(clockRedraws, 0); assert.equal(redraws, 0);
		assert.equal(owner.mayRender(), false); assert.equal(owner.resume(), true); assert.equal(redraws, 1);
		await owner.retire(); assert.equal(owner.mayRender(), false);
	} finally { held.resolve(); await frame; await owner.retire(); }
});

test('opaque frame retirement failure blocks replacement and remains sticky through joined cached retirement', async () => {
	const held = deferred<void>(), entered = deferred<void>(); let traps = 0, redraws = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const coordinator = createExactPreviewRenderCoordinator(() => undefined, { mode: 'continuous' });
	const owner = createVideoPreviewHardEpochOwner(coordinator, () => { redraws++; });
	const frame = coordinator.run({ render: async () => { entered.resolve(); await held.promise; throw reason; },
		isCurrent: () => true, publish: () => assert.fail('No frame'), onError: () => assert.fail('No stale diagnostic') });
	await entered.promise;
	const retiring = owner.supersede(), outcome = retiring.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	held.resolve(); await frame; assert.equal((await outcome).error, reason);
	const closing = owner.retire(); assert.equal(owner.retire(), closing);
	assert.equal((await closing.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }))).error, reason);
	assert.equal(owner.mayRender(), false); assert.equal(redraws, 0); assert.equal(traps, 0);
});

test('retirement admission is installed before a native port synchronously reenters it', async () => {
	const held = deferred<void>(); let nested: Promise<void> | undefined, calls = 0;
	const port = { supersede: () => Promise.resolve(), retire: () => { calls++; nested = owner.retire(); return held.promise; } };
	const owner = createVideoPreviewHardEpochOwner(port, () => undefined);
	const closing = owner.retire(); assert.equal(nested, closing); assert.equal(calls, 1); assert.equal(owner.mayRender(), false);
	assert.equal(await remainsPending(closing), true); held.resolve(); await closing;
});

test('a borrowed redraw must not open a replacement frame before the caller joins hard retirement', async () => {
	const held = deferred<void>(), entered = deferred<void>(), replacementHeld = deferred<void>(); let replacementStarts = 0;
	const coordinator = createExactPreviewRenderCoordinator(() => undefined, { mode: 'continuous' });
	let replacement: Promise<void> | undefined;
	const owner = createVideoPreviewHardEpochOwner(coordinator, () => {
		replacement = coordinator.run({ render: async () => { replacementStarts++; await replacementHeld.promise; return 2; },
			isCurrent: () => true, publish: () => undefined, onError: () => undefined });
	});
	const old = coordinator.run({ render: async signal => { entered.resolve(); await held.promise; signal.throwIfAborted(); return 1; },
		isCurrent: () => true, publish: () => assert.fail('No old frame'), onError: () => assert.fail('No stale error') });
	try {
		await entered.promise; const joining = owner.supersede(); held.resolve(); await joining;
		assert.equal(replacementStarts, 0);
		assert.equal(owner.resume(), true); assert.equal(replacementStarts, 1);
	} finally { held.resolve(); replacementHeld.resolve(); await old; await replacement; await owner.retire(); }
});

test('distinct primary and retirement failures retain exactly their two original values', async () => {
	const primary = Object.freeze({ primary: true }), cleanup = Object.freeze({ cleanup: true });
	const owner = createVideoPreviewHardEpochOwner({ supersede: () => Promise.reject(primary), retire: () => Promise.reject(cleanup) }, () => undefined);
	assert.equal((await owner.supersede().then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }))).error, primary);
	const result = await owner.retire().then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.ok(result.error instanceof AggregateError); assert.deepEqual(result.error.errors, [primary, cleanup]);
});
