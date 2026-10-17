/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import type { ImageDevelopRepairSpotV1 as Spot } from '../src/common/editor/imaging/image-develop-repair-spots-v1.ts';
import { prepareLinearRepairsV1, writeLinearRepairsV1 } from '../src/common/editor/imaging/pixel-frame-linear-repair-v1.ts';

function frame(width: number, height: number, gray = 0) {
	const pixels = new Float32Array(width * height * 4);
	for (let index = 0; index < pixels.length; index += 4) pixels.set([gray, gray, gray, 1], index);
	return { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const,
		primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
}
function put(value: ReturnType<typeof frame>, x: number, y: number, rgba: readonly number[]) {
	value.pixels.set(rgba, (y * value.descriptor.width + x) * 4);
}
function patch(value: ReturnType<typeof frame>, left: number, top: number, width: number, height: number, gray: number) {
	for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) put(value, x, y, [gray, gray, gray, 1]);
}
function spot(mode: Spot['mode'], changes: Partial<Spot> = {}): Spot {
	return { id: 'repair', mode, enabled: true, target: { x: 0.5, y: 0.5 }, source: { x: 0.5, y: 0.5 },
		radius: 0.2, feather: 0, opacity: 1, ...changes };
}
function develop(spots: readonly Spot[]) {
	return { ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots } };
}
function pixel(values: readonly number[], width: number, x: number, y: number) {
	return values.slice((y * width + x) * 4, (y * width + x + 1) * 4);
}
function f32(values: readonly number[]) { return values.map(Math.fround); }
async function render(value: ReturnType<typeof frame>, spots: readonly Spot[]) {
	const before = value.pixels.slice(); let borrowed: Float32Array | undefined;
	const result = await withImageDevelopLinearCurrentV1({ frame: value, develop: develop(spots) }, output => {
		assert.deepEqual(output.descriptor, value.descriptor); assert.notEqual(output.pixels, value.pixels);
		borrowed = output.pixels; return Array.from(output.pixels);
	}, PROFILE);
	assert.deepEqual(value.pixels, before, 'Stable Original pixels remain unchanged.');
	assert.ok(borrowed?.every(value => value === 0), 'The enclosing owner retires its actual output.');
	return result;
}
function changedOnly(actual: readonly number[], original: Float32Array, indices: readonly number[]) {
	const expected = Array.from(original);
	for (const index of indices) expected.splice(index * 4, 4, ...actual.slice(index * 4, index * 4 + 4));
	assert.deepEqual(actual, expected);
}
function donors() {
	const value = frame(11, 3); patch(value, 0, 0, 3, 3, 0.5); put(value, 1, 1, [1, 1, 1, 1]);
	patch(value, 4, 0, 3, 3, 2); put(value, 5, 1, [8, 8, 8, 1]);
	patch(value, 8, 0, 3, 3, 4); put(value, 9, 1, [0, 0, 0, 1]); return value;
}

test('native linear Clone retains signed HDR and sub-byte donor precision with exact target alpha', async () => {
	const value = frame(3, 1); put(value, 0, 0, [-2, 4, 1e-30, 1]); put(value, 2, 0, [0.5, 0.25, 0.125, 0.375]);
	const result = await render(value, [spot('clone', { target: { x: 5 / 6, y: 0.5 }, source: { x: 1 / 6, y: 0.5 }, radius: 0.1 })]);
	assert.deepEqual(pixel(result, 3, 2, 0), f32([-2, 4, 1e-30, 0.375])); changedOnly(result, value.pixels, [2]);
});

test('neighboring native word codes remain distinct after independent original-space Clone', async () => {
	const value = frame(4, 1); put(value, 0, 0, [1024 / 65535, 1025 / 65535, 1026 / 65535, 1]);
	const result = await render(value, [spot('clone', { target: { x: 7 / 8, y: 0.5 }, source: { x: 1 / 8, y: 0.5 }, radius: 0.1 })]);
	assert.deepEqual(pixel(result, 4, 3, 0), f32([1024 / 65535, 1025 / 65535, 1026 / 65535, 1]));
	assert.ok(result[12]! < result[13]! && result[13]! < result[14]!);
});

