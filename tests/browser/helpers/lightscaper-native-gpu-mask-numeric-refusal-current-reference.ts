/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { parseCubeLutV1 } from '../../../src/common/editor/video-color-cube-lut-v27.ts';
import type { CubeLutSourcePortV1 } from '../../../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { startGpuLutObservationCurrentV1, readGpuLutObservationCurrentV1, stopGpuLutObservationCurrentV1 } from './lightscaper-native-gpu-lut-current-reference.ts';

type Draw = Readonly<{ program: 'image' | 'node' | 'blend'; kind: number; width: number; height: number }>;
interface State { program: WebGLProgram | null; imageKind: number; nodeKind: number; width: number; height: number; draws: Draw[] }
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const bits = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const retired = (backing: ArrayBuffer) => Number(Reflect.apply(SIZE, backing, [])) === 0 || new Uint8Array(backing).every(n => n === 0);

/** Actual high broker only. The LUT is a genuine authenticated source, never
 * an injected renderer/GL result. Procedural gradient coverage is GPU-derived;
 * no mask source or host coverage plane is supplied to the native renderer. */
export async function runMaskNumericRefusalCurrentV1() {
	const text = `LUT_3D_SIZE 2\n${Array(8).fill('-1 -1 -1').join('\n')}\n`, parsed = parseCubeLutV1(text), body = new TextEncoder().encode(text);
	const bodyBefore = [...body], reference = Object.freeze({ storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
		byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax });
	const pixels = Float32Array.of(1, 1, 1, .375, 1, 1, 1, .5, 1, 1, 1, 1), before = bits(pixels), backings: ArrayBuffer[] = [];
	const descriptor = Object.freeze({ schemaVersion: 1 as const, width: 3, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
	const develop = { ...defaultImageDevelopStateV2(), effects: [{ id: 'negative', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference } }],
		masks: [{ schemaVersion: 1, id: 'half', kind: 'mask', inputs: [], nodes: [{ id: 'vertical', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 0, y: 1 } }], outputNodeId: 'vertical' }],
		maskBindings: [{ effectId: 'negative', maskId: 'half' }] };
	let sourceReads = 0, active = 0, maximumActive = 0, callbacks = 0;
	const source: CubeLutSourcePortV1 = { async withBytes(requested, consume, options) {
		if (this !== source || active || requested.sha256 !== reference.sha256 || requested.byteLength !== reference.byteLength) throw new Error('Numeric-refusal LUT source identity/receiver/serial custody changed.');
		options?.signal?.throwIfAborted(); sourceReads++; active++; maximumActive = Math.max(maximumActive, active);
		const owned = body.slice(); backings.push(owned.buffer);
		try { return await consume(owned); } finally { owned.fill(0); active--; }
	} };
	const observer = observe(); let borrowed: ArrayBuffer | undefined, coverage: ArrayBuffer | undefined;
	const operation = (async () => {
		const result = await withImageDevelopGpuCurrentV1({ frame: { descriptor, pixels }, develop, maskOverlay: develop.maskBindings[0] }, (output, execution, overlay) => {
			callbacks++; borrowed = output.pixels.buffer; coverage = overlay?.coverage.buffer;
			return { ...execution, descriptor: output.descriptor, bits: bits(output.pixels), coverage: overlay ? [...overlay.coverage] : undefined,
				overlay: overlay ? { maskId: overlay.maskId, effectId: overlay.effectId, width: overlay.width, height: overlay.height } : undefined,
				atDelivery: observer.read(), sourceActiveAtDelivery: active, sourceCopiesRetiredAtDelivery: backings.every(retired) };
		}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source });
		return { ...result, callbacks, sourceReads, maximumActive, before, sourceAfter: bits(pixels), bodyBefore, bodyAfter: [...body],
			sourceCopiesRetired: backings.every(retired), outputRetired: borrowed !== undefined && retired(borrowed), overlayRetired: coverage !== undefined && retired(coverage), after: observer.read() };
	})().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const outcome = await operation, cleanup: unknown[] = [];
	try { observer.stop(); } catch (error) { cleanup.push(error); }
	try { pixels.fill(0); body.fill(0); } catch (error) { cleanup.push(error); }
	if (!outcome.ok) { if (cleanup.length) throw new AggregateError([outcome.error, ...cleanup], 'Numeric-refusal witness and retirement failed.', { cause: outcome.error }); throw outcome.error; }
	if (cleanup.length) throw new AggregateError(cleanup, 'Numeric-refusal witness retirement failed.');
	return outcome.value;
}

