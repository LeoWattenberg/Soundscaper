/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearDevelopMetadataCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskContextCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskOverlayCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-plan-current-v1.ts';
import { withPixelFrameWebGl2MaskOverlayCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-current-v1.ts';
import { prepareImageDevelopGpuMaskPhasePlanCurrentV1 } from '../src/common/editor/imaging/image-develop-gpu-mask-phase-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskedExecutionCurrentV1 as prepare, claimPixelFrameWebGl2MaskedExecutionCurrentV1 as claim } from '../src/common/editor/imaging/pixel-frame-webgl2-masked-execution-current-v1.ts';
import { withPixelFrameWebGl2MaskReceiptsCurrentV1 as withReceipts, assertPixelFrameWebGl2MaskReceiptsCurrentV1 as assertReceipts } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-checkpoint-current-v1.ts';
import { openPixelFrameWebGl2ContextCurrentV1 as open, PixelFrameWebGl2UnavailableCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts';

const graph = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [{ id: 'a', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'a' };
function plans(id = 'tone', selected = false, enabled = true) {
	const frame = { descriptor: { schemaVersion: 1 as const, width: 4, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const },
		get pixels(): never { return assert.fail('Token metadata admission may not access source pixels.'); } };
	const metadata = prepareLinearDevelopMetadataCurrentV1({ frame, develop: { ...defaultImageDevelopStateV2(),
		effects: [{ id, type: 'tone-ladder-v1', enabled, params: { exposure: 1 } }], masks: [graph], maskBindings: [{ maskId: 'mask', effectId: id }] },
		...(selected ? { maskOverlay: { maskId: 'mask', effectId: id } } : {}) }, PROFILE, {});
	const checkpoints = preparePixelFrameWebGl2MaskPlanCurrentV1(metadata), context = preparePixelFrameWebGl2MaskContextCurrentV1(checkpoints);
	const overlay = selected ? preparePixelFrameWebGl2MaskOverlayCurrentV1(checkpoints) : undefined;
	const phase = prepareImageDevelopGpuMaskPhasePlanCurrentV1(checkpoints, context, overlay);
	return { frame, checkpoints, context, overlay, phase };
}
const rejectsExact = async (task: Promise<unknown>, reason: unknown) => {
	const result = await task.then(value => ({ value }), (error: unknown) => ({ error }));
	assert.ok('error' in result && Object.is(result.error, reason));
};
const opaque = () => { const reason = Proxy.revocable({}, {}); reason.revoke(); return reason.proxy as unknown; };

test('native masked token captures source check receiver and exact phase/receipt/pass identities before canvas', async () => {
	const p = plans(), reason = opaque(), receivers: unknown[] = []; let checks = 0;
	await rejectsExact(withReceipts(p.checkpoints, receipts => {
		const request = { phase: p.phase, receipts, checkCurrent() { receivers.push(this); checks++; } }, token = prepare(request);
		request.checkCurrent = () => assert.fail('A later method mutation cannot replace the captured source fence.');
		const accepted = claim(token, p.checkpoints.sourceDescriptor, p.checkpoints.passes);
		assert.equal(accepted.phaseValue, p.phase); assert.equal(accepted.receipts, receipts); assert.equal(accepted.checkpointPlan, p.checkpoints);
		assert.ok(receivers.every(receiver => receiver === request)); assert.ok(checks >= 2); assert.ok(Object.isFrozen(token));
		assert.throws(() => claim(token, p.checkpoints.sourceDescriptor, p.checkpoints.passes), TypeError); throw reason;
	}), reason);
});

test('forged or revoked token is refused by actual native open before source pixels, readback or canvas creation', async () => {
	const p = plans(), revoked = Proxy.revocable({}, {}); revoked.revoke();
	let canvases = 0; const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
	Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, get(): never { canvases++; return assert.fail('Forged execution may not create a canvas.'); } });
	try {
		const lookalike = { kind: 'native-masked-execution-current-v1' as const };
		await assert.rejects(open(p.frame, p.checkpoints.passes, () => assert.fail('Readback must remain closed.'), undefined, undefined, lookalike), TypeError);
		assert.throws(() => claim(revoked.proxy, p.checkpoints.sourceDescriptor, p.checkpoints.passes), TypeError); assert.equal(canvases, 0);
	} finally { if (original) Object.defineProperty(globalThis, 'OffscreenCanvas', original); else Reflect.deleteProperty(globalThis, 'OffscreenCanvas'); }
});

test('same-shape different authored receipt scope cannot authorize the native token and latches its own protocol failure', async () => {
	const first = plans('first'), other = plans('other');
	await assert.rejects(withReceipts(first.checkpoints, receipts => {
		assert.throws(() => prepare({ phase: other.phase, receipts, checkCurrent() {} }), TypeError);
		// Catching a genuine receipt-owner protocol error does not authorize reuse.
		assert.throws(() => assertReceipts(receipts, first.checkpoints), TypeError);
	}), TypeError);
});

test('token claim checks the complete private stage chain before accepting a compatible-looking native source', async () => {
	const p = plans(), reason = opaque();
	await rejectsExact(withReceipts(p.checkpoints, receipts => {
		const token = prepare({ phase: p.phase, receipts, checkCurrent() {} });
		assert.throws(() => claim(token, { ...p.checkpoints.sourceDescriptor, width: 2 }, p.checkpoints.passes), TypeError);
		const copied = { ...token }; assert.throws(() => claim(copied, p.checkpoints.sourceDescriptor, p.checkpoints.passes), TypeError);
		throw reason;
	}), reason);
});

test('selected token requires the genuine empty overlay owner associated with the same exact suffix plan', async () => {
	const p = plans('tone', true), reason = opaque(); assert.ok(p.overlay);
	await rejectsExact(withPixelFrameWebGl2MaskOverlayCurrentV1(p.overlay, overlay => withReceipts(p.checkpoints, receipts => {
		const token = prepare({ phase: p.phase, receipts, overlay, checkCurrent() {} });
		assert.equal(claim(token, p.checkpoints.sourceDescriptor, p.checkpoints.passes).checkpoints.executedCheckpoints[0]!.selected, true);
		throw reason;
	})), reason);
});

test('zero-execution declarations keep the old native path and cannot allocate an uncharged receipt attempt', () => {
	const p = plans('off', false, false); assert.equal(p.checkpoints.executedCheckpoints.length, 0); assert.equal(p.phase.receiptBytes, 0);
	assert.throws(() => prepare({ phase: p.phase, receipts: {}, checkCurrent() {} }), /Declared-only/u);
});

test('thrown native unavailability crosses unfinished proof scopes unchanged while a missing successful proof remains fatal', async () => {
	const p = plans('tone', true), reason = new PixelFrameWebGl2UnavailableCurrentV1('mask-mixed-sampler-unavailable'); assert.ok(p.overlay);
	await rejectsExact(withPixelFrameWebGl2MaskOverlayCurrentV1(p.overlay, () => withReceipts(p.checkpoints, () => { throw reason; })), reason);
	await assert.rejects(withReceipts(p.checkpoints, () => undefined), /without complete CPU proof/u);
});