test('fractional donor filtering premultiplies alpha once and preserves transparent target hidden RGB', async () => {
	const value = frame(6, 3); put(value, 0, 0, [8, -4, 2, 1]);
	for (const [x, y] of [[1, 0], [0, 1], [1, 1]]) put(value, x!, y!, [99, -99, 33, 0]);
	put(value, 4, 1, [2, 4, -2, 0.5]);
	const definition = spot('clone', { target: { x: 4.5 / 6, y: 0.5 }, source: { x: 1 / 6, y: 1 / 3 }, opacity: 0.5 });
	const result = await render(value, [definition]);
	// Quarter donor alpha times half opacity gives weight1/8; no byte transfer or second alpha attenuation.
	assert.deepEqual(pixel(result, 6, 4, 1), [2.75, 3, -1.5, 0.5]); changedOnly(result, value.pixels, [10]);
	put(value, 4, 1, [9, -7, 1e-30, 0]); assert.deepEqual(await render(value, [definition]), Array.from(value.pixels));
});

test('out-of-image donor taps remain transparent rather than edge-clamping native HDR', async () => {
	const value = frame(5, 3); put(value, 0, 1, [8, -4, 2, 1]);
	const result = await render(value, [spot('clone', { target: { x: 3.5 / 5, y: 0.5 }, source: { x: 0, y: 0.5 } })]);
	assert.deepEqual(pixel(result, 5, 3, 1), [4, -2, 1, 1]); changedOnly(result, value.pixels, [8]);
});

test('fractional target center, feather and opacity retain continuous linear coverage', async () => {
	const value = frame(9, 5); patch(value, 0, 0, 5, 5, 4);
	const result = await render(value, [spot('clone', { target: { x: 7.25 / 9, y: 0.5 }, source: { x: 2.25 / 9, y: 0.5 },
		radius: 0.4, feather: 1, opacity: 0.5 })]);
	// Radius2, centers7.25/2.25: coverage at x5..8 is (1,5,7,3)/8; opacity1/2 and donor4.
	assert.deepEqual([5, 6, 7, 8].map(x => pixel(result, 9, x, 2)[0]), [0.25, 1.25, 1.75, 0.75]);
});

test('ordered Clone overlaps blend current destinations but donors stay on the immutable Original', async () => {
	const value = frame(5, 1); [0, 2, 4, 8, 16].forEach((gray, x) => put(value, x, 0, [gray, gray, gray, 1]));
	const first = spot('clone', { id: 'first', target: { x: 0.7, y: 0.5 }, source: { x: 0.3, y: 0.5 }, radius: 0.1 });
	const second = { ...first, id: 'second', source: { x: 0.5, y: 0.5 }, opacity: 0.5 };
	assert.deepEqual(pixel(await render(value, [first, second]), 5, 3, 0), [3, 3, 3, 1]);
	assert.deepEqual(pixel(await render(value, [second, first]), 5, 3, 0), [2, 2, 2, 1]);
	const result = await render(value, [{ ...first, target: { x: 0.5, y: 0.5 }, source: { x: 0.1, y: 0.5 } },
		{ ...second, target: { x: 0.9, y: 0.5 }, opacity: 1 }]);
	assert.deepEqual(pixel(result, 5, 2, 0), [0, 0, 0, 1]); assert.deepEqual(pixel(result, 5, 4, 0), [4, 4, 4, 1]);
});

test('linear Heal preserves native guidance and original boundary tone without clipping HDR', async () => {
	const value = donors(), definition = spot('heal', { target: { x: 9.5 / 11, y: 0.5 }, source: { x: 1.5 / 11, y: 0.5 } });
	const first = await render(value, [definition]), second = await render(value, [{ ...definition, source: { x: 5.5 / 11, y: 0.5 } }]);
	// Single-cell screened-Poisson solution: original boundary + donorcenter - donorboundary.
	assert.deepEqual(pixel(first, 11, 9, 1), [4.5, 4.5, 4.5, 1]); assert.deepEqual(pixel(second, 11, 9, 1), [10, 10, 10, 1]);
	changedOnly(first, value.pixels, [20]); changedOnly(second, value.pixels, [20]);
});

test('two-cell linear Heal solves distinct coupled boundary values rather than a mean offset', async () => {
	const value = frame(10, 5); patch(value, 0, 1, 4, 3, -2);
	for (const [x, y] of [[8, 2], [7, 1], [7, 3]]) put(value, x!, y!, [4, 4, 4, 1]);
	const definition = spot('heal', { target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15 });
	const result = await render(value, [definition]);
	// Lambda1, flat donor: 5uL-uR=2; 5uR-uL=14. The exact solution is (1,3).
	assert.deepEqual(pixel(result, 10, 6, 2), [1, 1, 1, 1]); assert.deepEqual(pixel(result, 10, 7, 2), [3, 3, 3, 1]);
	changedOnly(result, value.pixels, [26, 27]);
});

