/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/clip-video/exact-preview-render-coordinator.ts';

function unexpected(_value?: unknown): never { assert.fail('Unexpected coordinator callback.'); }

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>(complete => { resolve = complete; });
	return { promise, resolve };
}

void test('a seek during an exact render discards the old frame and requests the latest frame once', async () => {
	const oldFrame = deferred<number>();
	let redraws = 0;
	const published: number[] = [];
	const coordinator = createExactPreviewRenderCoordinator(() => { redraws += 1; });
	const request = { isCurrent: () => true, publish: (frame: number) => { published.push(frame); }, onError: (error: unknown) => assert.fail(String(error)) };
	const pending = coordinator.run({ ...request, render: () => oldFrame.promise });
	assert.equal(coordinator.deferWhileActive(), true);
	await coordinator.run({ ...request, render: async () => { assert.fail('renders must stay serial'); } });
	await coordinator.run({ ...request, render: async () => { assert.fail('coalesce further redraws'); } });
	oldFrame.resolve(0);
	await pending;
	assert.deepEqual(published, []);
	assert.equal(redraws, 1);
	assert.equal(coordinator.deferWhileActive(), false);
	await coordinator.run({ ...request, render: async () => 6400 });
	assert.deepEqual(published, [6400]);
	assert.equal(redraws, 1);
});

void test('a replaced visual session cannot publish its completion and requests a fresh draw', async () => {
	const frame = deferred<number>();
	let current = true;
	let redraws = 0;
	const coordinator = createExactPreviewRenderCoordinator(() => { redraws += 1; });
	const pending = coordinator.run({ render: () => frame.promise, isCurrent: () => current,
		publish: () => assert.fail('old session must not publish'), onError: (error: unknown) => assert.fail(String(error)) });
	current = false;
	frame.resolve(0);
	await pending;
	assert.equal(redraws, 1);
});

void test('render failure releases the slot and permits a subsequent exact frame', async () => {
	const errors: unknown[] = [];
	const failure = new Error('render failed');
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('no redraw is pending'));
	await coordinator.run({ render: () => { throw failure; }, isCurrent: () => true,
		publish: unexpected, onError: error => { errors.push(error); } });
	assert.deepEqual(errors, [failure]);
	let published = false;
	await coordinator.run({ render: async () => 1, isCurrent: () => true,
		publish: () => { published = true; }, onError: (error: unknown) => assert.fail(String(error)) });
	assert.equal(published, true);
});

void test('continuous clock demand publishes the held current frame and coalesces one latest redraw', async () => {
	const held = deferred<number>();
	let redraws = 0;
	const published: number[] = [];
	const epoch = Object.freeze({ project: 1, resources: 1, viewport: 1, seek: 1 });
	const coordinator = createExactPreviewRenderCoordinator(() => { redraws += 1; }, { mode: 'continuous' });
	const callbacks = { isCurrent: () => epoch.project === 1, publish: (frame: number) => { published.push(frame); }, onError: unexpected };
	const running = coordinator.run({ ...callbacks, render: () => held.promise });
	for (let frame = 1; frame <= 100; frame += 1) assert.equal(coordinator.deferWhileActive(), true);
	held.resolve(10);
	await running;
	assert.deepEqual(published, [10]);
	assert.equal(redraws, 1);
	await coordinator.run({ ...callbacks, render: () => 110 });
	assert.deepEqual(published, [10, 110]);
	assert.equal(redraws, 1);
});

