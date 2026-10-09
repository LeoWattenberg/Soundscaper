/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { withCubeLutPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-cube-lut-v1.ts';
import { normalizeVideoColorGradeV1 } from '../src/common/editor/video-color-management-v27.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

const LIMITS = { maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16 * 1024 * 1024 };
const IDENTITY = ['LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'].join('\n');
const SWAP = ['LUT_3D_SIZE 2', '0 0 0', '0 0 1', '0 1 0', '0 1 1', '1 0 0', '1 0 1', '1 1 0', '1 1 1'].join('\n');
function frame(samples: readonly number[] = [0, 64, 128, 0, 255, 32, 16, 1, 128, 128, 128, 175, 64, 128, 255, 255]) {
	return { descriptor: { schemaVersion: 1, width: samples.length / 4, height: 1,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(samples) };
}
function request(text = IDENTITY, source = frame(), changes: Record<string, unknown> = {}) {
	const body = parseCubeLutV1(text);
	const grade = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), ...changes,
		lut: { storageKey: `lut-sha256:${body.sha256}`, sha256: body.sha256, byteLength: body.byteLength,
			size: body.size, domainMin: body.domainMin, domainMax: body.domainMax } });
	return { frame: source, grade, bytes: new TextEncoder().encode(text) };
}
async function bytes(input: unknown) {
	return withCubeLutPixelFrameV1(input, rendered => Array.from(rendered.pixels), { limits: LIMITS });
}

test('identity LUT preserves every byte and all256 straight alphas, including hidden RGB', async () => {
	const samples = Array.from({ length: 256 }, (_, value) => [value, 255 - value, (value * 13) % 256, value]).flat();
	const source = frame(samples), before = source.pixels.slice();
	assert.deepEqual(await bytes(request(IDENTITY, source)), samples);
	assert.deepEqual(source.pixels, before);
});

test('red-fastest asymmetric LUT swaps red/blue exactly without changing green or alpha', async () => {
	const samples = Array.from({ length: 256 }, (_, value) => [value, 91, 255 - value, value]).flat();
	const expected = Array.from({ length: 256 }, (_, value) => [255 - value, 91, value, value]).flat();
	assert.deepEqual(await bytes(request(SWAP, frame(samples))), expected);
});

test('numeric grade precedes LUT in linear Rec709 and uses the existing V27 transfer rounding', async () => {
	assert.deepEqual(await bytes(request(IDENTITY, frame(), { exposureStops: 1 })),
		[0, 90, 176, 0, 255, 47, 26, 1, 176, 176, 176, 175, 90, 176, 255, 255]);
	// A constant linear .25 red table encodes to137, rather than encoded-byte64.
	const linearQuarter = `LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`;
	assert.deepEqual(await bytes(request(linearQuarter, frame([255, 128, 64, 175]))), [137, 0, 0, 175]);
});

test('output descriptor remains truthful encoded sRGB UNORM8 and exactly the natural source extent', async () => {
	await withCubeLutPixelFrameV1(request(), rendered => {
		assert.deepEqual(rendered.descriptor, frame().descriptor);
		assert.equal(Object.isFrozen(rendered.descriptor), true);
	}, { limits: LIMITS });
});

test('unsupported profile, byte geometry, grade and output extent refuse before a consumer', async () => {
	const input = request();
	let getters = 0;
	const bad = Object.defineProperty({ ...input.frame }, 'pixels', { enumerable: true,
		get() { getters++; throw new Error('pixel getter'); } });
	for (const value of [{ ...input, extra: true }, { ...input, frame: bad },
		{ ...input, grade: { ...input.grade, lut: null } },
		{ ...input, frame: { ...input.frame, descriptor: { ...input.frame.descriptor, transfer: 'linear' } } },
		{ ...input, frame: { ...input.frame, descriptor: { ...input.frame.descriptor, width: 2049 } } },
		{ ...input, frame: { ...input.frame, pixels: new Uint8Array(1) } },
		{ ...input, frame: { ...input.frame, pixels: new Uint8Array(new SharedArrayBuffer(16)) } }]) {
		await assert.rejects(withCubeLutPixelFrameV1(value, () => assert.fail('invalid frame consumed'), { limits: LIMITS }));
	}
	assert.equal(getters, 0);
});

test('borrowed output is joined and wiped after an actual asynchronous consumer succeeds or refuses', async () => {
	for (const fails of [false, true]) {
		const input = request(SWAP);
		let borrowed: PixelFrameV1 | undefined, release!: () => void, entered!: () => void;
		const held = new Promise<void>(resolve => { release = resolve; });
		const started = new Promise<void>(resolve => { entered = resolve; });
		const failure = new Error('consumer refuses');
		const operation = withCubeLutPixelFrameV1(input, async rendered => {
			borrowed = rendered; entered(); await held;
			assert.deepEqual(Array.from(rendered.pixels.slice(0, 4)), [128, 64, 0, 0]);
			if (fails) throw failure;
			return 19;
		}, { limits: LIMITS });
		await started;
		assert.equal(borrowed?.pixels[0], 128);
		release();
		if (fails) await assert.rejects(operation, error => error === failure);
		else assert.equal(await operation, 19);
		assert.equal(borrowed?.pixels.every(byte => byte === 0), true);
		assert.equal(input.frame.pixels[2], 128);
	}
});

