/* SPDX-License-Identifier: AGPL-3.0-only */
// these cases do not replace required actual native/softwareGPU conformance.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { withImageDevelopGpuCurrentV1 } from '../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1 as metadata } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { prepareImageDevelopGpuPlanCurrentV1 as planGpu } from '../src/common/editor/imaging/image-develop-gpu-plan-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { withPreparedBrushMaskResourceV1, type PreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { PixelFrameWebGl2UnavailableCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
const MiB = 1024 * 1024;
const OWNER = new URL('../src/common/editor/imaging/pixel-frame-webgl2-masked-host-current-v1.ts', import.meta.url);
async function host() { assert.ok(existsSync(OWNER), 'The genuine source-capturing masked host is required.'); return import(OWNER.href) as Promise<typeof import('../src/common/editor/imaging/pixel-frame-webgl2-masked-host-current-v1.ts')>; }
const frame = (values: readonly number[] = [.125, .25, .5, .375]) => ({ descriptor: { schemaVersion: 1 as const, width: values.length / 4, height: 1,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: Float32Array.from(values) });
const tone = (enabled = true) => createVideoEffect('tone-ladder-v1', { id: 'tone', enabled, params: { exposure: 1 } });
const gradient = { id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
const graph = (id = 'local', inputs: readonly unknown[] = []) => ({ schemaVersion: 1, id, kind: 'mask', inputs, nodes: [gradient], outputNodeId: 'gradient' });
const develop = (enabled = true) => ({ ...defaultImageDevelopStateV2(), effects: [tone(enabled)], masks: [graph()], maskBindings: [{ effectId: 'tone', maskId: 'local' }] });
const outcome = <Value>(work: Promise<Value>) => work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
function opaque() { const reason = Proxy.revocable({}, {}); reason.revoke(); return reason.proxy; }
async function brush(alpha: number): Promise<Readonly<PreparedBrushMaskResourceV1>> {
	return withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(alpha) }, value => ({ reference: value.reference, bytes: value.bytes.slice() }));
}
function brushDevelop(resource: Readonly<PreparedBrushMaskResourceV1>) {
	return { ...develop(), masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: resource.reference.storageKey }],
		nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }] };
}
function lut() {
	const text = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1', parsed = parseCubeLutV1(text);
	return { bytes: new TextEncoder().encode(text), reference: { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
		byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax } };
}

test('high admission replaces incomplete mask refusal with the complete4MP disjoint phase authority before source reads', () => {
	let samples = 0;
	const source = { descriptor: { ...frame().descriptor, width: 2048, height: 2048, sampleFormat: 'unorm16' }, get pixels(): never { samples++; return assert.fail('No planning pixel access.'); } };
	const authored = { ...develop(), masks: [{ ...graph(), nodes: [gradient, { id: 'feather', kind: 'feather', inputNodeId: 'gradient', radius: 1 }], outputNodeId: 'feather' }] };
	const m = metadata({ frame: source, develop: authored }, PROFILE, {}), gpu = planGpu(m);
	assert.equal(gpu.workingPlanComplete, true); assert.equal(gpu.unsupported, false); assert.equal(gpu.eligible, true); assert.ok(gpu.maskPhase);
	assert.equal(gpu.pipeline.textureBytes, 192 * MiB); assert.equal(gpu.pipeline.referenceBytes, 128 * MiB);
	assert.ok(gpu.peakWorkingBytes > 520 * MiB && gpu.peakWorkingBytes < 521 * MiB); assert.equal(samples, 0);
	assert.equal(gpu.maskPhase.checkpointPlan, gpu.maskPipeline); assert.equal(gpu.maskPhase.contextPlan, gpu.maskContext);
});