void test('continuous hard-epoch supersession aborts and joins the held frame before host replacement', async () => {
	const body = deferred<void>(), cleanup = deferred<void>();
	let signal: AbortSignal | null = null, cleaned = false, redraws = 0, joined = false;
	const coordinator = createExactPreviewRenderCoordinator(() => { redraws += 1; }, { mode: 'continuous' });
	const running = coordinator.run({
		render: async (stop: AbortSignal) => {
			signal = stop;
			try { await body.promise; stop.throwIfAborted(); return 0; }
			finally { await cleanup.promise; cleaned = true; }
		},
		isCurrent: () => true, publish: () => assert.fail('the replaced hard epoch cannot publish'), onError: unexpected,
	});
	const superseding = coordinator.supersede().then(() => { joined = true; });
	assert.equal((signal as AbortSignal | null)?.aborted, true);
	assert.equal(coordinator.deferWhileActive(), true);
	assert.equal(joined, false);
	body.resolve(); await Promise.resolve(); await Promise.resolve();
	assert.equal(cleaned, false); assert.equal(joined, false); assert.equal(redraws, 0);
	cleanup.resolve(); await Promise.all([running, superseding]);
	assert.equal(cleaned, true); assert.equal(joined, true); assert.equal(redraws, 0);
	let published = false;
	await coordinator.run({ render: () => 1, isCurrent: () => true, publish: () => { published = true; }, onError: unexpected });
	assert.equal(published, true);
});

void test('a hard-epoch join cannot synchronously admit replacement work through an automatic redraw', async () => {
	const held = deferred<void>(), cleanup = deferred<void>(), replacementBody = deferred<void>();
	let replacementReads = 0, redraws = 0, replacement: Promise<void> | null = null;
	const coordinator = createExactPreviewRenderCoordinator(() => {
		redraws += 1;
		replacement = coordinator.run({ render: async () => { replacementReads += 1; await replacementBody.promise; return 2; },
			isCurrent: () => true, publish: () => undefined, onError: unexpected });
	}, { mode: 'continuous' });
	const running = coordinator.run({ render: async signal => {
		try { await held.promise; signal.throwIfAborted(); return 1; } finally { await cleanup.promise; }
	}, isCurrent: () => true, publish: unexpected, onError: unexpected });
	const superseding = coordinator.supersede();
	assert.equal(coordinator.deferWhileActive(), true);
	held.resolve(); await Promise.resolve(); await Promise.resolve(); cleanup.resolve();
	try {
		await Promise.all([running, superseding]);
		assert.equal(replacementReads, 0, 'host resources must remain free until the join returns');
		assert.equal(redraws, 0, 'the host explicitly requests its replacement after the join');
	} finally { replacementBody.resolve(); await replacement; }
	let delivered = false;
	await coordinator.run({ render: () => 3, isCurrent: () => true, publish: () => { delivered = true; }, onError: unexpected });
	assert.equal(delivered, true);
});

void test('finish currentness reentry cannot cross a hard-epoch join with an automatic replacement', async () => {
	const held = deferred<void>();
	let checks = 0, redraws = 0, replacementReads = 0, superseding: Promise<void> | null = null, replacement: Promise<void> | null = null;
	const coordinator = createExactPreviewRenderCoordinator(() => {
		redraws += 1;
		replacement = coordinator.run({ render: async () => { replacementReads += 1; await held.promise; return 2; },
			isCurrent: () => true, publish: () => undefined, onError: unexpected });
	}, { mode: 'continuous' });
	try {
		await coordinator.run({ render: () => 1, isCurrent: () => {
			checks += 1; if (checks === 1) return true;
			superseding = coordinator.supersede(); return false;
		}, publish: () => undefined, onError: unexpected });
		await superseding;
		assert.equal(replacementReads, 0); assert.equal(redraws, 0); assert.equal(checks, 2);
	} finally { held.resolve(); await replacement; }
});

void test('finish currentness reentry preserves a clock demand added after its initial pending check', async () => {
	let checks = 0, redraws = 0, reentry: Promise<void> | null = null;
	const coordinator = createExactPreviewRenderCoordinator(() => { redraws += 1; }, { mode: 'continuous' });
	await coordinator.run({ render: () => 1, isCurrent: () => {
		checks += 1;
		if (checks === 2) reentry = coordinator.run({ render: () => assert.fail('currentness reentry must defer'),
			isCurrent: () => true, publish: unexpected, onError: unexpected });
		return true;
	}, publish: () => undefined, onError: unexpected });
	await reentry;
	assert.equal(checks, 2); assert.equal(redraws, 1);
});

