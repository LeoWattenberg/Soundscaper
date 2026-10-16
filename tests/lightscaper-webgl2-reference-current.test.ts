/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validatePixelFrameWebGl2ReferenceCurrentV1 as validate } from '../src/common/editor/imaging/pixel-frame-webgl2-reference-current-v1.ts';
import { preparePixelFrameWebGl2GeometryCurrentV1 as geometryPass } from '../src/common/editor/imaging/pixel-frame-webgl2-geometry-current-v1.ts';
import { preparePixelFrameWebGl2ColorsCurrentV1 as colorPasses } from '../src/common/editor/imaging/pixel-frame-webgl2-color-current-v1.ts';
import { preparePixelFrameWebGl2LutCurrentV1 as lutPass, withPixelFrameWebGl2LutsCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-lut-current-v1.ts';
import { preparePixelFrameWebGl2OpticsCurrentV1 as opticsPass } from '../src/common/editor/imaging/pixel-frame-webgl2-optics-current-v1.ts';
import { prepareLinearColorEffectsV1, writeLinearColorChannelsV1 } from '../src/common/editor/imaging/pixel-frame-linear-color-v1.ts';
import { prepareLinearLensDistortionV1, writeLinearLensDistortionV1 } from '../src/common/editor/imaging/pixel-frame-linear-lens-distortion-v1.ts';
import { prepareLinearChromaticAberrationV1, writeLinearChromaticAberrationV1 } from '../src/common/editor/imaging/pixel-frame-linear-chromatic-aberration-v1.ts';
import { prepareLinearDefringeV1, writeLinearDefringeV1 } from '../src/common/editor/imaging/pixel-frame-linear-defringe-v1.ts';
import { prepareDefringeEffectV1 } from '../src/common/editor/video-defringe-v1.ts';
import { writeImageDefringeKernelPixelV1 } from '../src/common/editor/imaging/image-defringe-kernel-v1.ts';
import { linearKernelEncodedV1, linearKernelDecodedV1 } from '../src/common/editor/imaging/linear-kernel-planes-v1.ts';
import { prepareLinearOpticalVignetteV1, writeLinearOpticalVignetteV1 } from '../src/common/editor/imaging/pixel-frame-linear-optical-vignette-v1.ts';
import { prepareLinearGeometryV1, writeLinearGeometryV1 } from '../src/common/editor/imaging/pixel-frame-linear-geometry-v1.ts';
import { LINEAR_KERNEL_LIMITS_V1 } from '../src/common/editor/imaging/linear-kernel-descriptor-v1.ts';
import { LinearDevelopOwnerV1 } from '../src/common/editor/imaging/image-develop-linear-owner-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import type { ImageGeometryV1 } from '../src/common/editor/imaging/image-geometry-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';

const check = () => {};
const effect = (type: string, params: Readonly<Record<string, unknown>> = {}, id = type) => ({ id, type, enabled: true, params });
const geometry = (changes: Partial<ImageGeometryV1> = {}) => ({ schemaVersion: 1 as const, crop: null, rotationDegrees: 0,
	flipHorizontal: false, flipVertical: false, perspective: null, ...changes });
function frame(width: number, height: number, values: ArrayLike<number>): LinearWorkingPixelFrameV1 {
	return { descriptor: { schemaVersion: 1, width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels: Float32Array.from(values) };
}
function shifted(value: number, ulps: number): number {
	const plane = Float32Array.of(value), bits = new Uint32Array(plane.buffer); bits[0] = bits[0]! + ulps; return plane[0]!;
}
function observe<Result>(operation: Promise<Result>) {
	return operation.then(value => ({ value }), (error: unknown) => ({ error }));
}
function swapLut() {
	const bytes = new TextEncoder().encode('LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1');
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const pass = lutPass({ id: 'swap', reference: { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: bytes.length,
		size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } });
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		const owned = bytes.slice(); try { return await consume(owned); } finally { owned.fill(0); }
	} };
	return { pass, source };
}

test('whole-plane color → fractional geometry → authenticated LUT preserves order, native alpha and changing dimensions', async () => {
	const source = frame(2, 1, [.125, .25, .375, 1, .5, .75, 1, 1]), before = source.pixels.slice();
	const tone = colorPasses([effect('tone-ladder-v1', { exposure: 1 })])[0]!;
	const crop = geometryPass(geometry({ crop: { x: .25, y: 0, width: .5, height: 1 } }), source.descriptor), lut = swapLut();
	assert.deepEqual([crop.descriptor.width, crop.descriptor.height], [1, 1]);
	await withPixelFrameWebGl2LutsCurrentV1([lut.pass], lut.source, async resources => {
		// Exposure yields [.25,.5,.75] and[1,1.5,2]; crop averages first,
		// then the LUT clamps and swaps. Applying the LUT before crop yields .875R.
		const result = frame(1, 1, [1, 1, .625, 1]);
		assert.equal(await validate(source, result, [tone, crop, lut.pass], check, resources), true);
		assert.equal(await validate(source, frame(1, 1, [.875, 1, .625, 1]), [tone, crop, lut.pass], check, resources), false);
	});
	assert.deepEqual(source.pixels, before);
});