test('high physical padding and proxy outer Original stay charged without a needless GPU snapshot', () => {
	const source = { descriptor: { ...frame().descriptor, width: 2048, height: 2048, sampleFormat: 'unorm16' }, get pixels(): never { return assert.fail('No pixels.'); } };
	const authored = { ...develop(), masks: [{ ...graph(), nodes: [gradient, { id: 'feather', kind: 'feather', inputNodeId: 'gradient', radius: 1 }], outputNodeId: 'feather' }] };
	const m = metadata({ frame: source, develop: authored }, PROFILE, {}), gpu = planGpu(m, 600 * MiB); assert.ok(gpu.maskPhase);
	assert.equal(gpu.eligible, false); assert.equal(gpu.maskPhase.directCpuPeakBytes, 768 * MiB); assert.equal(gpu.maskPhase.directCpuEligible, true);
	assert.equal(gpu.maskPhase.attemptedFallbackPeakBytes, 832 * MiB);
	const proxy = planGpu(m); assert.ok(proxy.peakWorkingBytes + 128 * MiB < 768 * MiB, 'The still-borrowed4096² wordOriginal adds128MiB outside this fitted-input ledger.');
	assert.equal(planGpu(m, 600 * MiB + 1).maskPhase?.directCpuEligible, false);
});

test('native source capture precedes held brush I/O, pins its receiver and delivers the exact selected CPU fallback only after retirement', async () => {
	const body = await brush(128), source = frame(), initial = source.pixels.slice(), entered = deferred<void>(), release = deferred<void>();
	let reads = 0, active = 0, deliveries = 0; let borrowed: Float32Array | undefined, coverage: Uint8Array | undefined;
	const port: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); assert.deepEqual(reference, body.reference); assert.equal(active++, 0); reads++;
		try { if (reads === 1) { entered.resolve(); await release.promise; } return await consume(body.bytes); } finally { active--; }
	} };
	const work = withImageDevelopGpuCurrentV1({ frame: source, develop: brushDevelop(body), maskOverlay: { effectId: 'tone', maskId: 'local' } }, (output, execution, overlay) => {
		assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'canvas-unavailable'); assert.equal(active, 0); assert.equal(reads, 2);
		deliveries++; borrowed = output.pixels; assert.ok(overlay); coverage = overlay.coverage; assert.deepEqual([...overlay.coverage], [128]); return [...output.pixels];
	}, PROFILE, { maskSource: port }); const settled = outcome(work);
	try {
		await Promise.race([entered.promise, settled]); assert.equal(reads, 1); assert.equal(await remainsPending(settled), true);
		source.pixels.fill(.75); port.withBytes = () => { throw new Error('Replaced method must not be read.'); }; release.resolve();
		assert.deepEqual(await work, [Math.fround(.125 + 128 / 255 * .125), Math.fround(.25 + 128 / 255 * .25), Math.fround(.5 + 128 / 255 * .5), .375]);
		assert.equal(deliveries, 1); assert.ok(borrowed?.every(value => value === 0)); assert.ok(coverage?.every(value => value === 0));
		assert.deepEqual([...initial], [.125, .25, .5, .375]); assert.deepEqual([...source.pixels], [.75, .75, .75, .75]);
	} finally { release.resolve(); await Promise.allSettled([work]); body.bytes.fill(0); }
});

test('unbound and disabled brush declarations authenticate serially before either native attempt or CPU delivery', async () => {
	const a = await brush(64), b = await brush(192), source = frame(), events: string[] = []; let active = 0;
	const port: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); assert.equal(active++, 0); const value = reference.storageKey === a.reference.storageKey ? a : b;
		assert.equal(reference.storageKey, value.reference.storageKey); events.push(`read:${value.bytes[16]}`);
		try { return await consume(value.bytes); } finally { active--; events.push(`retired:${value.bytes[16]}`); }
	} };
	const authored = { ...develop(false), masks: [graph('local', [{ name: 'unused-bound', kind: 'alpha', sourceRef: a.reference.storageKey }]),
		graph('entirely-unbound', [{ name: 'unused-unbound', kind: 'alpha', sourceRef: b.reference.storageKey }])] };
	try {
		const actual = await withImageDevelopGpuCurrentV1({ frame: source, develop: authored }, (output, execution) => {
			assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'canvas-unavailable'); assert.equal(active, 0); return [...output.pixels];
		}, PROFILE, { maskSource: port });
		assert.deepEqual(actual, [...source.pixels]); assert.deepEqual(events, ['read:64', 'retired:64', 'read:192', 'retired:192', 'read:64', 'retired:64', 'read:192', 'retired:192']);
	} finally { a.bytes.fill(0); b.bytes.fill(0); }
});

