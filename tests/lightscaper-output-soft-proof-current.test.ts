/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationCurrentV1, preparePhotoDevelopPresentationViewCurrentV1,
	type PhotoDevelopPresentationPortsCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { preparePhotoDevelopPresentationViewV2 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v2.ts';
import { preparePhotoDevelopPresentationViewForProfileV1 } from '../src/common/editor/controller/shared/internal/photo-library-develop-presentation-kernel-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { withImageOutputSoftProofCurrentV1, prepareImageOutputSoftProofCurrentV1 } from '../src/common/editor/imaging/image-output-soft-proof-current-v1.ts';
import { withPhotoDevelopDisplayFrameCurrentV1 } from '../src/common/editor/imaging/photo-develop-display-frame-current-v1.ts';
import { withPhotoDevelopDisplayFrameV1 } from '../src/common/editor/imaging/photo-develop-display-frame-v1.ts';
import { createPixelFrameHistogramV1 } from '../src/common/editor/imaging/pixel-frame-histogram-v1.ts';
import { rawDerivedOriginalFixtureCurrentV1, rawDerivedOriginalNativeCurrentV1 } from './helpers/lightscaper-raw-derived-original-current-fixture.ts';
import { withPhotoOriginalDerivedFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-derived-frame-current-v1.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-development-current-v1.ts';

// Independent two-stage rational D65 matrix oracle, followed only by the
// documented target clipping, sRGB transfer and selected-code quantization.
const XYZ = [[506752 / 1228815, 87881 / 245763, 12673 / 70218], [87098 / 409605, 175762 / 245763, 12673 / 175545], [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
const P3 = [[446124 / 178915, -333277 / 357830, -72051 / 178915], [-14852 / 17905, 63121 / 35810, 423 / 17905], [11844 / 330415, -50337 / 660830, 316169 / 330415]];
function oracle(samples: ArrayLike<number>, native: boolean, depth: 8 | 16, p3 = true): Uint8Array {
	const pixels = new Uint8Array(samples.length), maximum = depth === 8 ? 255 : 65535;
	for (let index = 0; index < samples.length; index += 4) {
		const rgb = Array.from({ length: 3 }, (_, channel) => {
			const value = samples[index + channel]! / (native ? 1 : 255);
			return native ? value : value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
		});
		const xyz = XYZ.map(row => row.reduce((sum, coefficient, channel) => sum + coefficient * rgb[channel]!, 0));
		const target = p3 ? P3.map(row => row.reduce((sum, coefficient, channel) => sum + coefficient * xyz[channel]!, 0)) : rgb;
		for (let channel = 0; channel < 3; channel++) {
			const value = Math.max(0, Math.min(1, target[channel]!)), encoded = value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
			pixels[index + channel] = Math.round(Math.round(encoded * maximum) * 255 / maximum);
		}
		pixels[index + 3] = Math.round(Math.round(samples[index + 3]! / (native ? 1 : 255) * maximum) * 255 / maximum);
	}
	return pixels;
}

// Source/paint ports model only the external ownership/display boundaries.
// The real Current renderer, presentation queue and final conversion are used.
function fixture(native = false) {
	const frame: PixelFrameV1 = native
		? { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
			pixels: new Float32Array([1, 0, 0, 1, 0, 1, 0, .5]) }
		: { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
			pixels: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 128) };
	const before = {} as HTMLCanvasElement, after = {} as HTMLCanvasElement;
	const paints = new Map<HTMLCanvasElement, { pixels: Uint8Array; primaries: string }>(), exposed: Uint8Array[] = [];
	const barriers = { paint: (): void => undefined };
	let reads = 0, retired = 0;
	const ports: PhotoDevelopPresentationPortsCurrentV1 = {
		async withOriginalFrame(request, consume) {
			assert.equal(this, ports); reads++;
			try { return await consume({ photoId: request.photoId, revision: request.expectedRevision, frame }); }
			finally { retired++; }
		},
		async loadProxy() { assert.equal(this, ports); return createPhotoDevelopRenderRuntimeCurrentV1(); },
		paint(canvas, value) {
			assert.equal(this, ports); if (canvas === after) barriers.paint();
			assert.ok(value.pixels instanceof Uint8Array || value.pixels instanceof Uint8ClampedArray);
			paints.set(canvas, { pixels: new Uint8Array(value.pixels), primaries: value.descriptor.primaries });
			if (canvas === after) exposed.push(new Uint8Array(value.pixels.buffer, value.pixels.byteOffset, value.pixels.byteLength));
			return { width: value.descriptor.width, height: value.descriptor.height, byteLength: value.pixels.byteLength };
		}, clear(canvas) { assert.equal(this, ports); paints.delete(canvas); },
	};
	const view = (bitDepth: 8 | 16 = 8) => ({ photoId: 'photo', revision: 7, before, after,
		develop: defaultImageDevelopStateV1(), softProof: { profile: 'display-p3' as const, bitDepth } });
	return { frame, before, after, ports, paints, exposed, barriers, view, counts: () => ({ reads, retired }) };
}

test('Current4 captures ephemeral soft-proof profile/depth before waits while permanent presentation policies stay closed', () => {
	const f = fixture(), value = f.view(16), prepared = preparePhotoDevelopPresentationViewCurrentV1(value);
	Reflect.set(value.softProof, 'profile', 'srgb'); Reflect.set(value.softProof, 'bitDepth', 8);
	assert.ok('softProof' in prepared); assert.deepEqual(prepared.softProof, { profile: 'display-p3', bitDepth: 16 });
	assert.ok(Object.isFrozen(prepared.softProof));
	assert.deepEqual(value.develop, defaultImageDevelopStateV1(), 'proof selection does not become a recipe field');
	assert.throws(() => preparePhotoDevelopPresentationViewV2(value), TypeError);
	assert.throws(() => preparePhotoDevelopPresentationViewForProfileV1('current3', value), TypeError);
	let getters = 0;
	for (const softProof of [{ profile: 'display-p3', bitDepth: 12 }, { profile: 'bt2020', bitDepth: 8 },
		{ profile: 'srgb', bitDepth: 8, extra: true }, { get profile() { getters++; return 'srgb'; }, bitDepth: 8 }]) {
		assert.throws(() => preparePhotoDevelopPresentationViewCurrentV1({ ...value, softProof }));
	}
	assert.equal(getters, 0);
});

for (const native of [false, true]) test(`Current4 ${native ? 'native Float32' : 'encoded byte'} After proofs target colors while Before remains canonical sRGB`, async () => {
	const f = fixture(native), owner = new PhotoLibraryDevelopPresentationCurrentV1(f.ports), original = f.frame.pixels.slice();
	try {
		owner.setView(f.view()); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
		assert.deepEqual(f.paints.get(f.before), { pixels: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 128), primaries: 'srgb' });
		assert.deepEqual(f.paints.get(f.after), { pixels: Uint8Array.of(234, 51, 35, 255, 117, 251, 76, 128), primaries: 'display-p3' });
		const histogram = owner.snapshot().after; assert.ok(histogram); assert.equal(histogram.sampledPixels, 2);
		assert.equal(histogram.bins.red[234], 1); assert.equal(histogram.bins.red[117], 1);
		assert.deepEqual(histogram.highClippedChannels, [0, 0, 0]); assert.deepEqual(histogram.lowClippedChannels, [0, 0, 0]);
		assert.deepEqual(f.counts(), { reads: 1, retired: 1 }); assert.deepEqual(f.frame.pixels, original);
		assert.ok(f.exposed.every(plane => plane.every(value => value === 0)), 'proof planes retire before ready');
	} finally { await owner.close(); }
});

test('Current4 proof Close joins a held real renderer scope and never publishes old proof pixels', async () => {
	const f = fixture(true), entered = deferred<void>(), release = deferred<void>(), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const held: PhotoDevelopPresentationPortsCurrentV1['loadProxy'] = async function (this: PhotoDevelopPresentationPortsCurrentV1) {
		assert.equal(this, f.ports);
		return { withProxy: (request, consume) => runtime.withProxy(request, async view => { entered.resolve(); await release.promise; return consume(view); }),
			withFullResolution: runtime.withFullResolution };
	};
	Reflect.set(f.ports, 'loadProxy', held);
	const owner = new PhotoLibraryDevelopPresentationCurrentV1(f.ports);
	try {
		owner.setView(f.view()); const work = owner.drain();
		await Promise.race([entered.promise, work.then(() => assert.fail('Native renderer scope did not open.'))]);
		const closing = owner.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.counts().retired, 0);
		release.resolve(); await work; await closing; assert.equal(f.paints.size, 0); assert.equal(f.counts().retired, 1);
	} finally { release.resolve(); await owner.close(); }
});

test('proof16 simulates its selected precision before canvas8 and counts true target clipping rather than canvas endpoints', async () => {
	const encoded = 65534 / 65535, decoded = ((encoded + .055) / 1.055) ** 2.4;
	const source: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
		pixels: new Float32Array([decoded, decoded, decoded, 1, 1 / 65535, 2 / 65535, 3 / 65535, 0]) };
	const before = source.pixels.slice(); let retained: Uint8Array | undefined;
	await withImageOutputSoftProofCurrentV1({ frame: source, softProof: { profile: 'srgb', bitDepth: 16 } }, view => {
		assert.deepEqual(view.frame.pixels, oracle(source.pixels, true, 16, false)); retained = view.frame.pixels;
		assert.deepEqual([...view.frame.pixels.subarray(0, 4)], [255, 255, 255, 255]);
		assert.deepEqual(view.histogram.highClippedChannels, [0, 0, 0]); assert.equal(view.histogram.sampledPixels, 1);
		assert.equal(view.histogram.transparentPixels, 1); assert.deepEqual(view.histogram.lowClippedChannels, [0, 0, 0]);
	}, 'full');
	assert.ok(retained); assert.equal(retained.every(value => value === 0), true); assert.deepEqual(source.pixels, before);
});

