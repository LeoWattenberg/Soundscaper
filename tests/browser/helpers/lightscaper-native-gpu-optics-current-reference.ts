/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { parseCubeLutV1 } from '../../../src/common/editor/video-color-cube-lut-v27.ts';
import type { CubeLutSourcePortV1 } from '../../../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { gpuLutTextCurrentV1 } from './lightscaper-native-gpu-lut-current-reference.ts';
import { startGpuGeometryObservationCurrentV1, readGpuGeometryObservationCurrentV1, stopGpuGeometryObservationCurrentV1 } from './lightscaper-native-gpu-geometry-current-reference.ts';

interface Request {
	readonly width: number; readonly height: number; readonly values: readonly number[]; readonly effects?: readonly unknown[];
	readonly develop?: unknown; readonly mixed?: boolean; readonly fault?: 'preabort' | 'held-abort' | 'held-loss' | 'opaque';
}
interface Draw { readonly kind: number; readonly width: number; readonly height: number; readonly extent: readonly number[] }
interface State { program: object | null; kind: number; optics: number; width: number; height: number; extent: number[]; image: boolean; passes: Draw[] }
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const bits = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const retired = (buffer: ArrayBuffer) => Number(Reflect.apply(SIZE, buffer, [])) === 0 || new Uint8Array(buffer).every(n => n === 0);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const outcome = <T>(work: Promise<T>) => work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
let active: ReturnType<typeof observe> | undefined;

/** Transparent observations of actual native uniforms, programs, draws and
 * FLOAT transfers. Every original receiver, method and result is preserved. */
