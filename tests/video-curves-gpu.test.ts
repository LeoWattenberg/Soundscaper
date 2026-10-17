/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { videoEffectPasses, EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { curvesPreviewPassV1, copyCurvesPreviewLookupV1 } from '../src/common/editor/video-curves-v1.ts';
import { globalDevelopPreviewPassV1 } from '../src/common/editor/video-global-develop-v1.ts';
import { bindVideoCurvesGpu, disposeVideoCurvesGpu } from '../src/common/editor/controller/clip-video/video-curves-gpu.ts';
import { bindVideoGlobalDevelopGpu, disposeVideoGlobalDevelopGpu } from '../src/common/editor/controller/clip-video/video-global-develop-gpu.ts';

const pass = () => curvesPreviewPassV1({ id: 'p', type: 'point-curves-v1', enabled: true,
	params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } })!;
const global = () => globalDevelopPreviewPassV1({ id: 'wb', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } })!;

test('curve and global passes serially reuse one nearest texture with exact owner-sensitive lookup bytes', () => {
	const gpu = fixture(), curve = pass(); bindVideoCurvesGpu(gpu.gl, gpu.location, curve);
	assert.deepEqual([...gpu.uploads[0]!.subarray(64 * 4, 64 * 4 + 4)], [191, 191, 191, 255]);
	assert.equal(gpu.transferred!.every(byte => byte === 0), true); assert.equal(gpu.created, 1);
	bindVideoCurvesGpu(gpu.gl, gpu.location, curve); assert.equal(gpu.uploads.length, 1);
	bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, global());
	assert.deepEqual([...gpu.uploads[1]!.subarray(64 * 4, 64 * 4 + 4)], [90, 64, 44, 255]);
	bindVideoCurvesGpu(gpu.gl, gpu.location, curve); assert.equal(gpu.uploads.length, 3); assert.equal(gpu.created, 1);
	disposeVideoCurvesGpu(gpu.gl); disposeVideoGlobalDevelopGpu(gpu.gl); assert.equal(gpu.deleted, 1);
});

test('counterfeit or wrong-owner passes refuse before native resource acquisition without inspecting the pass', () => {
	const gpu = fixture(); let traps = 0;
	const opaque = new Proxy({}, { get() { traps++; throw Error(); }, getPrototypeOf() { traps++; throw Error(); } });
	for (const value of [opaque, { ...pass() }, global()]) assert.throws(() => bindVideoCurvesGpu(gpu.gl, gpu.location, value));
	assert.throws(() => bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, pass()));
	assert.equal(traps, 0); assert.equal(gpu.created, 0);
});

test('failed setup/upload retains cleanup and retry, while cross-owner native reentry cannot replace resources', () => {
	const gpu = fixture(), failure = Object.freeze({ setup: true }), prepared = pass(); gpu.failure = failure;
	assert.throws(() => bindVideoCurvesGpu(gpu.gl, gpu.location, prepared), error => error === failure);
	assert.equal(gpu.created, 1); assert.equal(gpu.uploads.length, 0); gpu.failure = null;
	let attempted = 0;
	gpu.beforeUpload = () => { attempted++;
		assert.throws(() => bindVideoGlobalDevelopGpu(gpu.gl, gpu.location, global()), /already active/u);
		assert.throws(() => disposeVideoGlobalDevelopGpu(gpu.gl), /already active/u);
	};
	bindVideoCurvesGpu(gpu.gl, gpu.location, prepared); assert.equal(attempted, 1);
	assert.equal(gpu.parameters.length, 5); assert.equal(gpu.created, 1); assert.equal(gpu.uploads.length, 1);
	assert.equal(gpu.transferred!.every(byte => byte === 0), true); disposeVideoCurvesGpu(gpu.gl);
});

test('planning retains recipes rather than lookup bytes; the sole upload allocation lives only through native callback settlement', () => {
	const NativeBytes = Uint8Array, allocations: Uint8Array[] = [], gpu = fixture(), failure = Object.freeze({ upload: true });
	globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args, receiver) {
		const bytes = Reflect.construct(target, args, receiver) as Uint8Array<ArrayBuffer>;
		if (args[0] === 1024) allocations.push(bytes); return bytes;
	} });
	try {
		const plans = [pass(), pass(), curvesPreviewPassV1({ id: 'shadow', type: 'parametric-curves-v1', enabled: true, params: { masterShadows: 100 } })!];
		assert.equal(allocations.length, 0, 'Creating planned passes must not retain a private table per effect.');
		gpu.beforeUpload = () => {
			assert.equal(allocations.length, 1); assert.equal(allocations[0]![64 * 4], 191);
			assert.throws(() => bindVideoCurvesGpu(gpu.gl, gpu.location, plans[1]), /already active/u);
			assert.throws(() => disposeVideoCurvesGpu(gpu.gl), /already active/u); throw failure;
		};
		assert.throws(() => bindVideoCurvesGpu(gpu.gl, gpu.location, plans[0]), error => error === failure);
		assert.equal(allocations.length, 1); assert.equal(allocations[0]!.every(byte => byte === 0), true);
		gpu.beforeUpload = null; bindVideoCurvesGpu(gpu.gl, gpu.location, plans[0]);
		assert.equal(allocations.length, 2); assert.equal(allocations[1]!.every(byte => byte === 0), true);
		bindVideoCurvesGpu(gpu.gl, gpu.location, plans[0]); assert.equal(allocations.length, 2); assert.equal(gpu.created, 1);
	} finally { globalThis.Uint8Array = NativeBytes; disposeVideoCurvesGpu(gpu.gl); }
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
test('maintained preview dispatcher admits both curve owners and preserves disabled/neutral identity without legacy numeric fallback', () => {
	assert.equal(EFFECT_PROGRAM_COUNT, 34);
	for (const [type, code, params] of [['point-curves-v1', 24, { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }],
		['parametric-curves-v1', 25, { masterShadows: 100 }]] as const) {
		const effect = { id: 'curve', type, enabled: true, params }, passes = videoEffectPasses(effect);
		assert.equal(passes.length, 1); assert.equal(passes[0]?.code, code); assert.equal(copyCurvesPreviewLookupV1(passes[0]).byteLength, 1024);
		assert.deepEqual(videoEffectPasses({ ...effect, enabled: false }), []);
		assert.deepEqual(videoEffectPasses({ ...effect, params: {} }), []);
	}
});