test('each authored effect stores Float32 before geometry and the next effect', async () => {
	const source = frame(1, 1, [2 ** -149, -(2 ** -149), .25, 1]);
	const down = colorPasses([effect('tone-ladder-v1', { exposure: -1 }, 'down')])[0]!;
	const up = colorPasses([effect('tone-ladder-v1', { exposure: 1 }, 'up')])[0]!;
	const identity = geometryPass(geometry(), source.descriptor), values = [down, identity, up];
	assert.equal(await validate(source, frame(1, 1, [0, 0, .25, 1]), values, check), true);
	assert.equal(await validate(source, source, values, check), false, 'A fused cancellation would retain the subnormal source instead.');
});

test('all eight normative color families compose with a natural quarter-turn plane', async () => {
	const effects = [effect('white-balance-v1', { temperature: 20 }), effect('tone-ladder-v1', { exposure: .25 }),
		effect('chroma-v1', { saturation: 20 }), effect('hsl-mixer-v1', { redHue: 10 }),
		effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 1, y: .9 }] }),
		effect('parametric-curves-v1', { masterShadows: 10 }), effect('color-wheels-v1', { midtonesLuminance: 10 }), effect('black-white-mix-v1', { red: 10 })];
	const colors = colorPasses(effects); assert.equal(colors.length, 8);
	const source = frame(3, 2, [.1, .2, .3, 1, .2, .3, .4, .5, .3, .4, .5, 1, .4, .5, .6, .5, .5, .6, .7, 1, .6, .7, .8, .5]);
	const rotation = geometryPass(geometry({ rotationDegrees: 90 }), source.descriptor), scalar = prepareLinearColorEffectsV1(effects);
	const expected: number[] = [], rgb = { red: 0, green: 0, blue: 0 };
	for (const index of [3, 0, 4, 1, 5, 2]) {
		let red = source.pixels[index * 4]!, green = source.pixels[index * 4 + 1]!, blue = source.pixels[index * 4 + 2]!;
		for (const pass of scalar) { writeLinearColorChannelsV1(pass, red, green, blue, rgb); red = Math.fround(rgb.red); green = Math.fround(rgb.green); blue = Math.fround(rgb.blue); }
		expected.push(red, green, blue, source.pixels[index * 4 + 3]!);
	}
	assert.equal(await validate(source, frame(2, 3, expected), [rotation, ...colors], check), true);
});

test('pure integer geometry requires bit-exact CPU output including moved alpha and hidden-color canonicalization', async () => {
	const source = frame(2, 2, [-0, 2, 3, 1, .25, .5, 1, .5, 2, -1, 1e-30, 1, 7, -4, 2, 0]);
	const rotation = geometryPass(geometry({ rotationDegrees: 90 }), source.descriptor); assert.equal(rotation.integerPermutation, true);
	const expected = frame(2, 2, [2, -1, 1e-30, 1, 0, 2, 3, 1, 0, 0, 0, 0, .25, .5, 1, .5]);
	assert.equal(await validate(source, expected, [rotation], check), true);
	expected.pixels[0] = shifted(2, 1); assert.equal(await validate(source, expected, [rotation], check), false);
});

test('fractional geometry compares exact normative OUTPUT alpha and keeps the changed-normal 8ULP limit', async () => {
	const source = frame(2, 1, [.25, 1e-30, -0, .5, .75, 1e-30, 0, 1]);
	const crop = geometryPass(geometry({ crop: { x: .25, y: 0, width: .5, height: 1 } }), source.descriptor); assert.equal(crop.integerPermutation, false);
	const expected = Math.fround(7 / 12), result = frame(1, 1, [expected, 1e-30, 0, .75]);
	assert.equal(await validate(source, result, [crop], check), true);
	result.pixels[0] = shifted(expected, 8); assert.equal(await validate(source, result, [crop], check), true);
	result.pixels[0] = shifted(expected, 9); assert.equal(await validate(source, result, [crop], check), false);
	result.pixels[0] = expected; result.pixels[3] = shifted(.75, 1); assert.equal(await validate(source, result, [crop], check), false);
});