test('genuine LUT authentication uses exact repeated identities and releases the port before fallback delivery', async () => {
	const body = lut(), source = frame(), before = source.pixels.slice(); let reads = 0, active = 0;
	const port: CubeLutSourcePortV1 = { async withBytes(reference, consume) { assert.equal(this, port); assert.deepEqual(reference, body.reference); assert.equal(active++, 0); reads++;
		try { return await consume(body.bytes); } finally { active--; } } };
	const authored = { ...develop(), effects: [tone(), createVideoEffectV2('cube-lut-profile-v1', { id: 'lut-a', params: { lut: body.reference } }),
		createVideoEffectV2('cube-lut-profile-v1', { id: 'lut-b', params: { lut: body.reference } })] };
	const actual = await withImageDevelopGpuCurrentV1({ frame: source, develop: authored }, (output, execution) => {
		assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'canvas-unavailable'); assert.equal(active, 0); return [...output.pixels];
	}, PROFILE, { source: port });
	const expected = [.125, .25, .5].map(value => Math.fround(value + 128 / 255 * value));
	assert.deepEqual(actual, [...expected, .375]); assert.equal(reads, 3, 'One uniqueGPUauth plus two unchangedCPUstage borrows.'); assert.deepEqual(source.pixels, before); body.bytes.fill(0);
});

for (const kind of ['brush', 'lut'] as const) for (const failurePhase of ['entry', 'retirement'] as const) test(`public native-unavailable thrown by ${kind} source at ${failurePhase} cannot forge wholeCPU fallback`, async () => {
	const reason = new PixelFrameWebGl2UnavailableCurrentV1('canvas-unavailable'), source = frame(); let reads = 0, deliveries = 0;
	if (kind === 'brush') {
		const body = await brush(128); try {
			const result = await outcome(withImageDevelopGpuCurrentV1({ frame: source, develop: brushDevelop(body) }, () => { deliveries++; }, PROFILE,
				{ maskSource: { async withBytes(_reference, consume) { reads++; if (failurePhase === 'retirement') await consume(body.bytes); throw reason; } } }));
			assert.equal(result.ok, false); if (result.ok) assert.fail('Source errors must reject.'); assert.ok(Object.is(result.error, reason));
		} finally { body.bytes.fill(0); }
	} else {
		const body = lut(), authored = { ...develop(), effects: [tone(), createVideoEffectV2('cube-lut-profile-v1', { id: 'lut', params: { lut: body.reference } })] };
		const result = await outcome(withImageDevelopGpuCurrentV1({ frame: source, develop: authored }, () => { deliveries++; }, PROFILE,
			{ source: { async withBytes(_reference, consume) { reads++; if (failurePhase === 'retirement') await consume(body.bytes); throw reason; } } }));
		assert.equal(result.ok, false); if (result.ok) assert.fail('Source errors must reject.'); assert.ok(Object.is(result.error, reason)); body.bytes.fill(0);
	}
	assert.equal(reads, 1); assert.equal(deliveries, 0);
});

test('unused declaration corruption and a caught repeated source delivery remain fatal without a native/CPU consumer', async () => {
	const body = await brush(128), source = frame(); let deliveries = 0;
	const authored = { ...develop(), masks: [graph('local', [{ name: 'unused', kind: 'alpha', sourceRef: body.reference.storageKey }])] };
	try {
		for (const repeated of [false, true]) {
			const port: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) {
				if (!repeated) { const corrupt = body.bytes.slice(); corrupt[16] = 3; try { return await consume(corrupt); } finally { corrupt.fill(0); } }
				const result = await consume(body.bytes); await Promise.resolve(consume(body.bytes)).catch(() => undefined); return result;
			} };
			await assert.rejects(withImageDevelopGpuCurrentV1({ frame: source, develop: authored }, () => { deliveries++; }, PROFILE, { maskSource: port }));
		}
		assert.equal(deliveries, 0);
	} finally { body.bytes.fill(0); }
});