function observe() {
	startGpuLutObservationCurrentV1();
	const restores: { owner: object; key: string; descriptor: PropertyDescriptor }[] = [], buffers = new Set<ArrayBuffer>();
	const locations = new Map<object, string>(), programs = new Map<object, Draw['program']>(), states = new Map<WebGL2RenderingContext, State>();
	const reads: { bits: number[]; draws: readonly Draw[] }[] = [], integerReads: { x: number; y: number; width: number; height: number; values: number[]; draws: readonly Draw[] }[] = [];
	const byteUploads: { method: string; width: number; height: number; values: number[] }[] = [];
	const state = (gl: WebGL2RenderingContext): State => {
		let value = states.get(gl); if (!value) { value = { program: null, imageKind: 0, nodeKind: 0, width: 0, height: 0, draws: [] }; states.set(gl, value); } return value;
	};
	const prototype = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype;
	const install = (key: string, after: (gl: WebGL2RenderingContext, args: unknown[], result: unknown) => void) => {
		let owner: object | null = prototype; while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) return; const descriptor = Object.getOwnPropertyDescriptor(owner, key)!, original = descriptor.value as (...args: unknown[]) => unknown;
		restores.push({ owner, key, descriptor }); Object.defineProperty(owner, key, { ...descriptor, value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(original, this, args); after(this, args, result); return result;
		} });
	};
	install('getUniformLocation', (_gl, args, result) => {
		if (!result || typeof result !== 'object' || typeof args[1] !== 'string' || !args[0] || typeof args[0] !== 'object') return;
		locations.set(result, args[1]); if (args[1] === 'uKind') programs.set(args[0], 'image');
		if (args[1] === 'uNodeKind') programs.set(args[0], 'node'); if (args[1] === 'uBlendPolicy') programs.set(args[0], 'blend');
	});
	install('useProgram', (gl, args) => { state(gl).program = args[0] as WebGLProgram | null; });
	install('uniform1i', (gl, args) => { const key = args[0] && typeof args[0] === 'object' ? locations.get(args[0]) : undefined;
		if (key === 'uKind') state(gl).imageKind = Number(args[1]); if (key === 'uNodeKind') state(gl).nodeKind = Number(args[1]); });
	install('viewport', (gl, args) => { state(gl).width = Number(args[2]); state(gl).height = Number(args[3]); });
	install('drawArrays', gl => {
		const current = state(gl), program = current.program && programs.get(current.program);
		if (program) { if (current.draws.length >= 64) throw new Error('Numeric-refusal draw inventory exceeded64.');
			current.draws.push({ program, kind: program === 'image' ? current.imageKind : program === 'node' ? current.nodeKind : 0, width: current.width, height: current.height }); }
	});
	install('readPixels', (gl, args) => {
		const output = args[6], current = state(gl), width = Number(args[2]), height = Number(args[3]);
		if (output instanceof Float32Array || output instanceof Uint32Array) buffers.add(output.buffer as ArrayBuffer);
		if (args[5] === gl.FLOAT && output instanceof Float32Array && width === 3 && height === 1 && current.draws.some(draw => draw.program === 'blend' && draw.width === 3)) {
			if (reads.length >= 8 || output.length !== 12) throw new Error('Numeric-refusal native readback exceeded its fixture.'); reads.push({ bits: bits(output as Float32Array<ArrayBuffer>), draws: current.draws.map(draw => ({ ...draw })) });
		}
		if (args[4] === gl.RGBA_INTEGER && args[5] === gl.UNSIGNED_INT && output instanceof Uint32Array && width * height <= 16) {
			if (integerReads.length >= 32) throw new Error('Numeric-refusal integer inventory exceeded32.');
			integerReads.push({ x: Number(args[0]), y: Number(args[1]), width, height, values: Array.from({ length: width * height }, (_, at) => output[at * 4]!), draws: current.draws.map(draw => ({ ...draw })) });
		}
	});
	for (const method of ['texImage2D', 'texSubImage2D']) install(method, (gl, args) => {
		const format = args[6], type = args[7], data = args[8];
		if (format !== gl.RED_INTEGER || type !== gl.UNSIGNED_BYTE || !(data instanceof Uint8Array)) return;
		if (byteUploads.length >= 32 || data.length > 16) throw new Error('Numeric-refusal byte upload exceeded bounded capability data.');
		byteUploads.push({ method, width: Number(args[method === 'texImage2D' ? 3 : 4]), height: Number(args[method === 'texImage2D' ? 4 : 5]), values: [...data] });
	});
	return { read: () => ({ ...readGpuLutObservationCurrentV1(), nativeReads: reads, integerReads, byteUploads,
		draws: [...states.values()].flatMap(value => value.draws), nativeBuffersRetired: [...buffers].every(retired) }),
		stop() { for (const restore of restores.reverse()) Object.defineProperty(restore.owner, restore.key, restore.descriptor); stopGpuLutObservationCurrentV1(); } };
}