function observe(size: Readonly<{ width: number; height: number }>) {
	startGpuGeometryObservationCurrentV1(size);
	const restores: { owner: object; key: string; descriptor: PropertyDescriptor }[] = [];
	const contexts = new Map<WebGL2RenderingContext, State>(), locations = new Map<object, string>(), optics = new Set<object>(), geometry = new Set<object>();
	const reads: { width: number; height: number; bits: number[]; passes: readonly Draw[] }[] = [], backings: ArrayBuffer[] = [];
	const prototype = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype;
	const state = (gl: WebGL2RenderingContext) => {
		let value = contexts.get(gl); if (!value) { value = { program: null, kind: 0, optics: 0, width: 0, height: 0, extent: [], image: false, passes: [] }; contexts.set(gl, value); }
		return value;
	};
	const install = (key: string, after: (gl: WebGL2RenderingContext, args: unknown[], result: unknown) => void) => {
		let owner: object | null = prototype; while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) return; const descriptor = Object.getOwnPropertyDescriptor(owner, key)!, invoke = descriptor.value as (...args: unknown[]) => unknown;
		restores.push({ owner, key, descriptor }); Object.defineProperty(owner, key, { ...descriptor, value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(invoke, this, args); after(this, args, result); return result;
		} });
	};
	install('getUniformLocation', (_gl, args, result) => {
		if (!result || typeof result !== 'object' || typeof args[1] !== 'string') return;
		locations.set(result, args[1]); if (!args[0] || typeof args[0] !== 'object') return;
		if (args[1] === 'uOpticsKind') optics.add(args[0]); if (args[1].startsWith('uOutputToAperture')) geometry.add(args[0]);
	});
	install('useProgram', (gl, args) => { state(gl).program = args[0] && typeof args[0] === 'object' ? args[0] : null; });
	install('uniform1i', (gl, args) => {
		const name = args[0] && typeof args[0] === 'object' ? locations.get(args[0]) : undefined;
		if (name === 'uKind') state(gl).kind = Number(args[1]); if (name === 'uOpticsKind') state(gl).optics = Number(args[1]);
	});
	install('uniform2i', (gl, args) => { if (args[0] && typeof args[0] === 'object' && locations.get(args[0]) === 'uExtent') state(gl).extent = [Number(args[1]), Number(args[2])]; });
	install('viewport', (gl, args) => { state(gl).width = Number(args[2]); state(gl).height = Number(args[3]); });
	install('texImage2D', (gl, args) => {
		if (args[3] !== size.width || args[4] !== size.height || args[7] !== gl.FLOAT || !(args[8] instanceof Float32Array)) return;
		if (args[8].length !== size.width * size.height * 4) throw new Error('Optics source upload differs from its bounded native fixture.');
		state(gl).image = true; state(gl).passes = [];
	});
	const draw = (gl: WebGL2RenderingContext) => {
		const current = state(gl); if (!current.image) return;
		if (current.passes.length >= 64) throw new Error('Optics stage observation exceeded its bound.');
		const isOptics = current.program !== null && optics.has(current.program), isGeometry = current.program !== null && geometry.has(current.program);
		current.passes.push({ kind: isOptics ? current.optics : isGeometry ? 9 : current.kind, width: current.width, height: current.height, extent: isOptics ? [...current.extent] : [] });
	};
	install('drawArrays', draw); install('drawElements', draw);
	install('readPixels', (gl, args) => {
		const current = state(gl), output = args[6]; if (!current.image || args[5] !== gl.FLOAT || !(output instanceof Float32Array)) return;
		const width = Number(args[2]), height = Number(args[3]);
		if (width * height > 4096 || output.length !== width * height * 4 || reads.length >= 32) throw new Error('Optics readback exceeded bounded64² observation.');
		reads.push({ width, height, bits: bits(output as Float32Array<ArrayBuffer>), passes: current.passes.map(pass => ({ ...pass })) }); backings.push(output.buffer as ArrayBuffer);
	});
	return { read: () => ({ ...readGpuGeometryObservationCurrentV1(), opticsPrograms: optics.size,
		readbacks: reads.map(read => ({ ...read, bits: [...read.bits], passes: read.passes.map(pass => ({ ...pass, extent: [...pass.extent] })) })), opticsReadbacksRetired: backings.every(retired) }),
		lose() { for (const gl of contexts.keys()) { const extension = gl.getExtension('WEBGL_lose_context'); if (extension && !gl.isContextLost()) { extension.loseContext(); return true; } } return false; },
		stop() { for (const restore of restores.reverse()) Object.defineProperty(restore.owner, restore.key, restore.descriptor); stopGpuGeometryObservationCurrentV1(); } };
}
export function startGpuOpticsObservationCurrentV1(size: Readonly<{ width: number; height: number }>): void { if (active) throw new Error('Optics observation is already installed.'); active = observe(size); }
export function readGpuOpticsObservationCurrentV1() { if (!active) throw new Error('Optics observation is absent.'); return active.read(); }
export function stopGpuOpticsObservationCurrentV1(): void { active?.stop(); active = undefined; }
export function resetGpuOpticsObservationCurrentV1(size: Readonly<{ width: number; height: number }>): void { stopGpuOpticsObservationCurrentV1(); startGpuOpticsObservationCurrentV1(size); }