test('proof histogram covers the full evaluated grid while fitting uses explicit nearest sampling', async () => {
	const pixels = new Uint8Array(2050 * 4); for (let x = 0; x < 2050; x++) pixels.set([0, 0, 0, 255], x * 4); pixels.set([255, 0, 0, 255], 1024 * 4);
	const frame: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2050, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
	await withImageOutputSoftProofCurrentV1({ frame, softProof: { profile: 'display-p3', bitDepth: 8 } }, view => {
		assert.equal(view.frame.descriptor.width, 2048); assert.equal(view.histogram.sampledPixels, 2050); assert.equal(view.histogram.bins.red[234], 1);
		assert.equal([...view.frame.pixels].some((value, index) => index % 4 !== 3 && value !== 0), false, 'proxy omits source1024 at the nearest-grid jump');
	});
});

test('Current target overlay transforms sRGB graphic colors and keeps coverage/extent truthful without widening old display readers', async () => {
	const frame: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'display-p3', transfer: 'srgb' }, pixels: Uint8Array.of(234, 51, 35, 255, 117, 251, 76, 255) };
	const observed = { maskId: 'mask', effectId: 'effect', width: 2, height: 1, coverage: Uint8Array.of(64, 191) };
	for (const mode of ['color', 'grayscale'] as const) await withPhotoDevelopDisplayFrameCurrentV1({ frame, maskOverlay: observed, maskOverlayMode: mode }, view => {
		assert.equal(view.frame.descriptor.primaries, 'display-p3'); assert.deepEqual(view.frame.pixels, frame.pixels); assert.ok(view.overlay);
		assert.equal(view.overlay.descriptor.primaries, 'display-p3');
		assert.deepEqual(view.overlay.pixels, mode === 'color' ? oracle([255, 48, 48, 64, 255, 48, 48, 191], false, 8) : Uint8Array.of(64, 64, 64, 255, 191, 191, 191, 255));
	}, 'proxy');
	await assert.rejects(withPhotoDevelopDisplayFrameV1({ frame }, () => undefined, 'proxy'), RangeError);
	await assert.rejects(createPixelFrameHistogramV1(frame), RangeError);
});

