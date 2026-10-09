/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { videoEffectPasses, EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { colorWheelsPreviewPassV1, copyColorWheelsPreviewLookupV1, releaseColorWheelsPreviewPassV1 } from '../src/common/editor/video-color-wheels-v1.ts';
import { globalDevelopPreviewPassV1 } from '../src/common/editor/video-global-develop-v1.ts';
import { bindVideoColorWheelsGpu, disposeVideoColorWheelsGpu } from '../src/common/editor/controller/clip-video/video-color-wheels-gpu.ts';
import { bindVideoGlobalDevelopGpu, disposeVideoGlobalDevelopGpu } from '../src/common/editor/controller/clip-video/video-global-develop-gpu.ts';

const pass = () => colorWheelsPreviewPassV1({ id: 'p', type: 'color-wheels-v1', enabled: true,
	params: { highlightsLuminance: 100 } })!;
const global = () => globalDevelopPreviewPassV1({ id: 'wb', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } })!;

test('wheel and global passes serially reuse one nearest texture with exact owner-sensitive lookup bytes', () => {
	const gpu = fixture(), wheel = pass(); bindVideoColorWheelsGpu(gpu.gl, gpu.location, wheel);
	assert.deepEqual([...gpu.uploads[0]!.subarray(64 * 4, 64 * 4 + 4)], [90, 90, 90, 255]);
	assert.equal(gpu.transferred!.every(byte => byte === 0), true); assert.equal(gpu.created, 1);
	bindVideoColorWheelsGpu(gpu.gl, gpu.location, wheel); assert.equal(gpu.uploads.length, 1);
	bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, global());
	assert.deepEqual([...gpu.uploads[1]!.subarray(64 * 4, 64 * 4 + 4)], [90, 64, 44, 255]);
	bindVideoColorWheelsGpu(gpu.gl, gpu.location, wheel); assert.equal(gpu.uploads.length, 3); assert.equal(gpu.created, 1);
	disposeVideoColorWheelsGpu(gpu.gl); disposeVideoGlobalDevelopGpu(gpu.gl); assert.equal(gpu.deleted, 1);
});

test('counterfeit or wrong-owner passes refuse before native resource acquisition without inspecting the pass', () => {
	const gpu = fixture(); let traps = 0;
	const opaque = new Proxy({}, { get() { traps++; throw Error(); }, getPrototypeOf() { traps++; throw Error(); } });
	for (const value of [opaque, { ...pass() }, global()]) assert.throws(() => bindVideoColorWheelsGpu(gpu.gl, gpu.location, value));
	assert.throws(() => bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, pass()));
	assert.equal(traps, 0); assert.equal(gpu.created, 0);
});

test('retiring a planned wheel refuses subsequent cached native use without deriving another table', () => {
	const gpu = fixture(), prepared = pass(); bindVideoColorWheelsGpu(gpu.gl, gpu.location, prepared);
	releaseColorWheelsPreviewPassV1(prepared);
	assert.throws(() => bindVideoColorWheelsGpu(gpu.gl, gpu.location, prepared));
	assert.equal(gpu.uploads.length, 1); disposeVideoColorWheelsGpu(gpu.gl);
});

test('failed setup/upload retains cleanup and retry, while cross-owner native reentry cannot replace resources', () => {
	const gpu = fixture(), failure = Object.freeze({ setup: true }), prepared = pass(); gpu.failure = failure;
	assert.throws(() => bindVideoColorWheelsGpu(gpu.gl, gpu.location, prepared), error => error === failure);
	assert.equal(gpu.created, 1); assert.equal(gpu.uploads.length, 0); gpu.failure = null;
	let attempted = 0;
	gpu.beforeUpload = () => { attempted++;
		assert.throws(() => bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, global()), /already active/u);
		assert.throws(() => disposeVideoGlobalDevelopGpu(gpu.gl), /already active/u);
	};
	bindVideoColorWheelsGpu(gpu.gl, gpu.location, prepared); assert.equal(attempted, 1);
	assert.equal(gpu.parameters.length, 5); assert.equal(gpu.created, 1); assert.equal(gpu.uploads.length, 1);
	assert.equal(gpu.transferred!.every(byte => byte === 0), true); disposeVideoColorWheelsGpu(gpu.gl);
});