void test('retirement is an idempotent native cancellation join and refuses new work', async () => {
	const body = deferred<void>(), cleanup = deferred<void>();
	const owned = new Uint8Array([1, 2, 3, 4]);
	let signal: AbortSignal | null = null, settled = false;
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('retirement cannot request a redraw'), { mode: 'continuous' });
	const running = coordinator.run({
		render: async (stop: AbortSignal) => {
			signal = stop;
			try { await body.promise; stop.throwIfAborted(); return owned; }
			finally { await cleanup.promise; owned.fill(0); }
		},
		isCurrent: () => true, publish: unexpected, onError: unexpected,
	});
	const retiring = coordinator.retire();
	assert.equal(coordinator.retire(), retiring);
	void retiring.then(() => { settled = true; });
	assert.equal((signal as AbortSignal | null)?.aborted, true);
	body.resolve(); await Promise.resolve(); await Promise.resolve();
	assert.equal(settled, false); assert.deepEqual([...owned], [1, 2, 3, 4]);
	cleanup.resolve(); await Promise.all([running, retiring]);
	assert.deepEqual([...owned], [0, 0, 0, 0]); assert.equal(settled, true);
	await assert.rejects(coordinator.run({ render: () => assert.fail('retired work cannot start'), isCurrent: () => true, publish: unexpected, onError: unexpected }), /retired/u);
});

void test('retirement keeps exact opaque cleanup evidence and never inspects or swallows it', async () => {
	const body = deferred<void>(), cleanup = deferred<void>();
	let traps = 0;
	const failure = new Proxy({}, {
		get() { traps += 1; throw new Error('opaque get'); },
		getPrototypeOf() { traps += 1; throw new Error('opaque prototype'); },
		getOwnPropertyDescriptor() { traps += 1; throw new Error('opaque descriptor'); },
		ownKeys() { traps += 1; throw new Error('opaque keys'); },
	});
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('failed retirement cannot redraw'), { mode: 'continuous' });
	const failCleanup = async () => { await cleanup.promise; throw failure; };
	const running = coordinator.run({
		render: async () => { try { await body.promise; return 1; } finally { await failCleanup(); } },
		isCurrent: () => true, publish: unexpected, onError: unexpected,
	});
	const retiring = coordinator.retire();
	const observed = retiring.then(() => ({ rejected: false, reason: undefined as unknown }), reason => ({ rejected: true, reason: reason as unknown }));
	body.resolve(); await Promise.resolve(); await Promise.resolve();
	cleanup.resolve(); await running;
	const outcome = await observed;
	assert.equal(outcome.rejected, true); assert.equal(outcome.reason, failure); assert.equal(traps, 0);
	assert.equal(coordinator.retire(), retiring);
});

void test('supersession retains null cleanup evidence and prevents replacement admission', async () => {
	const held = deferred<void>();
	let replacementReads = 0;
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('failed hard-epoch cleanup cannot redraw'), { mode: 'continuous' });
	const running = coordinator.run({ render: async () => { await held.promise; throw null; },
		isCurrent: () => true, publish: unexpected, onError: unexpected });
	const superseding = coordinator.supersede();
	const observation = superseding.then(() => ({ rejected: false, reason: undefined as unknown }), reason => ({ rejected: true, reason: reason as unknown }));
	held.resolve(); await running;
	assert.deepEqual(await observation, { rejected: true, reason: null });
	const blocked = coordinator.run({ render: () => { replacementReads += 1; return 1; }, isCurrent: () => true, publish: unexpected, onError: unexpected });
	const blockedObservation = blocked.then(() => ({ rejected: false, reason: undefined as unknown }), reason => ({ rejected: true, reason: reason as unknown }));
	assert.deepEqual(await blockedObservation, { rejected: true, reason: null });
	assert.equal(replacementReads, 0);
});