test('nonfinite GPU readback is a numerical refusal while invalid native source samples remain fatal', async () => {
	const source = frame(1, 1, [.25, .5, .75, 1]), identity = geometryPass(geometry(), source.descriptor);
	for (const [channel, value] of [[0, NaN], [1, Infinity], [2, -Infinity], [3, NaN]] as const) {
		const result = frame(1, 1, [...source.pixels]); result.pixels[channel] = value;
		assert.equal(await validate(source, result, [identity], check), false);
	}
	const invalid = frame(1, 1, [NaN, .5, .75, 1]);
	await assert.rejects(validate(invalid, source, [identity], check), /finite|source/u);
});

test('unchanged RGB follows its Original ancestor through reversed integer crops, turns and flips', async () => {
	const source = frame(4, 1, [.125, .25, .5, 1, .25, .5, .75, 1, .5, .75, 1, 1, .75, 1, 1.5, 1]);
	const crop = geometryPass(geometry({ crop: { x: .25, y: 0, width: .5, height: 1 } }), source.descriptor);
	const turn = geometryPass(geometry({ rotationDegrees: 90, flipVertical: true }), crop.descriptor);
	const redOnly = colorPasses([effect('white-balance-v1', { temperature: 100 })])[0]!;
	const result = frame(1, 2, [1, .75, .5, 1, .5, .5, .375, 1]);
	assert.equal(await validate(source, result, [redOnly, crop, turn], check), true);
	result.pixels[1] = shifted(.75, 1);
	assert.equal(await validate(source, result, [redOnly, crop, turn], check), false, 'Moved unchanged Green retains its exact ancestral bits.');
});

test('private pass admission, complete descriptor chain and final extent precede both pixel properties', async () => {
	let probes = 0;
	const descriptor = frame(2, 1, new Float32Array(8)).descriptor;
	const hostile = { descriptor, get pixels(): Float32Array<ArrayBuffer> { probes++; return assert.fail('Pixel property before scalar admission.'); } };
	const crop = geometryPass(geometry({ crop: { x: .25, y: 0, width: .5, height: 1 } }), descriptor);
	const wrong = geometryPass(geometry(), descriptor);
	await assert.rejects(validate(hostile, hostile, [{ ...crop }], check), /owning|prepared|identity/u);
	await assert.rejects(validate(hostile, hostile, [crop, wrong], check), /descriptor|chain|source|geometry/u);
	await assert.rejects(validate(hostile, hostile, [crop], check), /descriptor|extent|output|geometry/u);
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); await assert.rejects(validate(hostile, hostile, [revoked.proxy], check), TypeError);
	assert.equal(probes, 0);
});

test('reference planes never exceed two live allocations and are physically wiped after match or refusal', async t => {
	const allocate = LinearDevelopOwnerV1.prototype.floats, retire = LinearDevelopOwnerV1.prototype.retire;
	const owned: Float32Array<ArrayBuffer>[] = [], live = new Set<ArrayBuffer>(); let peak = 0;
	t.mock.method(LinearDevelopOwnerV1.prototype, 'floats', function (this: LinearDevelopOwnerV1, length: number) {
		const plane = allocate.call(this, length); owned.push(plane); live.add(plane.buffer); peak = Math.max(peak, live.size); return plane;
	});
	t.mock.method(LinearDevelopOwnerV1.prototype, 'retire', function (this: LinearDevelopOwnerV1, buffer: ArrayBuffer) {
		retire.call(this, buffer); live.delete(buffer);
	});
	const source = frame(2, 1, [.25, .5, .75, 1, .5, .75, 1, 1]), before = source.pixels.slice();
	const flip = geometryPass(geometry({ flipHorizontal: true }), source.descriptor), result = frame(2, 1, [...source.pixels]);
	assert.equal(await validate(source, result, [flip, flip], check), true);
	result.pixels[0] = 10; assert.equal(await validate(source, result, [flip, flip], check), false);
	assert.ok(owned.length >= 2); assert.ok(peak <= 2); assert.equal(live.size, 0);
	for (const plane of owned) assert.ok(new Uint8Array(plane.buffer).every(value => value === 0));
	assert.deepEqual(source.pixels, before); assert.equal(result.pixels[0], 10);
});

test('native cancellation joins oracle retirement while retaining the exact opaque reason', async t => {
	const allocate = LinearDevelopOwnerV1.prototype.floats, owned: Float32Array<ArrayBuffer>[] = [];
	const controller = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	t.mock.method(LinearDevelopOwnerV1.prototype, 'floats', function (this: LinearDevelopOwnerV1, length: number) {
		const plane = allocate.call(this, length); owned.push(plane); if (owned.length === 2) controller.abort(opaque.proxy); return plane;
	});
	const source = frame(2, 1, [.25, .5, .75, 1, .5, .75, 1, 1]), result = frame(2, 1, [...source.pixels]);
	const flip = geometryPass(geometry({ flipHorizontal: true }), source.descriptor);
	const outcome = await observe(validate(source, result, [flip, flip], check, undefined, controller.signal));
	assert.ok('error' in outcome); assert.equal(outcome.error, opaque.proxy); assert.ok(owned.length >= 2);
	for (const plane of owned) assert.ok(new Uint8Array(plane.buffer).every(value => value === 0));
});

