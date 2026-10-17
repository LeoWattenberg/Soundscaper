/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopGpuCurrentV1 } from '../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
function fixture() {
	const body = parseCubeLutV1(TEXT), bytes = new TextEncoder().encode(TEXT);
	const reference = { storageKey: `lut-sha256:${body.sha256}`, sha256: body.sha256, byteLength: body.byteLength,
		size: body.size, domainMin: body.domainMin, domainMax: body.domainMax };
	return { reference, bytes, effect: { id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference } } };
}
function frame(pixels = Float32Array.of(.125, .25, .75, .375)) {
	return { descriptor: { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'float32' as const,
		primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
}
const develop = (effects: readonly unknown[]) => normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects });
function port(bytes: Uint8Array<ArrayBuffer>) {
	let reads = 0;
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); assert.equal(reference.byteLength, bytes.byteLength); reads++; return consume(bytes);
	} };
	return { source, get reads() { return reads; } };
}

test('native GPU LUT reaches actual context admission and then whole CPU fallback with exact resource samples', async () => {
	const selected = fixture(), source = port(selected.bytes), input = frame(), before = input.pixels.slice();
	let callbacks = 0;
	const output = await withImageDevelopGpuCurrentV1({ frame: input, develop: develop([selected.effect]) }, (result, execution) => {
		callbacks++; assert.equal(execution.backend, 'cpu'); assert.match(execution.reason!, /canvas|context|float-target/u); return [...result.pixels];
	}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source: source.source });
	assert.deepEqual(output, [.75, .25, .125, .375]); assert.deepEqual(input.pixels, before);
	assert.equal(callbacks, 1); assert.equal(source.reads, 2, 'GPU authentication retires before the separate complete CPU phase');
});

test('color LUT color order remains noncommutative across the complete GPU-to-CPU fallback', async () => {
	const selected = fixture(), source = port(selected.bytes);
	const exposure = (id: string, amount: number) => ({ id, type: 'tone-ladder-v1', enabled: true, params: { exposure: amount } });
	const effects = [exposure('first', 1), selected.effect, exposure('last', -1)], input = frame(Float32Array.of(.75, .125, .25, 0));
	const run = (effects: readonly unknown[]) => withImageDevelopGpuCurrentV1({ frame: input, develop: develop(effects) }, (result, execution) => {
		assert.notEqual(execution.reason, 'unsupported-stage'); return [...result.pixels];
	}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source: source.source });
	assert.deepEqual(await run(effects), [.25, .125, .5, 0]);
	assert.deepEqual(await run([...effects].reverse()), [.25, .125, .75, 0]);
	assert.equal(source.reads, 4);
});

test('the native Original snapshot precedes the first asynchronous authenticated resource read', async () => {
	const selected = fixture(), input = frame(); let reads = 0, callbacks = 0, release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		if (++reads === 1) await held; return consume(selected.bytes);
	} };
	const pending = withImageDevelopGpuCurrentV1({ frame: input, develop: develop([selected.effect]) }, (result, execution) => {
		callbacks++; assert.notEqual(execution.reason, 'unsupported-stage'); return [...result.pixels];
	}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source });
	assert.equal(reads, 1); input.pixels.fill(1); assert.equal(callbacks, 0); release();
	assert.deepEqual(await pending, [.75, .25, .125, .375]); assert.equal(callbacks, 1); assert.equal(reads, 2);
});

test('complete LUT reference and own resource authority admission precede native pixel access', async () => {
	const selected = fixture(); let pixelReads = 0, sourceReads = 0;
	const input = { descriptor: frame().descriptor, get pixels() { pixelReads++; return frame().pixels; } };
	const source: CubeLutSourcePortV1 = { withBytes() { sourceReads++; return Promise.reject(new Error('must not open')); } };
	await assert.rejects(withImageDevelopGpuCurrentV1({ frame: input, develop: { ...defaultImageDevelopStateV2(),
		effects: [{ ...selected.effect, params: { lut: { ...selected.reference, storageKey: 'wrong' } } }] } }, () => undefined,
	PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source }));
	await assert.rejects(withImageDevelopGpuCurrentV1({ frame: input, develop: develop([selected.effect]) }, () => undefined,
		PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source: Object.create(source) as CubeLutSourcePortV1 }));
	assert.equal(pixelReads, 0); assert.equal(sourceReads, 0);
});

test('corrupt authenticated LUT bytes and opaque resource retirement failures never replay through CPU', async () => {
	const selected = fixture(), corrupt = selected.bytes.slice(); corrupt[corrupt.length - 1] = 48;
	let callbacks = 0, reads = 0; const failure = Object.create(null) as object;
	for (const cleanup of [false, true]) {
		const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
			reads++; await consume(cleanup ? selected.bytes : corrupt); throw failure;
		} };
		const pending = withImageDevelopGpuCurrentV1({ frame: frame(), develop: develop([selected.effect]) }, () => { callbacks++; },
			PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source });
		if (cleanup) await assert.rejects(pending, error => Object.is(error, failure));
		else await assert.rejects(pending, /digest|body|SHA/u);
	}
	assert.equal(callbacks, 0); assert.equal(reads, 2);
});

test('LUT GPU preabort preserves an opaque reason before any metadata or source reflection', async () => {
	const controller = new AbortController(), reason = Object.create(null) as object; controller.abort(reason);
	let reads = 0; const hostile = new Proxy({}, { get() { reads++; throw new Error('reflected'); }, getPrototypeOf() { reads++; throw new Error('reflected'); } });
	await assert.rejects(withImageDevelopGpuCurrentV1({ frame: hostile, develop: hostile, signal: controller.signal }, () => undefined,
		PHOTO_DEVELOP_LINEAR_LIMITS_V1, hostile), error => Object.is(error, reason)); assert.equal(reads, 0);
});