test('planning retains recipes rather than lookup bytes; the sole upload allocation lives only through native callback settlement', () => {
	const NativeBytes = Uint8Array, allocations: Uint8Array[] = [], gpu = fixture(), failure = Object.freeze({ upload: true });
	globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args, receiver) {
		const bytes = Reflect.construct(target, args, receiver) as Uint8Array<ArrayBuffer>;
		if (args[0] === 1024) allocations.push(bytes); return bytes;
	} });
	try {
		const plans = [pass(), pass(), colorWheelsPreviewPassV1({ id: 'shadow', type: 'color-wheels-v1', enabled: true, params: { midtonesLuminance: 100 } })!];
		assert.equal(allocations.length, 0, 'Creating planned passes must not retain a private table per effect.');
		gpu.beforeUpload = () => {
			assert.equal(allocations.length, 1); assert.equal(allocations[0]![64 * 4], 90);
			assert.throws(() => bindVideoColorWheelsGpu(gpu.gl, gpu.location, plans[1]), /already active/u);
			assert.throws(() => disposeVideoColorWheelsGpu(gpu.gl), /already active/u); throw failure;
		};
		assert.throws(() => bindVideoColorWheelsGpu(gpu.gl, gpu.location, plans[0]), error => error === failure);
		assert.equal(allocations.length, 1); assert.equal(allocations[0]!.every(byte => byte === 0), true);
		gpu.beforeUpload = null; bindVideoColorWheelsGpu(gpu.gl, gpu.location, plans[0]);
		assert.equal(allocations.length, 2); assert.equal(allocations[1]!.every(byte => byte === 0), true);
		bindVideoColorWheelsGpu(gpu.gl, gpu.location, plans[0]); assert.equal(allocations.length, 2); assert.equal(gpu.created, 1);
	} finally { globalThis.Uint8Array = NativeBytes; disposeVideoColorWheelsGpu(gpu.gl); }
});

function fixture() {
	const owner = { created: 0, deleted: 0, uploads: [] as Uint8Array[], parameters: [] as number[][], transferred: null as Uint8Array | null,
		failure: null as unknown, beforeUpload: null as (() => void) | null, location: {} as WebGLUniformLocation, gl: null as unknown as WebGL2RenderingContext };
	owner.gl = { TEXTURE0: 0, TEXTURE2: 2, TEXTURE_2D: 3553, NEAREST: 9728, CLAMP_TO_EDGE: 33071, RGBA: 6408, UNSIGNED_BYTE: 5121,
		TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
		createTexture() { owner.created++; return {}; }, deleteTexture() { owner.deleted++; }, activeTexture() {}, bindTexture() {},
		texParameteri(_target: number, name: number, value: number) { owner.parameters.push([name, value]); if (owner.failure) throw owner.failure; },
		texImage2D(_target: number, _level: number, _internal: number, width: number, height: number, _border: number, _format: number, _type: number, bytes: Uint8Array) {
			assert.equal(width, 256); assert.equal(height, 1); owner.transferred = bytes; owner.beforeUpload?.(); owner.uploads.push(bytes.slice());
		}, uniform1i() {},
	} as unknown as WebGL2RenderingContext; return owner;
}
test('maintained preview dispatcher admits scalar wheel26 and retains prior programs with no legacy numeric fallback', () => {
	assert.equal(EFFECT_PROGRAM_COUNT, 34);
	const effect = { id: 'wheel', type: 'color-wheels-v1', enabled: true, params: { highlightsLuminance: 100 } };
	const passes = videoEffectPasses(effect); assert.equal(passes.length, 1); assert.equal(passes[0]?.code, 26);
	assert.equal(copyColorWheelsPreviewLookupV1(passes[0]).byteLength, 1024);
	assert.deepEqual(videoEffectPasses({ ...effect, enabled: false }), []); assert.deepEqual(videoEffectPasses({ ...effect, params: {} }), []);
});