test('held fallback delivery joins opaque abort once and retires native output and selected overlay afterward', async () => {
	const source = frame(), initial = source.pixels.slice(), stop = new AbortController(), reason = opaque(), entered = deferred<void>(), release = deferred<void>();
	let deliveries = 0; let pixels: Float32Array | undefined, coverage: Uint8Array | undefined;
	const work = withImageDevelopGpuCurrentV1({ frame: source, develop: develop(), maskOverlay: { effectId: 'tone', maskId: 'local' }, signal: stop.signal }, async (output, execution, overlay) => {
		assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'canvas-unavailable'); deliveries++; pixels = output.pixels; assert.ok(overlay); coverage = overlay.coverage;
		entered.resolve(); await release.promise;
	}, PROFILE), settled = outcome(work);
	try {
		await Promise.race([entered.promise, settled]); assert.equal(deliveries, 1); stop.abort(reason); assert.equal(await remainsPending(settled), true);
		assert.ok(pixels?.some(value => value !== 0)); assert.ok(coverage?.some(value => value !== 0)); release.resolve();
		const result = await settled; assert.equal(result.ok, false); if (result.ok) assert.fail('Opaque abort rejects.'); assert.ok(Object.is(result.error, reason));
		assert.ok(pixels?.every(value => value === 0)); assert.ok(coverage?.every(value => value === 0)); assert.deepEqual(source.pixels, initial); assert.equal(deliveries, 1);
	} finally { release.resolve(); await Promise.allSettled([work]); }
});

test('consumer opaque failure and detached-output cleanup remain distinct with no consumer retry', async () => {
	const reason = opaque(), source = frame(); let deliveries = 0;
	const result = await outcome(withImageDevelopGpuCurrentV1({ frame: source, develop: develop(), maskOverlay: { effectId: 'tone', maskId: 'local' } }, output => {
		deliveries++; const buffer = output.pixels.buffer; structuredClone(buffer, { transfer: [buffer] }); throw reason;
	}, PROFILE));
	assert.equal(result.ok, false); if (result.ok) assert.fail('Consumer and cleanup must reject.');
	assert.ok(!Object.is(result.error, reason) && result.error instanceof AggregateError);
	assert.ok(result.error.errors.some((value: unknown) => Object.is(value, reason)));
	assert.ok(result.error.errors.some((value: unknown) => !Object.is(value, reason) && value instanceof TypeError)); assert.equal(deliveries, 1);
});

test('lower host refuses private ineligible or mismatched physical plans before native allocation/source I/O', async () => {
	const api = await host(); let reads = 0, deliveries = 0;
	const small = frame(), m = metadata({ frame: small, develop: develop() }, PROFILE, {}), gpu = planGpu(m); assert.ok(gpu.maskPhase);
	const padded = new Float32Array(new ArrayBuffer(64), 0, 4); padded.set(small.pixels);
	await assert.rejects(api.withPixelFrameWebGl2MaskedHostCurrentV1({ phase: gpu.maskPhase, frame: { ...small, pixels: padded } }, () => { deliveries++; }), RangeError);
	const hugeMetadata = metadata({ frame: { descriptor: { ...small.descriptor, width: 2048, height: 2048, sampleFormat: 'unorm16' }, get pixels(): never { return assert.fail('No metadata samples.'); } },
		develop: { ...develop(), masks: [{ ...graph(), nodes: [gradient, { id: 'feather', kind: 'feather', inputNodeId: 'gradient', radius: 1 }], outputNodeId: 'feather' }] } }, PROFILE, {});
	const huge = planGpu(hugeMetadata, 600 * MiB); assert.ok(huge.maskPhase); assert.equal(huge.maskPhase.eligible, false);
	await assert.rejects(api.withPixelFrameWebGl2MaskedHostCurrentV1({ phase: huge.maskPhase, frame: { descriptor: small.descriptor, get pixels(): never { reads++; return assert.fail('Ineligible phase must refuse before source sample reflection.'); } } }, () => { deliveries++; }), RangeError);
	assert.equal(reads, 0); assert.equal(deliveries, 0);
});