function input(value: Request) {
	if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 64 || value.height > 64
		|| value.width === 4 && value.height === 1 || value.values.length !== value.width * value.height * 4 || value.values.some(n => !Number.isFinite(n))) throw new RangeError('Optics requires bounded non-probe64² native RGBA.');
	const pixels = Float32Array.from(value.values), frame = { descriptor: { schemaVersion: 1 as const, width: value.width, height: value.height,
		sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
	return { frame, develop: normalizeImageDevelopStateCurrentV1(value.develop ?? { ...defaultImageDevelopStateV2(), effects: value.effects ?? [] }) };
}
export async function referenceNativeGpuOpticsCurrentV1(value: Request) {
	const { frame, develop } = input(value);
	try { return await withImageDevelopLinearCurrentV1({ frame, develop }, output => ({ descriptor: output.descriptor, bits: bits(output.pixels), values: [...output.pixels] }), PHOTO_DEVELOP_LINEAR_LIMITS_V1); }
	finally { frame.pixels.fill(0); }
}

export async function qualifyNativeGpuOpticsCurrentV1(value: Request) {
	const { frame, develop: initial } = input(value), pixels = frame.pixels, before = bits(pixels);
	const text = gpuLutTextCurrentV1('swap2'), parsed = parseCubeLutV1(text), bytes = new TextEncoder().encode(text), sourceBackings: ArrayBuffer[] = [];
	const reference = { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256, byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax };
	const develop = value.mixed ? normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects: [
		{ id: 'wb', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } },
		{ id: 'lens', type: 'lens-distortion-v1', enabled: true, params: { amount: -100 } },
		{ id: 'turn', type: 'develop-geometry-v1', enabled: true, params: { rotationDegrees: 90 } },
		{ id: 'ca', type: 'chromatic-aberration-v1', enabled: true, params: { red: -100, blue: -100 } },
		{ id: 'lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference } },
		{ id: 'fringe', type: 'defringe-v1', enabled: true, params: { purple: 50, green: 50, edgeThreshold: 25 } },
		{ id: 'optical', type: 'optical-vignette-v1', enabled: true, params: { amount: 50 } },
	] }) : initial;
	let sourceCalls = 0, sourceActive = 0, maximumActive = 0;
	const source: CubeLutSourcePortV1 = { async withBytes(requested, consume, options) {
		if (this !== source || requested.sha256 !== reference.sha256 || sourceActive) throw new Error('Optics LUT source identity/receiver changed or borrows overlapped.');
		options?.signal?.throwIfAborted(); sourceCalls++; sourceActive++; maximumActive = Math.max(maximumActive, sourceActive);
		const snapshot = bytes.slice(); sourceBackings.push(snapshot.buffer); try { return await consume(snapshot); } finally { snapshot.fill(0); sourceActive--; }
	} };
	const options = value.mixed ? { source } : {};
	const expected = await withImageDevelopLinearCurrentV1({ frame, develop }, output => ({ descriptor: output.descriptor, bits: bits(output.pixels), values: [...output.pixels] }), PHOTO_DEVELOP_LINEAR_LIMITS_V1, options);
	sourceCalls = 0; maximumActive = 0; sourceBackings.length = 0;
	const stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke(); const reason: unknown = revoked.proxy;
	const entered = deferred(), release = deferred(); let callbacks = 0, backing: ArrayBuffer | undefined, settled = false, pending = false, heldNonzero = false, loss = false, backend: string | undefined, pixelReads = 0;
	const rawFrame = value.fault === 'preabort' ? { descriptor: frame.descriptor, get pixels(): never { pixelReads++; throw new Error('Preabort read optics pixels.'); } } : frame;
	startGpuOpticsObservationCurrentV1(frame.descriptor);
	try {
		if (value.fault === 'preabort') stop.abort(reason);
		const observed = outcome(withImageDevelopGpuCurrentV1({ frame: rawFrame, develop, signal: stop.signal }, async (output, execution) => {
			callbacks++; backend = execution.backend; backing = output.pixels.buffer;
			if (value.fault === 'opaque') throw reason;
			const result = { ...execution, descriptor: output.descriptor, bits: bits(output.pixels), values: [...output.pixels], byteLength: backing.byteLength, byteOffset: output.pixels.byteOffset, sourceActiveAtDelivery: sourceActive };
			if (value.fault === 'held-abort' || value.fault === 'held-loss') { entered.resolve(); await release.promise; }
			return result;
		}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, options));
		void observed.then(() => { settled = true; });
		if (value.fault === 'held-abort' || value.fault === 'held-loss') {
			await Promise.race([entered.promise, observed.then(result => { if (!result.ok) throw result.error; throw new Error('Optics scope settled before its held consumer.'); })]);
			if (value.fault === 'held-abort') stop.abort(reason); else loss = active!.lose();
			await new Promise<void>(resolve => { setTimeout(resolve, 0); }); pending = !settled; heldNonzero = backing !== undefined && !retired(backing); release.resolve();
		}
		const result = await observed;
		return { ...(result.ok ? result.value : {}), backend, rejected: !result.ok, exactReason: !result.ok && Object.is(result.error, reason), callbacks, pixelReads,
			before, sourceBits: bits(pixels), expected, sourceCalls, maximumActive, sourceRetired: sourceBackings.every(retired), pending, heldNonzero, loss,
			outputRetired: backing !== undefined && retired(backing), observation: readGpuOpticsObservationCurrentV1() };
	} finally { release.resolve(); stopGpuOpticsObservationCurrentV1(); pixels.fill(0); bytes.fill(0); }
}
