/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { parseCubeLutV1, type VideoCubeLutReferenceV1 } from '../../../src/common/editor/video-color-cube-lut-v27.ts';
import type { CubeLutSourcePortV1 } from '../../../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { startGpuPreviewObservationCurrentV1, readGpuPreviewObservationCurrentV1,
	stopGpuPreviewObservationCurrentV1 } from './lightscaper-develop-gpu-preview-current-reference.ts';

type Cube = 'swap2' | 'analytic65' | 'constant2' | 'identity2' | 'cancel2';
type Stack = 'lut' | 'mixed' | 'repeat' | 'unique';
type Fault = 'none' | 'corrupt' | 'double' | 'cleanup' | 'preabort' | 'held-source-abort' | 'held-consumer-abort' | 'held-loss' | 'opaque';
interface Request { readonly cube: Cube; readonly values: readonly number[]; readonly stack?: Stack; readonly fault?: Fault }
interface Upload { readonly method: string; readonly width: number; readonly height: number; readonly depth: number; readonly floating: boolean; readonly head: readonly number[] }
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const bits = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const retired = (buffer: ArrayBuffer) => Number(Reflect.apply(SIZE, buffer, [])) === 0 || new Uint8Array(buffer).every(n => n === 0);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const outcome = <T>(work: Promise<T>) => work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

export function gpuLutTextCurrentV1(cube: Cube): string {
	const size = cube === 'analytic65' ? 65 : 2, lines = [`LUT_3D_SIZE ${String(size)}`];
	if (cube === 'analytic65') lines.push('DOMAIN_MIN -1 -2 -0.5', 'DOMAIN_MAX 1 2 1.5');
	for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
		const x = r / (size - 1), y = g / (size - 1), z = b / (size - 1);
		lines.push((cube === 'swap2' ? [z, y, x] : cube === 'constant2' ? [-.125, .25, 1.5] : cube === 'cancel2' ? [1 + 2 ** -25 - 2 * x, .25, .5]
			: cube === 'identity2' ? [x, y, z] : [-.5 + 2 * x + y * z, .25 + y + x * z / 2, 2 * z - x * y / 4]).join(' '));
	}
	return `${lines.join('\n')}\n`;
}
function resource(cube: Cube) {
	const text = gpuLutTextCurrentV1(cube), body = parseCubeLutV1(text), bytes = new TextEncoder().encode(text);
	return { cube, bytes, reference: Object.freeze({ storageKey: `lut-sha256:${body.sha256}`, sha256: body.sha256,
		byteLength: body.byteLength, size: body.size, domainMin: body.domainMin, domainMax: body.domainMax }) };
}
function sample(cube: Cube, r: number, g: number, b: number): number[] {
	if (cube === 'constant2') return [-.125, .25, 1.5];
	if (cube === 'cancel2') return [1 + 2 ** -25 - 2 * clamp(r), .25, .5];
	if (cube === 'analytic65') { const x = clamp((r + 1) / 2), y = clamp((g + 2) / 4), z = clamp((b + .5) / 2);
		return [-.5 + 2 * x + y * z, .25 + y + x * z / 2, 2 * z - x * y / 4]; }
	return cube === 'swap2' ? [clamp(b), clamp(g), clamp(r)] : [clamp(r), clamp(g), clamp(b)];
}
function expected(values: Float32Array<ArrayBuffer>, cube: Cube, stack: Stack): number[] {
	const result: number[] = [];
	for (let at = 0; at < values.length; at += 4) {
		let r = values[at]!, g = values[at + 1]!, b = values[at + 2]!;
		if (stack === 'mixed') { r = Math.fround(r * 2); b = Math.fround(b * .5); }
		[r, g, b] = sample(cube, r, g, b).map(Math.fround) as [number, number, number];
		if (stack === 'repeat' || stack === 'unique') [r, g, b] = sample(stack === 'repeat' ? cube : 'constant2', r, g, b).map(Math.fround) as [number, number, number];
		if (stack === 'mixed') { r = Math.fround(r * 2); g = Math.fround(g * 2); b = Math.fround(b * 2); }
		result.push(r, g, b, values[at + 3]!);
	}
	return result;
}