test('ordered Heal overlaps recompute immutable guidance/context while blending destination order', async () => {
	const value = donors(), first = spot('heal', { id: 'first', target: { x: 9.5 / 11, y: 0.5 },
		source: { x: 1.5 / 11, y: 0.5 }, opacity: 0.5 }), second = { ...first, id: 'second', source: { x: 5.5 / 11, y: 0.5 } };
	assert.deepEqual(pixel(await render(value, [first, second]), 11, 9, 1), [6.125, 6.125, 6.125, 1]);
	assert.deepEqual(pixel(await render(value, [second, first]), 11, 9, 1), [4.75, 4.75, 4.75, 1]);
});

test('nonempty native Heal without paired boundary context refuses before delivering a result', async () => {
	let delivered = false;
	await assert.rejects(withImageDevelopLinearCurrentV1({ frame: frame(1, 1, 2), develop: develop([spot('heal', { radius: 1 })]) },
		() => { delivered = true; }, PROFILE), /boundary|context/iu);
	assert.equal(delivered, false);
});

test('native repair work bounds refuse before observing a source pixel accessor', async () => {
	let reads = 0;
	const unread = Object.defineProperty({ descriptor: { ...frame(1, 1).descriptor, width: 4096, height: 4096 } }, 'pixels', {
		enumerable: true, get() { reads++; throw new Error('Pixels were observed before repair work planning.'); },
	});
	const full = spot('clone', { radius: 1 });
	await assert.rejects(withImageDevelopLinearCurrentV1({ frame: unread, develop: develop([full, { ...full, id: 'second' }]) },
		() => assert.fail('Unbounded repair delivered pixels.'), PROFILE), /visit|budget/iu);
	assert.equal(reads, 0);
});

test('inactive repairs are exact native no-ops, while callback cancellation joins and wipes actual output', async () => {
	const value = frame(3, 1); put(value, 0, 0, [-2, 4, 1e-30, 1]);
	for (const changes of [{ enabled: false }, { opacity: 0 }]) assert.deepEqual(await render(value, [spot('clone', changes)]), Array.from(value.pixels));
	const abort = new AbortController(), reason = Object.freeze({ cancelled: 'native repair' }); let output: Float32Array | undefined;
	const outcome = await withImageDevelopLinearCurrentV1({ frame: value, develop: develop([spot('clone')]), signal: abort.signal }, async view => {
		output = view.pixels; await Promise.resolve(); abort.abort(reason); return 'unpublishable';
	}, PROFILE).then(result => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(outcome.ok, false); if (outcome.ok) assert.fail('Cancelled native output was published.');
	assert.equal(Object.is(outcome.error, reason), true); assert.ok(output?.every(sample => sample === 0));
});

test('scalar repair preparation captures closed immutable metadata and reports serial native scratch', () => {
	const value = frame(3, 1), definition = spot('clone'), recipe = { schemaVersion: 1, spots: [definition] };
	const plan = prepareLinearRepairsV1(recipe, value.descriptor, PROFILE.source);
	assert.equal(plan.frameBytes, 48); assert.equal(plan.scratchBytes, 0);
	assert.deepEqual(plan.descriptor, value.descriptor); assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.descriptor));
	const full = prepareLinearRepairsV1({ schemaVersion: 1, spots: [spot('heal', { radius: 0.5 })] },
		{ ...value.descriptor, width: 512, height: 512 }, PROFILE.source);
	assert.equal(full.scratchBytes, 27_529_216, 'Four Float64 RGB planes, Float64 alpha, byte membership and4096 controls.');
	let reads = 0;
	const accessor = Object.defineProperty({ ...definition }, 'radius', { enumerable: true, get() { reads++; return 0.2; } });
	assert.throws(() => prepareLinearRepairsV1({ schemaVersion: 1, spots: [accessor] }, value.descriptor, PROFILE.source));
	assert.equal(reads, 0);
	for (const descriptor of [{ ...value.descriptor, width: 8193 }, { ...value.descriptor, transfer: 'srgb' },
		{ ...value.descriptor, sampleFormat: 'unorm16' }, { ...value.descriptor, primaries: 'display-p3' }]) {
		assert.throws(() => prepareLinearRepairsV1(recipe, descriptor, PROFILE.source));
	}
});