test('proof metadata and declared aggregate admission precede pixel authority and pre-abort preserves opaque identity', async () => {
	let reads = 0; const source = new Proxy({ descriptor: { schemaVersion: 1, width: 16384, height: 4096, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels: new Float32Array() }, {
		getOwnPropertyDescriptor(target, key) { if (key === 'pixels') { reads++; throw new Error('unreachable pixel admission'); } return Object.getOwnPropertyDescriptor(target, key); },
	});
	await assert.rejects(withImageOutputSoftProofCurrentV1({ frame: source, softProof: { profile: 'display-p3', bitDepth: 16 } }, () => undefined), RangeError); assert.equal(reads, 0);
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const stop = new AbortController(); stop.abort(opaque.proxy);
	const outcome = await withImageOutputSoftProofCurrentV1({ frame: source, softProof: new Proxy({}, { getPrototypeOf() { throw new Error('unreachable proof'); } }), signal: stop.signal }, () => undefined)
		.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(Object.is(outcome.error, opaque.proxy), true); assert.equal(reads, 0);
	assert.throws(() => prepareImageOutputSoftProofCurrentV1({ profile: 'srgb', bitDepth: 8, persisted: true }), TypeError);
});

test('proof joins held cancellation, pins physical retirement against shadows and retains primary plus transfer cleanup', async () => {
	const f = fixture(true), stop = new AbortController(), entered = deferred<void>(), release = deferred<void>(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let retained: Uint8Array | undefined;
	const task = withImageOutputSoftProofCurrentV1({ frame: f.frame, softProof: { profile: 'display-p3', bitDepth: 16 }, signal: stop.signal }, async view => {
		retained = new Uint8Array(view.frame.pixels.buffer); Object.defineProperty(view.frame.pixels, 'buffer', { get() { throw new Error('unreachable cleanup shadow'); } });
		entered.resolve(); await release.promise;
	});
	const outcome = task.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered.promise, outcome.then(() => assert.fail('Proof consumer did not enter.'))]); stop.abort(opaque.proxy);
		assert.equal(await remainsPending(outcome), true); release.resolve(); const result = await outcome;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, opaque.proxy), true);
		assert.ok(retained); assert.equal(retained.every(value => value === 0), true);
	} finally { release.resolve(); await outcome; }
	let moved: ArrayBuffer | undefined;
	const failed = await withImageOutputSoftProofCurrentV1({ frame: f.frame, softProof: { profile: 'display-p3', bitDepth: 8 } }, view => {
		moved = structuredClone(view.frame.pixels.buffer, { transfer: [view.frame.pixels.buffer] }); throw opaque.proxy;
	}).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(failed.ok, false); if (!failed.ok) {
		assert.equal(Object.is(failed.error, opaque.proxy), false); assert.ok(failed.error instanceof AggregateError);
		assert.equal(Object.is(failed.error.errors[0], opaque.proxy), true); assert.ok(failed.error.errors[1] instanceof TypeError);
	}
	assert.ok(moved); new Uint8Array(moved).fill(0);
});