interface Observation3d { read(): { uploads: readonly Upload[]; uploadBackingsRetired: boolean }; lose(): boolean; stop(): void }
let observation3d: Observation3d | undefined;
/** Adds transparent observations of native3D calls; never supplies GL results. */
export function startGpuLutObservationCurrentV1(): void {
	if (observation3d) throw new Error('3D observation is already owned.');
	startGpuPreviewObservationCurrentV1();
	const restores: { owner: object; key: string; descriptor: PropertyDescriptor }[] = [], uploads: Upload[] = [], backings: ArrayBuffer[] = [];
	const contexts = new Set<WebGL2RenderingContext>();
	const prototype = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype;
	for (const key of ['texImage3D', 'texSubImage3D', 'texStorage3D']) {
		if (!prototype) continue; const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
		if (!descriptor || typeof descriptor.value !== 'function') continue;
		const invoke = descriptor.value as (...args: unknown[]) => unknown; restores.push({ owner: prototype, key, descriptor });
		Object.defineProperty(prototype, key, { ...descriptor, value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(invoke, this, args); contexts.add(this);
			if (args[0] !== this.TEXTURE_3D) return result;
			const index = key === 'texSubImage3D' ? 5 : 3, data = args[key === 'texSubImage3D' ? 10 : 9];
			if (uploads.length >= 32) throw new Error('3D upload observation exceeded its bounded inventory.');
			const floating = key === 'texStorage3D' ? args[2] === this.RGBA32F || args[2] === this.RGB32F
				: args[key === 'texSubImage3D' ? 9 : 8] === this.FLOAT;
			uploads.push({ method: key, width: Number(args[index]), height: Number(args[index + 1]), depth: Number(args[index + 2]), floating,
				head: data instanceof Float32Array ? [...data.subarray(0, 16)] : [] });
			if (data instanceof Float32Array) backings.push(data.buffer as ArrayBuffer);
			return result;
		} });
	}
	observation3d = { read: () => ({ uploads: [...uploads], uploadBackingsRetired: backings.every(retired) }),
		lose() { for (const gl of contexts) { const extension = gl.getExtension('WEBGL_lose_context'); if (extension && !gl.isContextLost()) { extension.loseContext(); return true; } } return false; },
		stop() { for (const restore of restores.reverse()) Object.defineProperty(restore.owner, restore.key, restore.descriptor); } };
}
export function readGpuLutObservationCurrentV1() {
	if (!observation3d) throw new Error('3D observation is not installed.');
	return { ...readGpuPreviewObservationCurrentV1(), ...observation3d.read() };
}
export function stopGpuLutObservationCurrentV1(): void {
	observation3d?.stop(); observation3d = undefined; stopGpuPreviewObservationCurrentV1();
}
export function resetGpuLutObservationCurrentV1(): void { stopGpuLutObservationCurrentV1(); startGpuLutObservationCurrentV1(); }

