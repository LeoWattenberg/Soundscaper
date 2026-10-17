/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { LinearDevelopOwnerV1 } from '../src/common/editor/imaging/image-develop-linear-owner-v1.ts';
import { preparePixelFrameWebGl2RepairCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-repair-current-v1.ts';
import { replayPixelFrameWebGl2RepairPrefixCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-repair-reference-current-v1.ts';
import { validatePixelFrameWebGl2ReferenceCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-reference-current-v1.ts';
import { preparePixelFrameWebGl2RepairExecutionCurrentV1, claimPixelFrameWebGl2RepairExecutionCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-repair-execution-current-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskContextCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { prepareImageDevelopGpuMaskPhasePlanCurrentV1 } from '../src/common/editor/imaging/image-develop-gpu-mask-phase-plan-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
function fixture(width = 10, height = 5) {
	const pixels = new Float32Array(width * height * 4); for (let at = 3; at < pixels.length; at += 4) pixels[at] = 1;
	if (width === 10) {
		for (let y = 1; y < 4; y++) for (let x = 0; x < 4; x++) pixels.set([-2, -2, -2, 1], (y * width + x) * 4);
		for (const [x, y] of [[8, 2], [7, 1], [7, 3]]) pixels.set([4, 4, 4, 1], (y! * width + x!) * 4);
	}
	return { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
}
const repairs = (radius = .15) => ({ schemaVersion: 1, spots: [{ id: 'repair', mode: 'heal', enabled: true, target: { x: .7, y: .5 }, source: { x: .2, y: .5 }, radius, feather: 0, opacity: 1 }] });
function phase(frame: ReturnType<typeof fixture>) {
	const develop = { ...defaultImageDevelopStateV2(), processVersion: 3, repairs: repairs(), effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } }] };
	const metadata = prepareLinearDevelopMetadataCurrentV1({ frame, develop }, PROFILE, {}), checkpoints = preparePixelFrameWebGl2MaskPlanCurrentV1(metadata);
	const context = preparePixelFrameWebGl2MaskContextCurrentV1(checkpoints); return { develop, checkpoints, plan: prepareImageDevelopGpuMaskPhasePlanCurrentV1(checkpoints, context) };
}
test('repair replay uses only two native planes and retires Float64 scratch before later stages', async () => {
	const frame = fixture(), prefix = preparePixelFrameWebGl2RepairCurrentV1(repairs(), frame.descriptor), bytes = frame.pixels.byteLength;
	const owner = new LinearDevelopOwnerV1(0, bytes * 2 + prefix.scratchBytes); let initial: Float32Array<ArrayBuffer> | undefined, delivered: Float32Array<ArrayBuffer> | undefined;
	await owner.run(async () => {
		initial = owner.floats(frame.pixels.length); initial.set(frame.pixels); const descriptor = frame.descriptor;
		const current = await replayPixelFrameWebGl2RepairPrefixCurrentV1(prefix, { descriptor, pixels: initial }, owner, () => {}); delivered = current.pixels;
		assert.equal(current.descriptor, descriptor); assert.ok(initial.every(n => n === 0));
		assert.deepEqual([...current.pixels.slice(104, 108)], [1, 1, 1, 1]); assert.deepEqual([...current.pixels.slice(108, 112)], [3, 3, 3, 1]);
		// A complete next plane and the complete scratch fit again only after old
		// initial/S retired. No third native plane is granted by this owner.
		const next = owner.floats(frame.pixels.length), scratch = owner.bytes(prefix.scratchBytes); next.set(current.pixels); owner.retire(scratch.buffer); owner.retire(next.buffer);
	});
	assert.ok(delivered?.every(n => n === 0)); assert.equal(frame.pixels[104], 0); frame.pixels.fill(0);
});
test('complete native reference applies genuine repair prefix before the authored tone stage', async () => {
	const frame = fixture(), f = phase(frame); let result: Float32Array<ArrayBuffer> | undefined;
	try {
		result = await withImageDevelopLinearCurrentV1({ frame, develop: f.develop }, output => output.pixels.slice(), PROFILE);
		assert.deepEqual([...result.slice(104, 108)], [.5, .5, .5, 1]); assert.deepEqual([...result.slice(108, 112)], [1.5, 1.5, 1.5, 1]);
		assert.equal(await validatePixelFrameWebGl2ReferenceCurrentV1(frame, { descriptor: frame.descriptor, pixels: result }, f.checkpoints.passes, () => {}, undefined, undefined, f.plan), true);
		let observed = false; const hostile = Object.defineProperty({ descriptor: frame.descriptor }, 'pixels', { enumerable: true, get() { observed = true; throw new Error('pixels'); } });
		await assert.rejects(validatePixelFrameWebGl2ReferenceCurrentV1(frame, hostile as typeof frame, f.checkpoints.passes, () => {}, undefined, undefined, { ...f.plan }), /enrolled|phase/iu); assert.equal(observed, false);
	} finally { result?.fill(0); frame.pixels.fill(0); }
});
test('private repair native attempt pins exact phase/receiver and admits one source/pass claim', () => {
	const frame = fixture(), f = phase(frame); let checks = 0;
	const request = { phase: f.plan, checkCurrent() { assert.equal(this, request); checks++; } };
	const token = preparePixelFrameWebGl2RepairExecutionCurrentV1(request), claimed = claimPixelFrameWebGl2RepairExecutionCurrentV1(token, frame.descriptor, f.checkpoints.passes);
	assert.equal(claimed.phase, f.plan); assert.equal(claimed.repairPrefix, f.plan.repairPrefix); assert.ok(checks >= 2);
	assert.throws(() => claimPixelFrameWebGl2RepairExecutionCurrentV1(token, frame.descriptor, f.checkpoints.passes), /claimed/iu);
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); assert.throws(() => claimPixelFrameWebGl2RepairExecutionCurrentV1(revoked.proxy, frame.descriptor, []), /private/iu);
	assert.throws(() => preparePixelFrameWebGl2RepairExecutionCurrentV1({ ...request, phase: { ...f.plan } }), /enrolled|phase/iu); frame.pixels.fill(0);
});
test('actual Jacobi cancellation joins prefix owner and wipes both native planes and serial scratch', async () => {
	const frame = fixture(128, 128); for (let at = 0; at < frame.pixels.length; at += 4) frame.pixels.set([2, 2, 2, 1], at);
	const prefix = preparePixelFrameWebGl2RepairCurrentV1(repairs(.2), frame.descriptor), owner = new LinearDevelopOwnerV1(0, frame.pixels.byteLength * 2 + prefix.scratchBytes);
	const owned: (Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>)[] = [];
	const floats = owner.floats.bind(owner), bytes = owner.bytes.bind(owner);
	owner.floats = length => { const view = floats(length); owned.push(view); return view; };
	owner.bytes = length => { const view = bytes(length); owned.push(view); return view; };
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); let initial: Float32Array<ArrayBuffer> | undefined;
	const timer = setTimeout(() => { stop.abort(opaque.proxy); }, 0);
	try {
		const outcome = await owner.run(async () => { initial = owner.floats(frame.pixels.length); initial.set(frame.pixels); return replayPixelFrameWebGl2RepairPrefixCurrentV1(prefix, { descriptor: frame.descriptor, pixels: initial }, owner, () => {}, stop.signal); })
			.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(outcome.ok, false); if (outcome.ok) assert.fail('Cancelled native prefix escaped.'); assert.equal(Object.is(outcome.error, opaque.proxy), true);
		assert.ok(initial?.every(n => n === 0)); assert.equal(owned.length, 3);
		assert.ok(owned.every(view => view.every(n => n === 0))); assert.equal(frame.pixels[0], 2);
	} finally { clearTimeout(timer); frame.pixels.fill(0); }
});