test('actual ABI1 Before and ABI2 headroom/recovery After retain sequential native authority through P3 proof', async () => {
	for (const mode of ['headroom', 'recovery'] as const) {
		const source = rawDerivedOriginalFixtureCurrentV1(6), canonical = await rawDerivedOriginalNativeCurrentV1(), derived = await rawDerivedOriginalNativeCurrentV1();
		const before = {} as HTMLCanvasElement, after = {} as HTMLCanvasElement, painted = new Map<HTMLCanvasElement, Uint8Array>(), expected = new Map<HTMLCanvasElement, Uint8Array>();
		const ports: PhotoDevelopPresentationPortsCurrentV1 = {
			async withOriginalFrame(request, consume, options) {
				assert.equal(this, ports); return canonical.ports.withRawFrame!({ bytes: source.bytes, ...(options?.signal ? { signal: options.signal } : {}) }, view => {
					expected.set(before, oracle(Array.from(view.frame.pixels, code => code / 65535), true, 8, false));
					return consume({ photoId: request.photoId, revision: request.expectedRevision, frame: view.frame });
				});
			},
			async withDerivedFrame(request, consume, options) {
				assert.equal(this, ports); assert.equal(canonical.canonical.active(), 0); assert.ok(canonical.words.every(buffer => new Uint8Array(buffer).every(byte => byte === 0)));
				return withPhotoOriginalDerivedFrameCurrentV1({ binding: source.binding, body: source.body, profile: request.profile, ...(options?.signal ? { signal: options.signal } : {}) }, view => {
					expected.set(after, oracle(view.frame.pixels, true, 16)); return consume({ ...view, photoId: request.photoId, revision: request.expectedRevision });
				}, derived.ports);
			},
			async loadProxy() { assert.equal(this, ports); return createPhotoDevelopRenderRuntimeCurrentV1(); },
			paint(canvas, frame) { assert.equal(this, ports); assert.equal(frame.descriptor.primaries, canvas === before ? 'srgb' : 'display-p3');
				painted.set(canvas, new Uint8Array(frame.pixels)); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; }, clear(canvas) { painted.delete(canvas); },
		};
		const owner = new PhotoLibraryDevelopPresentationCurrentV1(ports), develop = setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), { schemaVersion: 1, mode });
		try {
			owner.setView({ photoId: source.binding.photoId, revision: 7, develop, before, after, softProof: { profile: 'display-p3', bitDepth: 16 } }); await owner.drain();
			assert.equal(owner.snapshot().status, 'ready'); assert.deepEqual(painted.get(after), expected.get(after)); assert.deepEqual(painted.get(before), expected.get(before));
			assert.ok(derived.floats.every(buffer => new Uint8Array(buffer).every(byte => byte === 0))); assert.ok(derived.words.every(buffer => new Uint8Array(buffer).every(byte => byte === 0)));
			assert.deepEqual(new Uint8Array(await source.body.arrayBuffer()), source.bytes); assert.ok(develop.processVersion === 4); assert.equal(develop.rawDevelopment.mode, mode);
		} finally { await owner.close(); await Promise.all([canonical.close(), derived.close()]); }
	}
});
