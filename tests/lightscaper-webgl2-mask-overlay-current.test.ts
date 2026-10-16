/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearDevelopMetadataCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskOverlayCurrentV1 as prepare, readPixelFrameWebGl2MaskOverlayCurrentV1 as read,
	isPixelFrameWebGl2MaskOverlayCurrentV1 as is } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-plan-current-v1.ts';
import { withPixelFrameWebGl2MaskOverlayCurrentV1 as withOverlay, assertPixelFrameWebGl2MaskOverlayStorageCurrentV1 as assertStorage,
	type PixelFrameWebGl2MaskOverlayStorageCurrentV1 as Storage } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_MASK_OVERLAY_FRAGMENT_CURRENT_V1 as fragment } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-glsl-current-v1.ts';
import { imageDevelopMaskTransformsCurrentV1 } from '../src/common/editor/imaging/image-develop-mask-plan-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const geometry = (id: string, params: Readonly<Record<string, number>>) => createVideoEffect('develop-geometry-v1', { id, params });
function checkpoint(effects: readonly unknown[] = [], selected = true, enabled = false, width = 3, height = 1, legacyCrop = false) {
	const frame = { descriptor: { schemaVersion: 1, width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
		get pixels(): never { return assert.fail('Overlay planning must remain metadata-only.'); } };
	return preparePixelFrameWebGl2MaskPlanCurrentV1(prepareLinearDevelopMetadataCurrentV1({ frame,
		develop: { ...defaultImageDevelopStateV2(), ...(legacyCrop ? { geometry: { ...defaultImageDevelopStateV2().geometry, crop: { x: 0, y: 0, width: .5, height: 1 } } } : {}),
			effects: [createVideoEffect('tone-ladder-v1', { id: 'selected', enabled }), ...effects],
			masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [{ id: 'ramp', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'ramp' }],
			maskBindings: [{ effectId: 'selected', maskId: 'mask' }] },
		...(selected ? { maskOverlay: { maskId: 'mask', effectId: 'selected' } } : {}) }, PROFILE, {}));
}

test('overlay requires genuine private checkpoint ownership and exact selected Current suffix capabilities', () => {
	const owner = checkpoint(), plan = prepare(owner), captured = read(plan);
	assert.ok(is(plan)); assert.equal(captured.checkpoint, owner.executedCheckpoints[0]);
	assert.equal(captured.binding, captured.checkpoint.binding);
	assert.equal(captured.suffix, imageDevelopMaskTransformsCurrentV1(captured.binding));
	assert.equal(captured.checkpoint.mode, 'observe'); assert.equal(captured.steps.length, 0);
	assert.throws(() => prepare({ ...owner }), TypeError); assert.throws(() => read({ ...plan }), TypeError);
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); assert.equal(is(revoked.proxy), false);
	assert.throws(() => read(revoked.proxy), TypeError); assert.throws(() => prepare(checkpoint([], false)), RangeError);
});

test('selected coverage starts in its actual incoming-stage extent after legacy geometry, not Original coordinates', () => {
	const owner = checkpoint([], true, false, 4, 1, true), plan = read(prepare(owner));
	assert.equal(owner.sourceDescriptor.width, 4); assert.equal(plan.sourceExtent.width, 2);
	assert.equal(plan.finalExtent.width, 2); assert.equal(plan.steps.length, 0); assert.equal(plan.projectionTextureBytes, 0);
	assert.equal(plan.retainedHostBytes, 2); assert.equal(plan.checkpoint.width, 2);
});

test('geometry/lens suffix retains every warp, incoming extents and byte store boundary in authored order', () => {
	const owner = checkpoint([geometry('clockwise', { rotationDegrees: 90 }),
		createVideoEffect('lens-distortion-v1', { id: 'lens', params: { amount: 52.083333333333336 } }),
		geometry('vertical-flip', { flipVertical: 1 })]);
	const plan = read(prepare(owner));
	assert.deepEqual(plan.steps.map(step => [step.kind, step.source.width, step.source.height, step.output.width, step.output.height]),
		[['geometry', 3, 1, 1, 3], ['lens-distortion', 1, 3, 1, 3], ['geometry', 1, 3, 1, 3]]);
	assert.ok(plan.steps.every((step, index) => step.transform === plan.suffix[index]));
	assert.deepEqual(plan.finalExtent, { width: 1, height: 3 }); assert.equal(plan.maximumSuffixPixels, 3);
	assert.equal(plan.projectionTextureBytes, 6); assert.equal(plan.retainedHostBytes, 3); assert.equal(plan.nativeReadbackBytes, 16);
});

test('disabled geometry and neutral lens are absent from suffix while explicit identity geometry remains a real draw', () => {
	const owner = checkpoint([createVideoEffect('develop-geometry-v1', { id: 'disabled', enabled: false }),
		createVideoEffect('lens-distortion-v1', { id: 'neutral', params: { amount: 0 } }), geometry('identity', {})]);
	const plan = read(prepare(owner)); assert.equal(plan.steps.length, 1); assert.equal(plan.steps[0]!.kind, 'geometry');
	assert.ok(plan.steps[0]!.kind === 'geometry' && plan.steps[0]!.geometry.integerPermutation);
	assert.equal(plan.projectionTextureBytes, 6); assert.equal(plan.retainedHostBytes, 3);
});