test('pre-aborted opaque signals win before hostile metadata and check failures still wipe every oracle plane', async t => {
	const controller = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); controller.abort(reason.proxy);
	let probes = 0;
	const descriptor = frame(1, 1, [1, 1, 1, 1]).descriptor;
	const hostile = { descriptor, get pixels(): Float32Array<ArrayBuffer> { probes++; return assert.fail('Preabort reflection.'); } };
	const outcome = await observe(validate(hostile, hostile, [], () => { probes++; }, undefined, controller.signal));
	assert.ok('error' in outcome); assert.equal(outcome.error, reason.proxy); assert.equal(probes, 0);
	const allocate = LinearDevelopOwnerV1.prototype.floats, owned: Float32Array<ArrayBuffer>[] = [], primary = new Error('native currentness failure');
	t.mock.method(LinearDevelopOwnerV1.prototype, 'floats', function (this: LinearDevelopOwnerV1, length: number) {
		const plane = allocate.call(this, length); owned.push(plane); return plane;
	});
	const source = frame(1, 1, [.25, .5, .75, 1]), pass = geometryPass(geometry(), source.descriptor);
	const failed = await observe(validate(source, source, [pass], () => { if (owned.length) throw primary; }));
	assert.ok('error' in failed); assert.equal(failed.error, primary); assert.ok(owned.length > 0);
	for (const plane of owned) assert.ok(new Uint8Array(plane.buffer).every(value => value === 0));
});

test('a real timer cancels large-source validation before any oracle allocation without changing either borrowed plane', async t => {
	const width = 512, height = 512, source = frame(width, height, new Float32Array(width * height * 4));
	source.pixels.set([.25, -0, 4, 1]); source.pixels.set([-2, 1e-30, -0, 1], source.pixels.length - 4);
	const result = frame(width, height, source.pixels), identity = geometryPass(geometry(), source.descriptor);
	const digest = (view: Float32Array<ArrayBuffer>) => createHash('sha256').update(new Uint8Array(view.buffer)).digest('hex');
	const before = digest(source.pixels), physicalBytes = source.pixels.buffer.byteLength;
	const allocate = LinearDevelopOwnerV1.prototype.floats; let allocations = 0, fired = false;
	t.mock.method(LinearDevelopOwnerV1.prototype, 'floats', function (this: LinearDevelopOwnerV1, length: number) {
		allocations++; return allocate.call(this, length);
	});
	const controller = new AbortController(), primary = new Error('timer cancellation during source validation');
	const timer = setTimeout(() => { fired = true; controller.abort(primary); }, 0);
	try {
		const outcome = await observe(validate(source, result, [identity], check, undefined, controller.signal));
		assert.equal(fired, true); assert.ok('error' in outcome); assert.equal(outcome.error, primary);
		assert.equal(allocations, 0, 'Source validation must yield before allocating private oracle storage.');
		assert.equal(source.pixels.buffer.byteLength, physicalBytes); assert.equal(result.pixels.buffer.byteLength, physicalBytes);
		assert.equal(digest(source.pixels), before); assert.equal(digest(result.pixels), before);
	} finally { clearTimeout(timer); }
});

