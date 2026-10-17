/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { globalDevelopPreviewPassV1, copyGlobalDevelopPreviewLookupV1 } from '../src/common/editor/video-global-develop-v1.ts';
import { bindVideoGlobalDevelopGpu, disposeVideoGlobalDevelopGpu } from '../src/common/editor/controller/clip-video/video-global-develop-gpu.ts';

const pass = () => globalDevelopPreviewPassV1(createVideoEffect('white-balance-v1', { params: { temperature: 100 } }))!;
test('owning prepared transfer copies retain independent byte goldens and cannot mutate later render plans', () => {
	const prepared = pass(), bytes = copyGlobalDevelopPreviewLookupV1(prepared);
	assert.equal(bytes.length, 1024); assert.deepEqual(Array.from(bytes.slice(64 * 4, 64 * 4 + 4)), [90,64,44,255]);
	assert.deepEqual(Array.from(bytes.slice(128 * 4, 128 * 4 + 4)), [176,128,92,255]); bytes.fill(0);
	assert.deepEqual(Array.from(copyGlobalDevelopPreviewLookupV1(prepared).slice(128 * 4, 128 * 4 + 4)), [176,128,92,255]);
});
test('forged or copied pass identities refuse before reflecting caller values or acquiring resources', () => {
	let reads = 0; const value = new Proxy({}, { get() { reads++; throw Error(); }, getPrototypeOf() { reads++; throw Error(); } });
	for (const input of [value, { ...pass() }, null]) assert.throws(() => copyGlobalDevelopPreviewLookupV1(input));
	assert.equal(reads, 0); const gpu = fixture(); assert.throws(() => bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, value));
	assert.equal(gpu.created, 0);
});
test('one context owns one nearest lookup texture, serial uploads, transient wipe and exact retirement', () => {
	const gpu = fixture(), first = pass(); bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, first);
	assert.equal(gpu.created, 1); assert.equal(gpu.uploads.length, 1); assert.equal(gpu.transferred!.every(byte => byte === 0), true);
	assert.deepEqual(Array.from(gpu.uploads[0]!.slice(64 * 4, 64 * 4 + 4)), [90,64,44,255]);
	bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, first); assert.equal(gpu.uploads.length, 1);
	bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, globalDevelopPreviewPassV1(createVideoEffect('tone-ladder-v1', { params: { exposure: 1 } }))!);
	assert.equal(gpu.created, 1); assert.equal(gpu.uploads.length, 2); assert.deepEqual(gpu.samplers, [2,2,2]);
	assert.ok(gpu.parameters.every(([, value]) => value === gpu.gl.NEAREST || value === gpu.gl.CLAMP_TO_EDGE));
	disposeVideoGlobalDevelopGpu(gpu.gl); disposeVideoGlobalDevelopGpu(gpu.gl); assert.equal(gpu.deleted, 1);
	bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, first); assert.equal(gpu.created, 2); disposeVideoGlobalDevelopGpu(gpu.gl);
});
test('failed native upload still wipes its copy and remains under explicit cleanup ownership', () => {
	const gpu = fixture(), failure = new Error('upload'); gpu.fail = failure;
	assert.throws(() => bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, pass()), error => error === failure);
	assert.equal(gpu.transferred!.every(byte => byte === 0), true);
	assert.throws(() => bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, null));
	assert.deepEqual(gpu.samplers, []); disposeVideoGlobalDevelopGpu(gpu.gl); assert.equal(gpu.deleted, 1);
});
test('native upload reentry cannot replace or dispose the current context transfer', () => {
	const gpu = fixture(); let observed = 0;
	gpu.beforeUpload = () => {
		observed++; if (observed !== 1) return;
		assert.throws(() => bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, pass()), /already active/u);
		assert.throws(() => disposeVideoGlobalDevelopGpu(gpu.gl), /already active/u);
	};
	bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, pass()); assert.equal(observed, 1);
	assert.equal(gpu.created, 1); assert.equal(gpu.uploads.length, 1); disposeVideoGlobalDevelopGpu(gpu.gl);
});
test('failed texture parameter setup is completed on retry before uploading or using the sampler', () => {
	const gpu = fixture(), prepared = pass(), failure = new Error('sampler setup'); gpu.parameterFailure = failure;
	assert.throws(() => bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, prepared), error => error === failure);
	assert.equal(gpu.uploads.length, 0); assert.deepEqual(gpu.samplers, []); gpu.parameterFailure = null;
	bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, prepared);
	assert.equal(gpu.created, 1); assert.equal(gpu.parameters.length, 5);
	assert.deepEqual(gpu.parameters.slice(1), [[gpu.gl.TEXTURE_MIN_FILTER, gpu.gl.NEAREST], [gpu.gl.TEXTURE_MAG_FILTER, gpu.gl.NEAREST],
		[gpu.gl.TEXTURE_WRAP_S, gpu.gl.CLAMP_TO_EDGE], [gpu.gl.TEXTURE_WRAP_T, gpu.gl.CLAMP_TO_EDGE]]);
	assert.equal(gpu.uploads.length, 1); assert.deepEqual(gpu.samplers, [2]); disposeVideoGlobalDevelopGpu(gpu.gl);
});

function fixture() {
	const owner = { created: 0, deleted: 0, uploads: [] as Uint8Array[], samplers: [] as number[], parameters: [] as number[][],
		transferred: null as Uint8Array | null, fail: null as Error | null, parameterFailure: null as Error | null,
		beforeUpload: null as (() => void) | null, location: {} as WebGLUniformLocation,
		gl: null as unknown as WebGL2RenderingContext };
	owner.gl = { TEXTURE0: 0, TEXTURE2: 2, TEXTURE_2D: 3553, NEAREST: 9728, CLAMP_TO_EDGE: 33071,
		TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, RGBA: 6408, UNSIGNED_BYTE: 5121,
		createTexture() { owner.created++; return {}; }, deleteTexture() { owner.deleted++; }, activeTexture() {}, bindTexture() {},
		texParameteri(_target: number, name: number, value: number) { owner.parameters.push([name,value]); if (owner.parameterFailure) throw owner.parameterFailure; },
		texImage2D(_target: number, _level: number, _internal: number, width: number, height: number, _border: number, _format: number, _type: number, bytes: Uint8Array) {
			assert.equal(width, 256); assert.equal(height, 1); owner.transferred = bytes; owner.beforeUpload?.(); if (owner.fail) throw owner.fail; owner.uploads.push(bytes.slice());
		}, uniform1i(_location: unknown, value: number) { owner.samplers.push(value); },
	} as unknown as WebGL2RenderingContext;
	return owner;
}
