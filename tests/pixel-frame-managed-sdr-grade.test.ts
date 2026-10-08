/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { withManagedSdrPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-managed-sdr-grade-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { defaultVideoSourceColorInterpretationV1 } from '../src/common/editor/video-color-management-v27.ts';
import { prepareManagedSdrGradeStackV1 } from '../src/common/editor/video-color-management-v27.ts';
import { applyPreparedManagedSdrByteFrameV1 } from '../src/common/editor/video-color-byte-encoding.ts';

const LIMITS = { maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 };
const INTERPRETATION = defaultVideoSourceColorInterpretationV1('still', 'grade-source');
function grade(overrides: Record<string, unknown> = {}) {
	return { schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null, ...overrides };
}
function frame(bytes: readonly number[] = [0, 64, 128, 0, 255, 32, 16, 1, 128, 128, 128, 128, 64, 128, 255, 255]) {
	return { descriptor: { schemaVersion: 1, width: bytes.length / 4, height: 1,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(bytes) };
}
function request(overrides: Record<string, unknown> = {}) {
	return { frame: frame(), grades: [grade({ exposureStops: 1 })], decoding: 'file',
		interpretation: INTERPRETATION, output: 'srgb', ...overrides };
}
async function bytes(input: unknown = request()) {
	return withManagedSdrPixelFrameV1(input, rendered => Array.from(rendered.pixels), { limits: LIMITS });
}

test('managed SDR exposure pins independent encoded and linear byte goldens with exact straight alpha', async () => {
	assert.deepEqual(await bytes(), [0, 90, 176, 0, 255, 47, 26, 1, 176, 176, 176, 128, 90, 176, 255, 255]);
	assert.deepEqual(await bytes(request({ output: 'linear-rec709-d65' })),
		[0, 26, 110, 0, 255, 7, 3, 1, 110, 110, 110, 128, 26, 110, 255, 255]);
});

test('output descriptors name sRGB, Rec.709 and linear samples truthfully', async () => {
	for (const [output, primaries, transfer] of [
		['srgb', 'srgb', 'srgb'], ['rec709', 'bt709', 'bt709'], ['linear-rec709-d65', 'bt709', 'linear'],
	]) await withManagedSdrPixelFrameV1(request({ output }), rendered => {
		assert.equal(rendered.descriptor.primaries, primaries);
		assert.equal(rendered.descriptor.transfer, transfer);
	}, { limits: LIMITS });
});

test('ordered lift/gain stacks and authored LGG use independent linear goldens', async () => {
	const source = frame([64, 128, 192, 37]);
	source.descriptor.transfer = 'linear';
	source.descriptor.primaries = 'bt709';
	const input = request({ frame: source, decoding: 'linear', output: 'linear-rec709-d65',
		grades: [grade({ lift: [0.1, 0.1, 0.1] }), grade({ gain: [0.5, 0.5, 0.5] })] });
	assert.deepEqual(await bytes(input), [45, 77, 109, 37]);
	assert.deepEqual(await bytes({ ...input, grades: [...input.grades as unknown[]].reverse() }), [58, 90, 122, 37]);
	assert.deepEqual(await bytes({ ...input, grades: [grade({ contrast: 0.5, pivot: 0.25,
		lift: [0.1, 0, 0], gamma: [1, 2, 1], gain: [0.5, 1, 2], saturation: 0 })] }), [140, 140, 140, 37]);
});

test('ungraded identity is deterministic and never changes borrowed source bytes', async () => {
	const source = frame();
	const original = Array.from(source.pixels);
	const input = request({ frame: source, grades: [] });
	assert.deepEqual(await bytes(input), original);
	assert.deepEqual(await bytes(input), original);
	assert.deepEqual(Array.from(source.pixels), original);
});

test('the output is borrowed until the asynchronous consumer settles, then wiped on success or error', async () => {
	for (const fails of [false, true]) {
		let borrowed: PixelFrameV1 | undefined;
		let release!: () => void;
		const held = new Promise<void>(resolve => { release = resolve; });
		const failure = new Error('consumer refused');
		const operation = withManagedSdrPixelFrameV1(request(), async rendered => {
			borrowed = rendered;
			await held;
			assert.equal(rendered.pixels[2], 176);
			if (fails) throw failure;
			return 'consumed';
		}, { limits: LIMITS });
		await Promise.resolve();
		assert.equal(borrowed?.pixels[2], 176);
		release();
		if (fails) await assert.rejects(operation, error => error === failure);
		else assert.equal(await operation, 'consumed');
		assert.equal(borrowed?.pixels.every(value => value === 0), true);
	}
});

test('native cancellation during a consumer wipes its borrowed output and preserves the reason', async () => {
	const controller = new AbortController();
	const reason = new DOMException('grade cancelled', 'AbortError');
	let borrowed: PixelFrameV1 | undefined;
	await assert.rejects(withManagedSdrPixelFrameV1(request({ signal: controller.signal }), rendered => {
		borrowed = rendered;
		controller.abort(reason);
	}, { limits: LIMITS }), error => error === reason);
	assert.equal(borrowed?.pixels.every(value => value === 0), true);
});

test('large grades yield a real task and cancel before exposing partially rendered output', async () => {
	const pixels = new Uint8Array(512 * 512 * 4).fill(128);
	const source = { descriptor: { ...frame().descriptor, width: 512, height: 512 }, pixels };
	const controller = new AbortController();
	const reason = new DOMException('task cancellation', 'AbortError');
	let consumed = 0;
	setTimeout(() => { controller.abort(reason); }, 0);
	await assert.rejects(withManagedSdrPixelFrameV1(request({ frame: source, signal: controller.signal }), () => {
		consumed += 1;
	}, { limits: LIMITS }), error => error === reason);
	assert.equal(consumed, 0);
	assert.equal(pixels.every(value => value === 128), true);
});

test('strict requests, grades and profiles refuse without invoking accessors or consumers', async () => {
	let getters = 0;
	const accessor = Object.defineProperty(request(), 'output', { get() { getters += 1; return 'srgb'; } });
	const accessorFrame = Object.defineProperty({ descriptor: { ...frame().descriptor, sampleFormat: 'float32' } },
		'pixels', { enumerable: true, get() { getters += 1; throw new Error('pixels read'); } });
	const malformedGrade = Object.defineProperty(grade(), 'gain', { enumerable: true, get() { getters += 1; return [1, 1, 1]; } });
	for (const input of [accessor, request({ extra: true }), request({ frame: accessorFrame }),
		request({ grades: [malformedGrade] }), request({ output: 'display-p3' }),
		request({ decoding: 'unknown' }), request({ grades: Array.from({ length: 65 }, () => grade()) }),
		request({ grades: [grade({ lut: {} })] }), request({ grades: [grade({ exposureStops: 13 })] }),
		request({ frame: { ...frame(), descriptor: { ...frame().descriptor, transfer: 'bt709' } } }),
		request({ frame: { ...frame(), pixels: new Uint8Array(1) } }),
	]) await assert.rejects(withManagedSdrPixelFrameV1(input, () => assert.fail('refused frame consumed'), { limits: LIMITS }));
	assert.equal(getters, 0);
});

test('all 64 legal numeric grades fit the settings budget', async () => {
	const grades = Array.from({ length: 64 }, () => grade({ exposureStops: -1.2345678901234567e-100,
		contrast: 1.0000000000000002, pivot: 0.12345678901234568,
		lift: [-1.2345678901234567e-100, -1.2345678901234567e-100, -1.2345678901234567e-100] }));
	assert.deepEqual(await bytes(request({ grades, frame: frame([128, 128, 128, 71]) })), [128, 128, 128, 71]);
});

test('authored grade values are snapshotted before a task can mutate the caller settings', async () => {
	const authored = grade({ exposureStops: 1 });
	const source = { descriptor: { ...frame().descriptor, width: 512, height: 256 },
		pixels: new Uint8Array(512 * 256 * 4).fill(128) };
	setTimeout(() => { authored.exposureStops = 0; }, 0);
	const edges = await withManagedSdrPixelFrameV1(request({ frame: source, grades: [authored] }), rendered => (
		[rendered.pixels[0], rendered.pixels.at(-4)]
	), { limits: LIMITS });
	assert.deepEqual(edges, [176, 176]);
	assert.equal(authored.exposureStops, 0, 'the timer mutation ran between chunks');
});

test('a pre-aborted native signal refuses even if its public cancellation method is shadowed', async () => {
	const controller = new AbortController();
	const reason = new DOMException('already cancelled', 'AbortError');
	controller.abort(reason);
	Object.defineProperty(controller.signal, 'throwIfAborted', { value: () => undefined });
	await assert.rejects(withManagedSdrPixelFrameV1(request({ signal: controller.signal }), () => assert.fail('consumer called'),
		{ limits: LIMITS }), error => error === reason);
});

test('the reused byte kernel wipes partially transformed output on grade failure or row cancellation', () => {
	const native = globalThis.Uint8Array;
	for (const cancellation of [false, true]) {
		const source = new native([0, 0, 0, 77, 128, 128, 128, 111]);
		const prepared = prepareManagedSdrGradeStackV1({ interpretation: INTERPRETATION,
			grades: [grade(cancellation ? {} : { exposureStops: 12, gain: [16, 16, 16], gamma: [0.01, 0.01, 0.01] })] });
		const controller = new AbortController();
		const reason = new DOMException('second row cancelled', 'AbortError');
		let rows = 0;
		if (cancellation) Object.defineProperty(controller.signal, 'aborted', { get() {
			rows += 1;
			if (rows === 2) controller.abort(reason);
			return rows === 2;
		} });
		const allocations: Uint8Array[] = [];
		globalThis.Uint8Array = new Proxy(native, { construct(target, argumentsList) {
			const output = Reflect.construct(target, argumentsList) as Uint8Array;
			allocations.push(output);
			return output;
		} });
		try {
			assert.throws(() => applyPreparedManagedSdrByteFrameV1(prepared,
				{ width: 1, height: 2, pixels: source }, 'srgb', controller.signal),
				cancellation ? (error: unknown) => error === reason : RangeError);
		} finally { globalThis.Uint8Array = native; }
		assert.equal(allocations.length, 1);
		assert.equal(allocations[0]?.every(value => value === 0), true,
			'the first row alpha77 must be wiped after second-row failure');
		assert.equal(source[3], 77);
	}
});