async function cpuOptics(source: LinearWorkingPixelFrameV1, value: ReturnType<typeof effect>): Promise<LinearWorkingPixelFrameV1> {
	const target = new Float32Array(source.pixels.length), descriptor = source.descriptor, limits = LINEAR_KERNEL_LIMITS_V1;
	switch (value.type) {
		case 'lens-distortion-v1':
			await writeLinearLensDistortionV1(prepareLinearLensDistortionV1(value.params.amount, descriptor, limits), source, target); break;
		case 'chromatic-aberration-v1':
			await writeLinearChromaticAberrationV1(prepareLinearChromaticAberrationV1(value.params.red, value.params.blue, descriptor, limits), source, target); break;
		case 'defringe-v1': await writeLinearDefringeV1(prepareLinearDefringeV1(value, descriptor, limits), source, target); break;
		case 'optical-vignette-v1': await writeLinearOpticalVignetteV1(prepareLinearOpticalVignetteV1(value, descriptor, limits), source, target); break;
		default: throw new TypeError('Expected one existing native optics writer.');
	}
	return { descriptor, pixels: target };
}
function cpuColors(source: LinearWorkingPixelFrameV1, effects: readonly ReturnType<typeof effect>[]): LinearWorkingPixelFrameV1 {
	const pixels = source.pixels.slice(), colors = prepareLinearColorEffectsV1(effects), rgb = { red: 0, green: 0, blue: 0 };
	for (const pass of colors) for (let at = 0; at < pixels.length; at += 4) {
		writeLinearColorChannelsV1(pass, pixels[at]!, pixels[at + 1]!, pixels[at + 2]!, rgb);
		pixels[at] = rgb.red; pixels[at + 1] = rgb.green; pixels[at + 2] = rgb.blue;
	}
	return { descriptor: source.descriptor, pixels };
}
async function cpuGeometry(source: LinearWorkingPixelFrameV1, value: ImageGeometryV1): Promise<LinearWorkingPixelFrameV1> {
	const plan = prepareLinearGeometryV1(value, source.descriptor, LINEAR_KERNEL_LIMITS_V1), target = new Float32Array(plan.sampleCount);
	await writeLinearGeometryV1(plan, source, target); return { descriptor: plan.descriptor, pixels: target };
}

test('all four whole-plane optics retain native CPU ordering with color, dimension changes and an authenticated LUT', async () => {
	const source = frame(3, 3, [
		-.25, .2, 1.5, 1, .25, .5, .75, .5, .8, .1, .7, 1,
		.5, .1, .5, 1, .8, .1, .8, 1, .25, .75, 1.5, 1,
		3, -0, 1e-30, 0, .125, .25, .5, 1, 1.5, .75, -.5, 1,
	]), before = source.pixels.slice();
	const values = [effect('lens-distortion-v1', { amount: 35 }), effect('chromatic-aberration-v1', { red: -50, blue: 70 }),
		effect('defringe-v1', { purple: 100, green: 70, edgeThreshold: 10 }), effect('optical-vignette-v1', { amount: -30 })];
	const tone = effect('tone-ladder-v1', { exposure: -.5 }), passes: unknown[] = [...colorPasses([tone])];
	let expected = cpuColors(source, [tone]);
	for (const value of values) { passes.push(opticsPass(value, expected.descriptor)); expected = await cpuOptics(expected, value); }
	const turn = geometry({ rotationDegrees: 90, crop: { x: 0, y: 0, width: 2 / 3, height: 1 } });
	passes.push(geometryPass(turn, expected.descriptor)); expected = await cpuGeometry(expected, turn);
	const lut = swapLut(); passes.push(lut.pass);
	await withPixelFrameWebGl2LutsCurrentV1([lut.pass], lut.source, async resources => {
		for (let at = 0; at < expected.pixels.length; at += 4) {
			const red = Math.max(0, Math.min(1, expected.pixels[at]!)), green = Math.max(0, Math.min(1, expected.pixels[at + 1]!)), blue = Math.max(0, Math.min(1, expected.pixels[at + 2]!));
			expected.pixels[at] = blue; expected.pixels[at + 1] = green; expected.pixels[at + 2] = red;
		}
		assert.equal(await validate(source, expected, passes, check, resources), true);
		const wrong = frame(expected.descriptor.width, expected.descriptor.height, expected.pixels); wrong.pixels[0] = 20;
		assert.equal(await validate(source, wrong, passes, check, resources), false);
	});
	assert.deepEqual(source.pixels, before);
});

test('active CA keeps exact Green and raw-zero channels through integer geometry, without claiming reconstructed-channel ancestry', async () => {
	for (const active of ['red', 'blue'] as const) {
		const source = frame(3, 1, [.25, .5, .75, 1, .25, .5, .75, 1, .25, .5, .75, 1]);
		const value = effect('chromatic-aberration-v1', { red: active === 'red' ? 100 : 0, blue: active === 'blue' ? 100 : 0 });
		const pass = opticsPass(value, source.descriptor), turn = geometry({ rotationDegrees: 90 });
		const expected = await cpuGeometry(await cpuOptics(source, value), turn), rotation = geometryPass(turn, source.descriptor);
		assert.equal(await validate(source, expected, [pass, rotation], check), true);
		const reconstructed = active === 'red' ? 0 : 2, unchanged = active === 'red' ? 2 : 0;
		const changed = frame(1, 3, expected.pixels); changed.pixels[reconstructed] = shifted(changed.pixels[reconstructed]!, 1);
		assert.equal(await validate(source, changed, [pass, rotation], check), true, 'A reconstructed channel has no unique Original ancestor.');
		for (const channel of [1, unchanged]) {
			const copied = frame(1, 3, expected.pixels); copied.pixels[channel] = shifted(copied.pixels[channel]!, 1);
			assert.equal(await validate(source, copied, [pass, rotation], check), false, 'Copied channels keep their exact moved Original bits.');
		}
	}
});