test('opaque preabort wins before private phase, recipe, source and callback access', async () => {
	const api = await host(), reason = opaque(), stop = new AbortController(); stop.abort(reason); let reads = 0;
	const result = await outcome(api.withPixelFrameWebGl2MaskedHostCurrentV1({ signal: stop.signal, get phase(): never { reads++; return assert.fail('No phase.'); },
		get frame(): never { reads++; return assert.fail('No source.'); } }, () => { reads++; }));
	assert.equal(result.ok, false); if (result.ok) assert.fail('Preabort rejects.'); assert.ok(Object.is(result.error, reason)); assert.equal(reads, 0);
});

test('masked CPU fallback retains the complete mixed native recipe and source/overlay oracle', async () => {
	const source = frame([.125, -.25, 2, .5, .25, .375, .5, 1, 9, 8, 7, .75]), before = source.pixels.slice();
	const authored = { ...develop(), effects: [tone(), createVideoEffect('develop-geometry-v1', { id: 'rotate', params: { rotationDegrees: 90 } }),
		createVideoEffect('optical-vignette-v1', { id: 'optical', params: { amount: 100 } }), createVideoEffect('texture-v1', { id: 'spatial', params: { amount: -20 } })] };
	const request = { frame: source, develop: authored, maskOverlay: { effectId: 'tone', maskId: 'local' } };
	const expected = await withImageDevelopLinearCurrentV1(request, (output, overlay) => ({ descriptor: output.descriptor, pixels: [...output.pixels], coverage: [...overlay!.coverage] }), PROFILE);
	let deliveries = 0;
	const actual = await withImageDevelopGpuCurrentV1(request, (output, execution, overlay) => {
		assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'canvas-unavailable'); deliveries++; return { descriptor: output.descriptor, pixels: [...output.pixels], coverage: [...overlay!.coverage] };
	}, PROFILE);
	assert.deepEqual(actual, expected); assert.equal(actual.descriptor.width, 1); assert.equal(actual.descriptor.height, 3); assert.equal(deliveries, 1); assert.deepEqual(source.pixels, before);
});


test('a public native error used as an aborted reason stays cancellation and cannot enroll capability fallback', async () => {
	const body = await brush(128), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = new PixelFrameWebGl2UnavailableCurrentV1('context-lost'); let deliveries = 0, reads = 0;
	const port: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { reads++; entered.resolve(); await release.promise; return consume(body.bytes); } };
	const work = withImageDevelopGpuCurrentV1({ frame: frame(), develop: brushDevelop(body), signal: stop.signal }, () => { deliveries++; }, PROFILE, { maskSource: port }), settled = outcome(work);
	try {
		await Promise.race([entered.promise, settled]); assert.equal(reads, 1); stop.abort(reason); assert.equal(await remainsPending(settled), true); release.resolve();
		const result = await settled; assert.equal(result.ok, false); if (result.ok) assert.fail('Cancelled source work rejects.'); assert.ok(Object.is(result.error, reason)); assert.equal(deliveries, 0);
	} finally { release.resolve(); await Promise.allSettled([work]); body.bytes.fill(0); }
});

test('a consumer public native error is never reclassified or retried after fallback delivery', async () => {
	const reason = new PixelFrameWebGl2UnavailableCurrentV1('context-lost'); let deliveries = 0;
	const result = await outcome(withImageDevelopGpuCurrentV1({ frame: frame(), develop: develop() }, (_output, execution) => {
		assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'canvas-unavailable'); deliveries++; throw reason;
	}, PROFILE));
	assert.equal(result.ok, false); if (result.ok) assert.fail('Consumer errors reject.'); assert.ok(Object.is(result.error, reason)); assert.equal(deliveries, 1);
});