test('overlay fees separately charge two maximum byte banks, final host and bounded native integer readback', () => {
	const plan = read(prepare(checkpoint([geometry('grow', { rotationDegrees: 45 })], true, false, 32, 32)));
	assert.equal(plan.projectionTextureBytes, 2 * plan.maximumSuffixPixels);
	assert.equal(plan.retainedHostBytes, plan.finalExtent.width * plan.finalExtent.height);
	assert.equal(plan.nativeReadbackBytes, Math.min(plan.finalExtent.width, 4096) * 16);
	assert.equal(plan.uniformBytes, 128);
	assert.equal(plan.gpuPeakBytes, plan.projectionTextureBytes + plan.retainedHostBytes + plan.nativeReadbackBytes + plan.uniformBytes);
	assert.equal(plan.replayRetainedBytes, plan.retainedHostBytes);
	assert.equal(plan.componentBytes, plan.binding.workingBytes + Math.max(plan.cpuProjectionBytes + plan.retainedHostBytes, plan.gpuPeakBytes));
});

test('R8UI fragment declares typed output, per-warp byte rounding, geometry crop clamping and lens zero extension', () => {
	assert.match(fragment, /uniform highp usampler2D uCoverage/); assert.match(fragment, /out uvec4 outCoverage/);
	assert.match(fragment, /floor\(clamp\(alpha, 0\.0, 255\.0\) \+ 0\.5\)/);
	assert.match(fragment, /clamp\(low \+ ivec2\(dx, dy\), uCropBounds\.xy, uCropBounds\.zw\)/);
	assert.match(fragment, /if \(outsideOverlayCurrentV1\(source\)\) continue/);
	assert.doesNotMatch(fragment, /texture\(/); assert.doesNotMatch(fragment, /out vec4/);
});

test('pre-abort wins before private plan reflection and does not open any projection scope', async () => {
	const reason = Proxy.revocable({}, {}); reason.revoke(); const controller = new AbortController(); controller.abort(reason.proxy);
	const outcome = await withOverlay(new Proxy({}, { get() { assert.fail('Pre-abort must not read plan.'); } }), () => assert.fail('No consumer.'), controller.signal)
		.then(result => ({ result }), (error: unknown) => ({ error }));
	assert.ok('error' in outcome && Object.is(outcome.error, reason.proxy));
});

test('unprojected scopes cannot deliver fabricated CPU overlay bytes', async () => {
	const owner = prepare(checkpoint());
	await assert.rejects(withOverlay(owner, storage => storage.withCoverage(() => assert.fail('No pixels before actual GPU project.'))), TypeError);
	await assert.rejects(withOverlay(owner, () => undefined), TypeError);
});

test('synchronous proof stripes refuse before projection and after owner retirement without inspecting their target', async () => {
	const owner = prepare(checkpoint()); let targetReads = 0;
	const target = new Proxy(new Uint8Array(3), { get() { targetReads++; throw new Error('Proof target inspected before scope admission.'); } });
	const proofReaders: ((top: number, rows: number, bytes: Uint8Array<ArrayBuffer>) => void)[] = [];
	await assert.rejects(withOverlay(owner, storage => {
		proofReaders.push(storage.readStripe); assert.equal(typeof storage.readStripe, 'function');
		assert.throws(() => storage.readStripe(0, 1, target), TypeError);
	}), TypeError);
	const expiredRead = proofReaders[0]; assert.equal(targetReads, 0); assert.ok(expiredRead);
	assert.throws(() => expiredRead(0, 1, target), TypeError); assert.equal(targetReads, 0);
});

test('pre-GL storage guard accepts only the exact empty private owner and its original overlay plan', async () => {
	for (const fault of ['none', 'copied', 'revoked', 'foreign-plan']) {
		const owner = prepare(checkpoint()), marker = Proxy.revocable({}, {}); marker.revoke();
		const result = await withOverlay(owner, storage => {
			assert.equal(assertStorage(storage, owner), undefined); assert.equal(assertStorage(storage, owner), undefined);
			if (fault === 'copied') assert.throws(() => assertStorage({ ...storage }, owner), TypeError);
			if (fault === 'revoked') { const revoked = Proxy.revocable({}, {}); revoked.revoke(); assert.throws(() => assertStorage(revoked.proxy, owner), TypeError); }
			if (fault === 'foreign-plan') { assert.throws(() => assertStorage(storage, prepare(checkpoint())), TypeError); return; }
			throw marker.proxy;
		}).then(value => ({ value }), (error: unknown) => ({ error }));
		assert.ok('error' in result);
		if (fault === 'foreign-plan') assert.ok(result.error instanceof TypeError); else assert.ok(Object.is(result.error, marker.proxy));
	}
});

test('storage entry guard rejects retired owners and preserves live opaque cancellation without reflection', async () => {
	const plan = prepare(checkpoint()), marker = Proxy.revocable({}, {}); marker.revoke();
	const captured: Readonly<Storage>[] = [];
	const first = await withOverlay(plan, storage => { captured.push(storage); throw marker.proxy; })
		.then(value => ({ value }), (error: unknown) => ({ error }));
	assert.ok('error' in first && Object.is(first.error, marker.proxy));
	const expired = captured[0]; assert.ok(expired); assert.throws(() => assertStorage(expired, plan), TypeError);
	const stop = new AbortController(), foreignPlan = prepare(checkpoint());
	const second = await withOverlay(plan, storage => {
		stop.abort(marker.proxy); assert.throws(() => assertStorage(storage, foreignPlan), error => Object.is(error, marker.proxy));
	}, stop.signal).then(value => ({ value }), (error: unknown) => ({ error }));
	assert.ok('error' in second && Object.is(second.error, marker.proxy));
});
