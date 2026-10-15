/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

async function owner() {
	assert.ok(existsSync(new URL('../src/common/editor/imaging/image-hdr-merge-contract-v1.ts', import.meta.url)), 'HDR needs its explicit bounded merge contract owner.');
	return import('../src/common/editor/imaging/image-hdr-merge-contract-v1.ts');
}
function descriptor(width = 64, height = 48, sampleFormat = 'unorm16', transfer = 'linear') {
	return { schemaVersion: 1, width, height, sampleFormat, primaries: 'srgb', transfer };
}
function request() { return { schemaVersion: 1, referenceIndex: 1, alignment: 'ward-mtb-v1', deghost: { mode: 'reference-v1', threshold: .05 },
	inputs: [{ descriptor: descriptor(), exposureMultiplier: .25 }, { descriptor: descriptor(), exposureMultiplier: 1 }, { descriptor: descriptor(), exposureMultiplier: 4 }] }; }

test('HDR scalar admission owns complete canonical input metadata and explicit exposure controls', async () => {
	const api = await owner(), value = request(), plan = api.prepareImageHdrMergeV1(value);
	value.inputs[0]!.exposureMultiplier = 8; value.deghost.threshold = .9;
	assert.equal(plan.inputs[0]!.exposureMultiplier, .25); assert.equal(plan.referenceIndex, 1); assert.equal(plan.deghost.threshold, .05);
	assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.inputs)); assert.ok(Object.isFrozen(plan.inputs[0]!.descriptor));
	assert.ok(plan.maximumTileWorkingBytes <= 16 * 1024 * 1024); assert.ok(plan.maximumAlignmentWorkingBytes <= 96 * 1024 * 1024);
	assert.equal(api.prepareImageHdrMergeV1({ ...request(), inputs: request().inputs.map(input => ({ ...input, descriptor: descriptor(64, 48, 'unorm8', 'srgb') })) }).inputs.length, 3);
});

test('HDR scalar admission refuses unknown processing, implicit exposure, mismatched extent and excessive input counts', async () => {
	const api = await owner();
	for (const invalid of [
		{ ...request(), inputs: [request().inputs[0]] }, { ...request(), inputs: Array.from({ length: 10 }, () => request().inputs[1]) },
		{ ...request(), referenceIndex: 3 }, { ...request(), alignment: 'optical-flow' }, { ...request(), deghost: { mode: 'reference-v1', threshold: 1.01 } },
		{ ...request(), inputs: request().inputs.map(input => ({ ...input, descriptor: descriptor(8193, 1) })) },
		{ ...request(), inputs: request().inputs.map(input => ({ ...input, descriptor: descriptor(8192, 4096) })) },
		{ ...request(), inputs: request().inputs.map(input => ({ ...input, descriptor: { ...descriptor(), primaries: 'display-p3' } })) },
		{ ...request(), inputs: request().inputs.map(input => ({ ...input, descriptor: descriptor(64, 48, 'float32', 'linear') })) },
		{ ...request(), inputs: [request().inputs[0], { descriptor: descriptor(63), exposureMultiplier: 1 }] },
		{ ...request(), inputs: request().inputs.map(input => ({ ...input, exposureMultiplier: .5 })) },
		...[-1, 0, 1 / 131072, 131072, NaN, Infinity].map(exposureMultiplier => ({ ...request(), inputs: [{ descriptor: descriptor(), exposureMultiplier }, request().inputs[1]] })),
	]) assert.throws(() => api.prepareImageHdrMergeV1(invalid));
	let access = 0;
	assert.throws(() => api.prepareImageHdrMergeV1({ ...request(), inputs: [Object.defineProperty({}, 'descriptor', { enumerable: true, get() { access++; return descriptor(); } }), request().inputs[1]] }));
	assert.equal(access, 0);
});

test('actual translated rectangles define one reference-space common intersection and Float32 result extent', async () => {
	const api = await owner(), plan = api.prepareImageHdrMergeV1(request());
	// Offset is candidate placement in reference space; sampling subtracts it.
	const aligned = api.finalizeImageHdrMergeV1(plan, [{ x: 7, y: -4, error: .01, support: 1000 }, { x: 0, y: 0, error: 0, support: 3072 }, { x: -3, y: 2, error: .02, support: 900 }]);
	assert.deepEqual(aligned.output, { x: 7, y: 2, width: 54, height: 42 });
	assert.deepEqual(aligned.descriptor, { schemaVersion: 1, width: 54, height: 42, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
	assert.equal(aligned.offsets[0]!.x, 7); assert.equal(aligned.offsets[2]!.y, 2);
	assert.throws(() => api.finalizeImageHdrMergeV1({ ...plan }, aligned.offsets), /own|prepared|authentic/iu);
	for (const offsets of [[], [{ x: 129, y: 0, error: 0, support: 2 }, ...aligned.offsets.slice(1)],
		[aligned.offsets[0], { x: 1, y: 0, error: 0, support: 2 }, aligned.offsets[2]],
		[{ x: .5, y: 0, error: 0, support: 2 }, ...aligned.offsets.slice(1)],
		[{ x: 0, y: 0, error: NaN, support: 2 }, ...aligned.offsets.slice(1)]]) assert.throws(() => api.finalizeImageHdrMergeV1(plan, offsets));
});

test('alignment-none remains an explicit zero-translation contract and cannot smuggle a saved transform', async () => {
	const api = await owner(), plan = api.prepareImageHdrMergeV1({ ...request(), alignment: 'none' });
	const zeros = plan.inputs.map(() => ({ x: 0, y: 0, error: 0, support: 3072 }));
	assert.deepEqual(api.finalizeImageHdrMergeV1(plan, zeros).output, { x: 0, y: 0, width: 64, height: 48 });
	assert.throws(() => api.finalizeImageHdrMergeV1(plan, [{ ...zeros[0], x: 1 }, ...zeros.slice(1)]));
});