test('native kernel owns prepared identity and refuses aliases or incomplete scratch before target writes', async () => {
	const value = frame(3, 3, 2), output = new Float32Array(value.pixels.length).fill(17);
	const plan = prepareLinearRepairsV1({ schemaVersion: 1, spots: [spot('heal')] }, value.descriptor, PROFILE.source);
	const scratch = new Uint8Array(plan.scratchBytes), untouched = output.slice();
	try {
		await assert.rejects(writeLinearRepairsV1({ ...plan }, value.pixels, output, scratch), /owning/iu);
		await assert.rejects(writeLinearRepairsV1(plan, value.pixels, value.pixels, scratch));
		await assert.rejects(writeLinearRepairsV1(plan, value.pixels, output, scratch.subarray(0, scratch.length - 1)));
		assert.deepEqual(output, untouched); assert.ok(scratch.every(byte => byte === 0));
	} finally { output.fill(0); scratch.fill(0); }
});

test('caller-owned native kernel copies source and captures recipe before mutation without retiring caller storage', async () => {
	const value = frame(3, 1); put(value, 0, 0, [-2, 4, 1e-30, 1]); put(value, 2, 0, [9, 8, 7, 0.5]);
	const definition = spot('clone', { target: { x: 5 / 6, y: 0.5 }, source: { x: 1 / 6, y: 0.5 }, radius: 0.1 });
	const recipe = { schemaVersion: 1, spots: [definition] }, plan = prepareLinearRepairsV1(recipe, value.descriptor, PROFILE.source);
	const output = new Float32Array(value.pixels.length).fill(17), scratch = new Uint8Array(plan.scratchBytes), before = value.pixels.slice();
	recipe.spots.length = 0;
	try {
		await writeLinearRepairsV1(plan, value.pixels, output, scratch);
		assert.deepEqual(pixel(Array.from(output), 3, 2, 0), f32([-2, 4, 1e-30, 0.5]));
		assert.deepEqual(value.pixels, before); assert.ok(output.some(sample => sample !== 0));
	} finally { output.fill(0); scratch.fill(0); }
});

test('native Heal alpha attenuates once and negative boundary reconstruction stays signed', async () => {
	const value = donors(); put(value, 1, 1, [1, 1, 1, 0.5]); put(value, 9, 1, [0, 0, 0, 0.5]);
	const definition = spot('heal', { target: { x: 9.5 / 11, y: 0.5 }, source: { x: 1.5 / 11, y: 0.5 } });
	assert.deepEqual(pixel(await render(value, [definition]), 11, 9, 1), [2.25, 2.25, 2.25, 0.5]);
	const signed = donors();
	for (let offset = 0; offset < signed.pixels.length; offset += 4) for (const channel of [0, 1, 2]) signed.pixels[offset + channel] = signed.pixels[offset + channel]! - 8;
	assert.deepEqual(pixel(await render(signed, [definition]), 11, 9, 1), [-3.5, -3.5, -3.5, 1]);
});

test('native repair kernel checks exact cancellation before writes and after a real task yield', async () => {
	const value = frame(256, 128, 2), output = new Float32Array(value.pixels.length).fill(17), before = value.pixels.slice();
	const plan = prepareLinearRepairsV1({ schemaVersion: 1, spots: [spot('clone', { radius: 1 })] }, value.descriptor, PROFILE.source);
	const scratch = new Uint8Array(plan.scratchBytes), abort = new AbortController(), reason = Object.freeze({ native: 'cancelled' });
	abort.abort(reason);
	const first = await writeLinearRepairsV1(plan, value.pixels, output, scratch, abort.signal)
		.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(first.ok, false); if (first.ok) assert.fail('An already cancelled repair wrote output.');
	assert.equal(Object.is(first.error, reason), true); assert.ok(output.every(sample => sample === 17));
	const during = new AbortController(), timer = setTimeout(() => { during.abort(reason); }, 0);
	try {
		const result = await writeLinearRepairsV1(plan, value.pixels, output, scratch, during.signal)
			.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(result.ok, false); if (result.ok) assert.fail('A cancelled native repair completed.');
		assert.equal(Object.is(result.error, reason), true); assert.deepEqual(value.pixels, before);
	} finally { clearTimeout(timer); output.fill(0); scratch.fill(0); }
});

test('native Heal refuses scratch detached during a joined yield without concealing the physical failure', async () => {
	const value = frame(100, 100, 2), output = new Float32Array(value.pixels.length);
	const plan = prepareLinearRepairsV1({ schemaVersion: 1, spots: [spot('heal', { radius: 0.4 })] }, value.descriptor, PROFILE.source);
	const scratch = new Uint8Array(plan.scratchBytes), timer = setTimeout(() => { structuredClone(scratch.buffer, { transfer: [scratch.buffer] }); }, 0);
	try {
		await assert.rejects(writeLinearRepairsV1(plan, value.pixels, output, scratch), /detach|storage|backing/iu);
		assert.equal(scratch.byteLength, 0);
	} finally { clearTimeout(timer); output.fill(0); }
});