export async function qualifyNativeGpuLutCurrentV1(value: Request) {
	if (!value.values.length || value.values.length > 4096 || value.values.length % 4 || value.values.some(n => !Number.isFinite(n))) throw new RangeError('Native LUT fixture requires bounded32² finite RGBA.');
	const first = resource(value.cube), stack = value.stack ?? 'lut', fault = value.fault ?? 'none';
	const resources = stack === 'unique' ? [first, resource('constant2')] : [first];
	const pixels = Float32Array.from({ length: 4096 }, (_, at) => value.values[at % value.values.length]!), before = bits(pixels);
	const reference = expected(pixels, value.cube, stack), referenceBits = bits(Float32Array.from(reference));
	const frame = { descriptor: { schemaVersion: 1 as const, width: 32, height: 32, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
	const lut = (id: string, reference: Readonly<VideoCubeLutReferenceV1>) => ({ id, type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference } });
	const effects = [lut('first', first.reference)];
	const all: unknown[] = stack === 'mixed' ? [{ id: 'wb', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } }, ...effects,
		{ id: 'exposure', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } }] : [...effects];
	if (stack === 'repeat' || stack === 'unique') all.push(lut('second', resources.at(-1)!.reference));
	const stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke(); const reason: unknown = revoked.proxy;
	const entered = deferred(), release = deferred(), borrowed: ArrayBuffer[] = [], calls: string[] = [];
	let active = 0, maximumActive = 0, callbacks = 0, backing: ArrayBuffer | undefined, backend: string | undefined;
	let pending = false, heldNonzero = false, sourceActiveAtDelivery = -1, settled = false, contextLossAvailable = false;
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume, options) {
		if (this !== source) throw new Error('Source method receiver was lost.');
		options?.signal?.throwIfAborted(); if (active) throw new Error('LUT byte borrows overlapped.');
		const selected = resources.find(resource => resource.reference.sha256 === reference.sha256); if (!selected) throw new Error('Unexpected resource.');
		calls.push(reference.sha256); active++; maximumActive = Math.max(maximumActive, active);
		const bytes = selected.bytes.slice(); borrowed.push(bytes.buffer);
		const result = await outcome((async () => {
			if (fault === 'corrupt') bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 1;
			const result = await consume(bytes);
			if (fault === 'double') await consume(bytes);
			if (fault === 'held-source-abort') { entered.resolve(); await release.promise; }
			options?.signal?.throwIfAborted(); return result;
		})());
		bytes.fill(0); active--;
		if (fault === 'cleanup') {
			if (!result.ok && !Object.is(result.error, reason)) throw new AggregateError([result.error, reason], 'Source cleanup failed.', { cause: result.error });
			throw reason;
		}
		if (!result.ok) throw result.error; return result.value;
	} };
	startGpuLutObservationCurrentV1();
	try {
		if (fault === 'preabort') stop.abort(reason);
		const observed = outcome(withImageDevelopGpuCurrentV1({ frame, develop: normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects: all }), signal: stop.signal },
			async (output, execution) => {
				callbacks++; backend = execution.backend; backing = output.pixels.buffer; sourceActiveAtDelivery = active;
				if (fault === 'opaque') throw reason;
				const result = { ...execution, bits: bits(output.pixels), values: [...output.pixels] };
				if (fault === 'held-consumer-abort' || fault === 'held-loss') { entered.resolve(); await release.promise; }
				return result;
			}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source }));
		void observed.then(() => { settled = true; });
		if (fault === 'held-source-abort' || fault === 'held-consumer-abort' || fault === 'held-loss') {
			await Promise.race([entered.promise, observed.then(result => { if (!result.ok) throw result.error; throw new Error('The native scope settled before its held boundary.'); })]);
			if (fault === 'held-loss') contextLossAvailable = observation3d!.lose(); else stop.abort(reason);
			await new Promise<void>(resolve => { setTimeout(resolve, 0); }); pending = !settled;
			heldNonzero = fault === 'held-source-abort' ? borrowed.some(buffer => !retired(buffer)) : backing !== undefined && !retired(backing);
			release.resolve();
		}
		const result = await observed;
		return { ...(result.ok ? result.value : {}), rejected: !result.ok, exactReason: !result.ok && Object.is(result.error, reason),
			callbacks, backend, before, sourceBits: bits(pixels), reference, referenceBits, calls, maximumActive, sourceActiveAtDelivery,
			pending, heldNonzero, contextLossAvailable, sourceRetired: borrowed.every(retired), outputRetired: backing !== undefined && retired(backing),
			observation: readGpuLutObservationCurrentV1() };
	} finally { release.resolve(); stopGpuLutObservationCurrentV1(); pixels.fill(0); for (const resource of resources) resource.bytes.fill(0); }
}