test('channel-coupled color and LUT stages cannot restore ancestry invalidated by CA', async () => {
	const source = frame(3, 1, [.5, .5, .5, 1, .5, .5, .5, 1, .5, .5, .5, 1]);
	const value = effect('chromatic-aberration-v1', { red: 100, blue: 0 }), pass = opticsPass(value, source.descriptor);
	const corrected = await cpuOptics(source, value);
	for (const color of [effect('chroma-v1', { saturation: 50 }), effect('black-white-mix-v1'), effect('hsl-mixer-v1', { redHue: 15 })]) {
		const expected = cpuColors(corrected, [color]), result = frame(3, 1, expected.pixels); result.pixels[1] = shifted(result.pixels[1]!, 1);
		assert.equal(await validate(source, result, [pass, ...colorPasses([color])], check), true, color.type);
	}
	const lut = swapLut();
	await withPixelFrameWebGl2LutsCurrentV1([lut.pass], lut.source, async resources => {
		const result = frame(3, 1, corrected.pixels); result.pixels[1] = shifted(.5, 1);
		assert.equal(await validate(source, result, [pass, lut.pass], check, resources), true);
	});
	const wb = effect('white-balance-v1', { temperature: 100 }), expected = cpuColors(corrected, [wb]);
	expected.pixels[1] = shifted(expected.pixels[1]!, 1);
	assert.equal(await validate(source, expected, [pass, ...colorPasses([wb])], check), false, 'Independent WB cannot invalidate copied Green ancestry.');
});

for (const active of ['red', 'blue'] as const) test(`active ${active} CA → Defringe coupling permits rounded Green coincidence within the numeric profile`, async () => {
	const source = frame(3, 1, [.8, .1, .8, 1, 1, 1, 1, 1, 1, 1, 1, 1]), before = source.pixels.slice();
	const ca = effect('chromatic-aberration-v1', { red: active === 'red' ? -100 : 0, blue: active === 'blue' ? -100 : 0 });
	const corrected = await cpuOptics(source, ca), reconstructed = active === 'red' ? 0 : 2, copied = active === 'red' ? 2 : 0;
	assert.ok(corrected.pixels[reconstructed]! > source.pixels[reconstructed]!, 'The native CA writer actually reconstructs this input.');
	for (const channel of [copied, 1, 3]) assert.equal(Object.is(corrected.pixels[channel], source.pixels[channel]), true);
	const defringe = effect('defringe-v1', { purple: 1e-6, green: 0, edgeThreshold: 25 });
	const scalar = { red: 0, green: 0, blue: 0, redChanged: false, greenChanged: false, blueChanged: false };
	writeImageDefringeKernelPixelV1(prepareDefringeEffectV1(defringe), corrected.pixels, 3, 1, 0, 0, linearKernelEncodedV1, scalar);
	assert.equal(scalar.greenChanged, true);
	assert.ok(scalar.green > linearKernelEncodedV1(corrected.pixels[1]!));
	const unrounded = linearKernelDecodedV1(scalar.green);
	assert.ok(unrounded > corrected.pixels[1]!, 'Defringe makes a genuine positive correction before the Float32 store.');
	assert.equal(Object.is(Math.fround(unrounded), source.pixels[1]), true, 'A changed component can round back to its Original value.');
	const expected = await cpuOptics(corrected, defringe), passes = [opticsPass(ca, source.descriptor), opticsPass(defringe, source.descriptor)];
	assert.equal(Object.is(expected.pixels[1], Math.fround(unrounded)), true);
	assert.equal(await validate(source, expected, passes, check), true);
	const result = frame(3, 1, expected.pixels); result.pixels[1] = shifted(expected.pixels[1]!, 1);
	assert.equal(await validate(source, result, passes, check), true,
		'Green now depends on reconstructed RGB; its rounded coincidence cannot claim copied Original ancestry.');
	assert.deepEqual(source.pixels, before);
});