void test('continuous render errors remain ordinary current-frame diagnostics and permit the next frame', async () => {
	const held = deferred<void>(), failure = Object.freeze({ decodeFailure: true });
	const errors: unknown[] = [];
	let redraws = 0, delivered = false;
	const coordinator = createExactPreviewRenderCoordinator(() => { redraws += 1; }, { mode: 'continuous' });
	const running = coordinator.run({ render: async () => { await held.promise; throw failure; }, isCurrent: () => true,
		publish: unexpected, onError: error => { errors.push(error); } });
	coordinator.deferWhileActive(); held.resolve(); await running;
	assert.equal(errors[0], failure); assert.equal(redraws, 1);
	await coordinator.run({ render: () => 1, isCurrent: () => true, publish: () => { delivered = true; }, onError: unexpected });
	assert.equal(delivered, true); await coordinator.retire();
});

void test('borrowed request callbacks retain their original identities and receiver across a held frame', async () => {
	const held = deferred<number>();
	let checked = 0, delivered = 0;
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('no redraw expected'), { mode: 'continuous' });
	const request = {
		render() { assert.equal(this, request); return held.promise; },
		isCurrent() { assert.equal(this, request); checked += 1; return true; },
		publish(frame: number) { assert.equal(this, request); delivered = frame; },
		onError() { assert.fail('no error expected'); },
	};
	const running = coordinator.run(request);
	request.isCurrent = () => assert.fail('replacement callback cannot be observed');
	request.publish = () => assert.fail('replacement publisher cannot be observed');
	request.onError = () => assert.fail('replacement diagnostic cannot be observed');
	held.resolve(7); await running;
	assert.equal(delivered, 7); assert.equal(checked, 2);
});

void test('synchronous borrowed-callback reentry remains one active frame and one clock redraw', async () => {
	let renders = 0, redraws = 0, delivered = 0;
	const coordinator = createExactPreviewRenderCoordinator(() => { redraws += 1; }, { mode: 'continuous' });
	let reentry: Promise<void> | null = null;
	await coordinator.run({ render: () => {
		renders += 1;
		reentry = coordinator.run({ render: () => assert.fail('reentry cannot open another frame'), isCurrent: () => true, publish: unexpected, onError: unexpected });
		return 5;
	}, isCurrent: () => true, publish: frame => { delivered = frame; }, onError: unexpected });
	await reentry;
	assert.equal(renders, 1); assert.equal(delivered, 5); assert.equal(redraws, 1);
});

void test('retirement during the currentness callback fences publication despite a true return', async () => {
	let retirement: Promise<void> | null = null;
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('retired callback cannot redraw'), { mode: 'continuous' });
	await coordinator.run({ render: () => 1, isCurrent: () => { retirement = coordinator.retire(); return true; }, publish: unexpected, onError: unexpected });
	await retirement;
});

void test('a successfully published frame keeps delivered ownership when its publisher retires the owner', async () => {
	const pixels = new Uint8Array([9, 8, 7, 6]);
	let retirement: Promise<void> | null = null, delivered: Uint8Array | null = null;
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('retired publisher cannot redraw'), { mode: 'continuous' });
	await coordinator.run({ render: () => pixels, isCurrent: () => true, publish: frame => {
		delivered = frame; retirement = coordinator.retire();
	}, onError: unexpected });
	await retirement;
	assert.equal(delivered, pixels); assert.deepEqual([...pixels], [9, 8, 7, 6]);
});

void test('continuous mode is a closed fixed option and refuses accessor or future options before calls', () => {
	let reads = 0;
	const redraw = () => { reads += 1; };
	assert.throws(() => createExactPreviewRenderCoordinator(redraw, { get mode() { reads += 1; return 'continuous' as const; } }), /own data property/u);
	assert.throws(() => createExactPreviewRenderCoordinator(redraw, { mode: 'future' as 'continuous' }), /Unsupported/u);
	assert.throws(() => createExactPreviewRenderCoordinator(redraw, { mode: 'continuous', future: true } as { mode: 'continuous' }), /field/u);
	assert.equal(reads, 0);
});