test('native opaque cancellation joins a held output and never inspects signal shadows or the reason', async () => {
	let traps = 0, release!: () => void, entered!: () => void;
	const reason = new Proxy({}, { get() { traps++; throw new Error('reason inspected'); },
		getPrototypeOf() { traps++; throw new Error('reason prototype'); } });
	const controller = new AbortController();
	Object.defineProperties(controller.signal, { throwIfAborted: { get() { traps++; throw new Error('check shadow'); } },
		aborted: { get() { traps++; throw new Error('aborted shadow'); } },
		reason: { get() { traps++; throw new Error('reason shadow'); } } });
	const held = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	let borrowed: PixelFrameV1 | undefined, settled = false;
	const operation = withCubeLutPixelFrameV1({ ...request(), signal: controller.signal }, async rendered => {
		borrowed = rendered; entered(); await held;
	}, { limits: LIMITS });
	void operation.then(() => { settled = true; }, () => { settled = true; });
	await started; controller.abort(reason); await Promise.resolve(); assert.equal(settled, false);
	release(); await operation.then(() => assert.fail('expected cancellation'), error => { assert.equal(error, reason); });
	assert.equal(borrowed?.pixels.every(byte => byte === 0), true);
	assert.equal(traps, 0);
});

test('pre-aborted native frame demand refuses before grade, frame or option traversal', async () => {
	const controller = new AbortController(), reason = {};
	controller.abort(reason);
	let inspected = 0;
	const nested = new Proxy({}, { getPrototypeOf() { inspected++; throw new Error('nested admission'); } });
	await withCubeLutPixelFrameV1({ signal: controller.signal, frame: nested, grade: nested, bytes: nested },
		() => assert.fail('cancelled demand consumed'), nested as Readonly<{ limits: typeof LIMITS }>)
		.then(() => assert.fail('expected native cancellation'), error => { assert.equal(error, reason); });
	assert.equal(inspected, 0);
});

test('real task cancellation refuses partial publication and wipes every owned transformed allocation', async () => {
	const Native = globalThis.Uint8Array, allocations: Uint8Array[] = [];
	const source = { descriptor: { ...frame().descriptor, width: 512, height: 256 },
		pixels: new Native(512 * 256 * 4).fill(128) };
	const input = request(SWAP, source), controller = new AbortController(), reason = {};
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args) {
		const value = Reflect.construct(target, args) as Uint8Array;
		if (args.length === 1 && typeof args[0] === 'number') allocations.push(value);
		return value;
	} });
	try {
		setTimeout(() => { controller.abort(reason); }, 0);
		await assert.rejects(withCubeLutPixelFrameV1({ ...input, signal: controller.signal },
			() => assert.fail('partial output consumed'), { limits: LIMITS }), error => error === reason);
	} finally { globalThis.Uint8Array = Native; }
	assert.equal(allocations.some(value => value.length === source.pixels.length), true);
	assert.equal(allocations.every(value => value.every(byte => byte === 0)), true);
	assert.equal(source.pixels.every(byte => byte === 128), true);
});

test('transferring the source at a real task yield cannot expose partial output', async () => {
	const source = { descriptor: { ...frame().descriptor, width: 512, height: 256 },
		pixels: new Uint8Array(512 * 256 * 4).fill(128) };
	setTimeout(() => { structuredClone(source.pixels.buffer, { transfer: [source.pixels.buffer] }); }, 0);
	await assert.rejects(withCubeLutPixelFrameV1(request(SWAP, source), () => assert.fail('transferred frame consumed'),
		{ limits: LIMITS }), /detach|changed/iu);
});

test('transfer during a held consumer rejects fulfillment and native abort takes precedence over detachment', async () => {
	for (const cancel of [false, true]) {
		const input = request(), controller = new AbortController(), reason = {};
		let borrowed: PixelFrameV1 | undefined;
		const operation = withCubeLutPixelFrameV1({ ...input, signal: controller.signal }, rendered => {
			borrowed = rendered;
			structuredClone(input.frame.pixels.buffer, { transfer: [input.frame.pixels.buffer] });
			if (cancel) controller.abort(reason);
		}, { limits: LIMITS });
		if (cancel) await assert.rejects(operation, error => error === reason);
		else await assert.rejects(operation, /detach|changed/iu);
		assert.equal(borrowed?.pixels.every(byte => byte === 0), true);
	}
});

test('output allocation refusal releases the already admitted raw resource and preserves an opaque failure', async () => {
	const input = request(), Native = globalThis.Uint8Array;
	let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('opaque allocation inspected'); } });
	const owned: Uint8Array[] = [];
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args) {
		if (args.length === 1 && args[0] === input.frame.pixels.length) throw reason;
		const allocation = Reflect.construct(target, args) as Uint8Array;
		if (args.length === 1 && args[0] === input.bytes.length) owned.push(allocation);
		return allocation;
	} });
	try {
		await withCubeLutPixelFrameV1(input, () => assert.fail('allocation refused'), { limits: LIMITS })
			.then(() => assert.fail('expected allocation failure'), error => { assert.equal(error, reason); });
	} finally { globalThis.Uint8Array = Native; }
	assert.equal(owned.length, 1);
	assert.equal(owned[0]?.every(byte => byte === 0), true);
	assert.equal(traps, 0);
	assert.equal(input.frame.pixels[2], 128);
});

test('a transfer while the inner consumer finishes is still refused at the outer resource settlement fence', async () => {
	const input = request();
	let output: PixelFrameV1 | undefined;
	await assert.rejects(withCubeLutPixelFrameV1(input, rendered => {
		output = rendered;
		queueMicrotask(() => { queueMicrotask(() => {
			structuredClone(input.frame.pixels.buffer, { transfer: [input.frame.pixels.buffer] });
		}); });
		return 'not published';
	}, { limits: LIMITS }), /detach|changed/iu);
	assert.equal(output?.pixels.every(byte => byte === 0), true);
});