test('neutral and disabled Defringe after either CA correction retain the exact copied Green guard', async () => {
	for (const active of ['red', 'blue'] as const) {
		const source = frame(3, 1, [.8, .1, .8, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
		const ca = effect('chromatic-aberration-v1', { red: active === 'red' ? -100 : 0, blue: active === 'blue' ? -100 : 0 });
		const corrected = await cpuOptics(source, ca);
		for (const defringe of [effect('defringe-v1', { purple: 0, green: 0 }), { ...effect('defringe-v1', { purple: 100 }), enabled: false }]) {
			const expected = await cpuOptics(corrected, defringe), passes = [opticsPass(ca, source.descriptor), opticsPass(defringe, source.descriptor)];
			assert.deepEqual(expected.pixels, corrected.pixels, 'The existing native writer treats this stage as an exact copy.');
			assert.equal(await validate(source, expected, passes, check), true);
			const result = frame(3, 1, expected.pixels); result.pixels[1] = shifted(expected.pixels[1]!, 1);
			assert.equal(await validate(source, result, passes, check), false, `${active} CA, enabled=${defringe.enabled}`);
		}
	}
});

test('lens reconstruction invalidates integer-permutation and Original coincidence guards', async () => {
	const source = frame(3, 1, [.25, .5, .75, 1, .25, .5, .75, 1, .25, .5, .75, 1]);
	const value = effect('lens-distortion-v1', { amount: 100 }), pass = opticsPass(value, source.descriptor), expected = await cpuOptics(source, value);
	const result = frame(3, 1, expected.pixels); result.pixels[1] = shifted(result.pixels[1]!, 1);
	assert.equal(await validate(source, result, [pass], check), true, 'Equal final values after resampling are not proof of Original ancestry.');
	result.pixels[3] = shifted(result.pixels[3]!, 1); assert.equal(await validate(source, result, [pass], check), false, 'CPU output alpha remains exact.');
});

test('active flat Defringe and optical center or hidden-color bypass keep exact same-pixel components', async () => {
	for (const value of [effect('defringe-v1', { purple: 100, green: 100, edgeThreshold: 25 }), effect('optical-vignette-v1', { amount: 100 })]) {
		const source = frame(3, 1, [.25, .5, .75, 1, .25, .5, .75, 1, -.25, -0, 2, 0]), pass = opticsPass(value, source.descriptor);
		const expected = await cpuOptics(source, value), copied = frame(3, 1, expected.pixels); copied.pixels[5] = shifted(copied.pixels[5]!, 1);
		assert.equal(await validate(source, expected, [pass], check), true);
		assert.equal(await validate(source, copied, [pass], check), false, 'A same-pixel unchanged component must remain bit-exact.');
		const hidden = frame(3, 1, expected.pixels); hidden.pixels[8] = shifted(hidden.pixels[8]!, 1);
		assert.equal(await validate(source, hidden, [pass], check), false, 'Alpha-zero hidden RGB bypass is exact.');
	}
});

test('neutral and disabled optics preserve every native bit and do not invalidate exact copied-channel guards', async () => {
	const source = frame(1, 1, [-0, .5, 1e-30, 0]);
	for (const value of [effect('lens-distortion-v1', { amount: 0 }), effect('chromatic-aberration-v1', { red: 0, blue: 0 }),
		effect('defringe-v1', { purple: 0, green: 0 }), effect('optical-vignette-v1', { amount: 0 }),
		{ ...effect('lens-distortion-v1', { amount: 100 }), enabled: false },
		{ ...effect('chromatic-aberration-v1', { red: 100, blue: -100 }), enabled: false },
		{ ...effect('defringe-v1', { purple: 100 }), enabled: false }, { ...effect('optical-vignette-v1', { amount: 100 }), enabled: false }]) {
		const pass = opticsPass(value, source.descriptor);
		assert.equal(await validate(source, source, [pass], check), true, value.type);
		const result = frame(1, 1, source.pixels); result.pixels[1] = shifted(.5, 1);
		assert.equal(await validate(source, result, [pass], check), false, value.type);
	}
	const gray = frame(3, 1, [.5, .5, .5, 1, .5, .5, .5, 1, .5, .5, .5, 1]);
	const ca = effect('chromatic-aberration-v1', { red: 100, blue: 0 }), defringe = effect('defringe-v1', { purple: 100 });
	const expected = await cpuOptics(await cpuOptics(gray, ca), defringe); expected.pixels[0] = shifted(expected.pixels[0]!, 1);
	assert.equal(await validate(gray, expected, [opticsPass(ca, gray.descriptor), opticsPass(defringe, gray.descriptor)], check), true,
		'Same-pixel Defringe must not restore ancestry already invalidated by a nonlocal CA channel.');
});

test('optics preserve per-stage Float32 underflow, signed zero and authored raw-active CA semantics', async () => {
	const source = frame(3, 1, [2 ** -149, -0, .25, 1, 2 ** -149, -0, .25, 1, 3, -0, 2, 0]);
	const down = effect('tone-ladder-v1', { exposure: -1 }), up = effect('tone-ladder-v1', { exposure: 1 }), vignette = effect('optical-vignette-v1', { amount: 100 });
	const expected = cpuColors(await cpuOptics(cpuColors(source, [down]), vignette), [up]);
	assert.equal(await validate(source, expected, [...colorPasses([down]), opticsPass(vignette, source.descriptor), ...colorPasses([up])], check), true);
	assert.equal(expected.pixels[0], 0);
	const tiny = effect('chromatic-aberration-v1', { red: -(1e-20), blue: 0 }), corrected = await cpuOptics(source, tiny);
	assert.equal(await validate(source, corrected, [opticsPass(tiny, source.descriptor)], check), true);
	assert.equal(Object.is(corrected.pixels[9], -0), true); assert.equal(Object.is(corrected.pixels[11], 0), true);
});

test('optics identity, descriptor binding and the complete mixed chain reject before source or result pixels', async () => {
	let probes = 0;
	const descriptor = frame(3, 1, new Float32Array(12)).descriptor;
	const hostile = { descriptor, get pixels(): Float32Array<ArrayBuffer> { probes++; return assert.fail('Optics metadata before pixels.'); } };
	const pass = opticsPass(effect('optical-vignette-v1', { amount: 100 }), descriptor);
	await assert.rejects(validate(hostile, hostile, [{ ...pass }], check), /owning|prepared|identity/u);
	const other = opticsPass(effect('lens-distortion-v1', { amount: 20 }), frame(2, 1, new Float32Array(8)).descriptor);
	await assert.rejects(validate(hostile, hostile, [pass, other], check), /descriptor|chain|source|binding/u);
	assert.equal(probes, 0);
});

test('mixed optics never exceed two live oracle planes and join opaque cancellation with physical wipe', async t => {
	const allocate = LinearDevelopOwnerV1.prototype.floats, retire = LinearDevelopOwnerV1.prototype.retire;
	const owned: Float32Array<ArrayBuffer>[] = [], live = new Set<ArrayBuffer>(); let peak = 0, abort = false;
	const controller = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	t.mock.method(LinearDevelopOwnerV1.prototype, 'floats', function (this: LinearDevelopOwnerV1, length: number) {
		const plane = allocate.call(this, length); owned.push(plane); live.add(plane.buffer); peak = Math.max(peak, live.size);
		if (abort && live.size === 2) controller.abort(reason.proxy); return plane;
	});
	t.mock.method(LinearDevelopOwnerV1.prototype, 'retire', function (this: LinearDevelopOwnerV1, buffer: ArrayBuffer) { retire.call(this, buffer); live.delete(buffer); });
	const source = frame(3, 1, [.25, .5, .75, 1, .5, .75, 1, .5, 3, -0, 2, 0]), before = source.pixels.slice();
	const values = [effect('optical-vignette-v1', { amount: 30 }), effect('chromatic-aberration-v1', { red: -70, blue: 0 }), effect('lens-distortion-v1', { amount: -20 }), effect('defringe-v1', { purple: 50 })];
	let expected = source;
	for (const value of values) expected = await cpuOptics(expected, value);
	const passes = values.map(value => opticsPass(value, source.descriptor));
	assert.equal(await validate(source, expected, passes, check), true); assert.ok(peak <= 2); assert.equal(live.size, 0);
	abort = true;
	const outcome = await observe(validate(source, expected, passes, check, undefined, controller.signal));
	assert.ok('error' in outcome); assert.equal(outcome.error, reason.proxy); assert.ok(peak <= 2); assert.equal(live.size, 0);
	for (const plane of owned) assert.ok(new Uint8Array(plane.buffer).every(value => value === 0));
	assert.deepEqual(source.pixels, before);
});

test('normative Float32 optics overflow is fatal and wipes both oracle planes without changing borrowed pixels', async t => {
	const allocate = LinearDevelopOwnerV1.prototype.floats, owned: Float32Array<ArrayBuffer>[] = [];
	t.mock.method(LinearDevelopOwnerV1.prototype, 'floats', function (this: LinearDevelopOwnerV1, length: number) {
		const plane = allocate.call(this, length); owned.push(plane); return plane;
	});
	const source = frame(3, 1, [Math.fround(3.4028234663852886e38), .5, -0, 1, .25, .5, .75, 1, 3, -0, 2, 0]);
	const result = frame(3, 1, source.pixels), before = source.pixels.slice(), pass = opticsPass(effect('optical-vignette-v1', { amount: 100 }), source.descriptor);
	await assert.rejects(validate(source, result, [pass], check), /finite|Float32|output/u);
	assert.equal(owned.length, 2);
	for (const plane of owned) assert.ok(new Uint8Array(plane.buffer).every(value => value === 0));
	assert.deepEqual(source.pixels, before); assert.deepEqual(result.pixels, before);
});
