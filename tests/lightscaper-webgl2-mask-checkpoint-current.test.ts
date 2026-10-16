/* SPDX-License-Identifier: AGPL-3.0-only */
// Unit proof transport uses synthetic stripes; native GL execution is covered separately.
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearDevelopMetadataCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { withPixelFrameWebGl2MaskReceiptsCurrentV1 as withReceipts, capturePixelFrameWebGl2MaskCheckpointCurrentV1 as capture,
	capturePixelFrameWebGl2MaskOverlayCurrentV1 as captureOverlay, sealPixelFrameWebGl2MaskCheckpointsCurrentV1 as seal,
	verifyPixelFrameWebGl2MaskCheckpointCurrentV1 as verify, verifyPixelFrameWebGl2MaskOverlayCurrentV1 as verifyOverlay,
	finishPixelFrameWebGl2MaskCheckpointsCurrentV1 as finish, pixelFrameWebGl2MaskReceiptWorkingBytesCurrentV1 as fee } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-checkpoint-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

function plan(width = 3, height = 1, selected = false) {
	const effects = [createVideoEffect('tone-ladder-v1', { id: 'declared', enabled: false }),
		createVideoEffect('tone-ladder-v1', { id: 'active', params: { exposure: 1 } }),
		createVideoEffect('tone-ladder-v1', { id: 'selected', enabled: false })];
	const frame = { descriptor: { schemaVersion: 1, width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
		get pixels(): never { return assert.fail('Receipt metadata may not inspect a native image.'); } };
	const metadata = prepareLinearDevelopMetadataCurrentV1({ frame, develop: { ...defaultImageDevelopStateV2(), effects,
		masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [{ id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'gradient' }],
		maskBindings: effects.map(effect => ({ effectId: effect.id, maskId: 'local' })) },
		...(selected ? { maskOverlay: { effectId: 'selected', maskId: 'local' } } : {}) }, PROFILE, {});
	return preparePixelFrameWebGl2MaskPlanCurrentV1(metadata);
}
const reader = (bytes: Uint8Array, width: number) => (top: number, rows: number, target: Uint8Array<ArrayBuffer>) => {
	target.set(bytes.subarray(top * width, (top + rows) * width));
};
const extent = (value: Readonly<{ width: number; height: number }>) => ({ width: value.width, height: value.height });
const observe = <T>(value: Promise<T>) => value.then(result => ({ result }), (error: unknown) => ({ error }));

test('receipts retain only dense executed checkpoints while binding all authored identities', async () => {
	const p = plan(3, 1, true), bytes = Uint8Array.of(43, 128, 213);
	assert.deepEqual(p.checkpoints.map(c => c.executionIndex), [null, 0, 1]);
	assert.equal(await withReceipts(p, async scope => {
		for (const c of p.executedCheckpoints) await capture(scope, c, extent(c), reader(bytes, 3));
		await captureOverlay(scope, p.executedCheckpoints[1], extent(p.finalDescriptor), reader(bytes, 3)); seal(scope);
		for (const c of p.executedCheckpoints) await verify(scope, c, bytes.slice());
		await verifyOverlay(scope, p.executedCheckpoints[1], bytes.slice()); return finish(scope);
	}), true);
});

test('one changed coverage or selected-overlay byte refuses even if final RGB could be identical', async () => {
	for (const changed of ['coverage', 'overlay']) {
		const p = plan(3, 1, true), bytes = Uint8Array.of(43, 128, 213), other = Uint8Array.of(43, 129, 213);
		assert.equal(await withReceipts(p, async scope => {
			for (const c of p.executedCheckpoints) await capture(scope, c, extent(c), reader(bytes, 3));
			await captureOverlay(scope, p.executedCheckpoints[1], extent(p.finalDescriptor), reader(bytes, 3)); seal(scope);
			for (const c of p.executedCheckpoints) await verify(scope, c, changed === 'coverage' ? other.slice() : bytes.slice());
			await verifyOverlay(scope, p.executedCheckpoints[1], changed === 'overlay' ? other.slice() : bytes.slice()); return finish(scope);
		}), false);
	}
});

test('forged, reordered, duplicate, omitted and wrong-extent receipts are fatal protocol errors', async () => {
	for (const fault of ['clone', 'order', 'duplicate', 'missing', 'extent']) {
		const p = plan(3, 1, true), bytes = Uint8Array.of(43, 128, 213), first = p.executedCheckpoints[0]!;
		await assert.rejects(withReceipts(p, async scope => {
			if (fault === 'clone') await capture(scope, { ...first }, extent(first), reader(bytes, 3));
			else if (fault === 'order') await capture(scope, p.executedCheckpoints[1], extent(first), reader(bytes, 3));
			else if (fault === 'extent') await capture(scope, first, { width: 1, height: 3 }, reader(bytes, 3));
			else { await capture(scope, first, extent(first), reader(bytes, 3)); if (fault === 'duplicate') await capture(scope, first, extent(first), reader(bytes, 3)); }
			seal(scope);
		}), error => error instanceof TypeError || error instanceof RangeError);
	}
});

test('bounded row stripes exclude padding and physically retire every lent scratch view', async () => {
	const p = plan(257, 300), bytes = Uint8Array.from({ length: 257 * 300 }, (_, index) => (Math.floor(index / 257) * 13 + index % 257) % 256);
	const lent: Uint8Array<ArrayBuffer>[] = [], rows: number[] = [];
	assert.equal(await withReceipts(p, async scope => {
		const c = p.executedCheckpoints[0]!;
		await capture(scope, c, extent(c), (top, count, target) => { assert.ok(target.length <= 65536); lent.push(target); rows.push(top); reader(bytes, 257)(top, count, target); });
		seal(scope); await verify(scope, c, bytes); return finish(scope);
	}), true);
	assert.deepEqual(rows, [0, 255]); assert.ok(lent.every(view => view.every(byte => byte === 0)));
	assert.ok(fee(p) < 65536 + 2048, 'The physical receipt fee is stripes + headers + fixed digests, never all checkpoint planes.');
});

test('pre-abort wins before plan reflection and preserves an opaque revoked reason', async () => {
	const reason = Proxy.revocable({}, {}); reason.revoke(); const controller = new AbortController(); controller.abort(reason.proxy);
	const result = await observe(withReceipts(new Proxy({}, { get() { assert.fail('Pre-abort may not read plan fields.'); } }), () => assert.fail('No consumer.'), controller.signal));
	assert.ok('error' in result && Object.is(result.error, reason.proxy));
});

test('ignored child failure is joined and remains fatal even when its rejection was caught', async () => {
	const p = plan(), reason = Proxy.revocable({}, {}); reason.revoke(); let lent: Uint8Array<ArrayBuffer> | undefined;
	const result = await observe(withReceipts(p, scope => {
		void capture(scope, p.executedCheckpoints[0], extent(p.sourceDescriptor), (_top, _rows, target) => { lent = target; target.fill(213); throw reason.proxy; }).catch(() => {});
	}));
	assert.ok('error' in result && Object.is(result.error, reason.proxy)); assert.ok(lent && lent.every(byte => byte === 0));
});

test('missing CPU coverage and selected overlay cannot become a successful proof', async () => {
	const p = plan(3, 1, true), bytes = Uint8Array.of(43, 128, 213);
	await assert.rejects(withReceipts(p, async scope => {
		for (const c of p.executedCheckpoints) await capture(scope, c, extent(c), reader(bytes, 3));
		await captureOverlay(scope, p.executedCheckpoints[1], extent(p.finalDescriptor), reader(bytes, 3)); seal(scope);
		for (const c of p.executedCheckpoints) await verify(scope, c, bytes.slice()); finish(scope);
	}), TypeError);
});


test('abort during a held owner consumer joins that consumer before stripe retirement and preserves its opaque reason', async () => {
	const p = plan(), bytes = Uint8Array.of(43, 128, 213), controller = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	let enter!: () => void, release!: () => void, retained: Uint8Array<ArrayBuffer> | undefined, settled = false;
	const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const work = observe(withReceipts(p, async scope => {
		const c = p.executedCheckpoints[0]!;
		await capture(scope, c, extent(c), (top, rows, target) => { retained = target; reader(bytes, 3)(top, rows, target); });
		seal(scope); await verify(scope, c, bytes.slice()); assert.equal(finish(scope), true); enter(); await held;
	}, controller.signal)).then(result => { settled = true; return result; });
	try {
		await entered; controller.abort(reason.proxy); await Promise.resolve(); assert.equal(settled, false);
		release(); const result = await work; assert.ok('error' in result && Object.is(result.error, reason.proxy));
		assert.ok(retained && retained.every(byte => byte === 0));
	} finally { release(); await work; }
});


test('a detached stripe adds distinct physical retirement failure without hiding an opaque primary', async () => {
	const p = plan(), reason = Proxy.revocable({}, {}); reason.revoke();
	const result = await observe(withReceipts(p, async scope => {
		const c = p.executedCheckpoints[0]!;
		await capture(scope, c, extent(c), (_top, _rows, target) => {
			structuredClone(target.buffer, { transfer: [target.buffer] }); throw reason.proxy;
		});
	}));
	assert.ok('error' in result); const error = result.error;
	assert.ok(!Object.is(error, reason.proxy) && error instanceof AggregateError);
	assert.ok(Object.is(error.cause, reason.proxy));
	assert.ok(error.errors.some((member: unknown) => !Object.is(member, reason.proxy) && member instanceof TypeError));
});
