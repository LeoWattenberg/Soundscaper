/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { parseCubeLutV1 } from '../../../src/common/editor/video-color-cube-lut-v27.ts';
import type { CubeLutSourcePortV1 } from '../../../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { gpuLutTextCurrentV1, startGpuLutObservationCurrentV1, readGpuLutObservationCurrentV1, stopGpuLutObservationCurrentV1 } from './lightscaper-native-gpu-lut-current-reference.ts';

interface Request {
	readonly width: number; readonly height: number; readonly values: readonly number[]; readonly effects?: readonly unknown[];
	readonly geometry?: unknown; readonly develop?: unknown; readonly mixed?: boolean; readonly fault?: 'preabort' | 'held-abort' | 'held-loss' | 'opaque';
}
interface Draw { readonly kind: number; readonly width: number; readonly height: number; readonly integer: number }
interface State { program: object | null; kind: number; integer: number; width: number; height: number; image: boolean; passes: Draw[] }
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const bits = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const retired = (buffer: ArrayBuffer) => Number(Reflect.apply(SIZE, buffer, [])) === 0 || new Uint8Array(buffer).every(n => n === 0);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const outcome = <T>(work: Promise<T>) => work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
type Facts = Omit<ReturnType<typeof readGpuLutObservationCurrentV1>, 'readbacks'> & {
	readonly readbacks: readonly Readonly<{ width: number; height: number; bits: readonly number[]; passes: readonly Draw[] }>[];
	readonly sourceUploads: readonly (readonly number[])[]; readonly geometryPrograms: number; readonly changingReadbacksRetired: boolean;
};
interface Observation { read(): Facts; lose(): boolean; stop(): void }
let active: Observation | undefined;

/** Geometry has its own native program rather than a uKind uniform. Actual
 * linked geometry uniforms, useProgram, draws and FLOAT transfers are observed;
 * every original method/receiver/result remains unchanged. */
export function startGpuGeometryObservationCurrentV1(size: Readonly<{ width: number; height: number }>): void {
	if (active) throw new Error('Geometry observation is already installed.');
	startGpuLutObservationCurrentV1();
	const restores: { owner: object; key: string; descriptor: PropertyDescriptor }[] = [];
	const contexts = new Map<WebGL2RenderingContext, State>(), locations = new Map<object, string>(), geometry = new Set<object>();
	const reads: { width: number; height: number; bits: number[]; passes: readonly Draw[] }[] = [], sources: number[][] = [], backings: ArrayBuffer[] = [];
	const prototype = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype;
	const state = (gl: WebGL2RenderingContext) => {
		let value = contexts.get(gl); if (!value) { value = { program: null, kind: 0, integer: 0, width: 0, height: 0, image: false, passes: [] }; contexts.set(gl, value); }
		return value;
	};
	const install = (key: string, after: (gl: WebGL2RenderingContext, args: unknown[], result: unknown) => void) => {
		let owner: object | null = prototype; while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) return; const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
		const invoke = descriptor.value as (...args: unknown[]) => unknown; restores.push({ owner, key, descriptor });
		Object.defineProperty(owner, key, { ...descriptor, value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(invoke, this, args); after(this, args, result); return result;
		} });
	};
	install('getUniformLocation', (_gl, args, result) => {
		if (!result || typeof result !== 'object' || typeof args[1] !== 'string') return;
		locations.set(result, args[1]); if (args[1].startsWith('uOutputToAperture') && args[0] && typeof args[0] === 'object') geometry.add(args[0]);
	});
	install('useProgram', (gl, args) => { state(gl).program = args[0] && typeof args[0] === 'object' ? args[0] : null; });
	install('uniform1i', (gl, args) => {
		const name = args[0] && typeof args[0] === 'object' ? locations.get(args[0]) : undefined;
		if (name === 'uKind') state(gl).kind = Number(args[1]); if (name === 'uIntegerPermutation') state(gl).integer = Number(args[1]);
	});
	install('viewport', (gl, args) => { state(gl).width = Number(args[2]); state(gl).height = Number(args[3]); });
	install('texImage2D', (gl, args) => {
		if (args[3] !== size.width || args[4] !== size.height || args[7] !== gl.FLOAT || !(args[8] instanceof Float32Array)) return;
		if (args[8].length !== size.width * size.height * 4 || sources.length >= 16) throw new Error('Geometry source upload exceeded bounded fixture.');
		state(gl).image = true; state(gl).passes = []; sources.push(bits(args[8] as Float32Array<ArrayBuffer>));
	});
	const draw = (gl: WebGL2RenderingContext) => { const current = state(gl); if (!current.image) return;
		if (current.passes.length >= 32) throw new Error('Geometry stage inventory exceeded its bound.');
		current.passes.push({ kind: current.program && geometry.has(current.program) ? 9 : current.kind, width: current.width, height: current.height, integer: current.integer });
	};
	install('drawArrays', draw); install('drawElements', draw);
	install('readPixels', (gl, args) => {
		const current = state(gl), output = args[6]; if (!current.image || args[5] !== gl.FLOAT || !(output instanceof Float32Array)) return;
		const width = Number(args[2]), height = Number(args[3]);
		if (width * height > 4096 || output.length !== width * height * 4 || reads.length >= 16) throw new Error('Geometry readback exceeded64².');
		reads.push({ width, height, bits: bits(output as Float32Array<ArrayBuffer>), passes: current.passes.map(pass => ({ ...pass })) }); backings.push(output.buffer as ArrayBuffer);
	});
	function snapshot() { return { ...readGpuLutObservationCurrentV1(), readbacks: reads.map(read => ({ ...read, bits: [...read.bits], passes: read.passes.map(pass => ({ ...pass })) })),
		sourceUploads: sources.map(source => [...source]), geometryPrograms: geometry.size, changingReadbacksRetired: backings.every(retired) }; }
	active = { read: snapshot, lose() { for (const gl of contexts.keys()) { const extension = gl.getExtension('WEBGL_lose_context'); if (extension && !gl.isContextLost()) { extension.loseContext(); return true; } } return false; },
		stop() { for (const restore of restores.reverse()) Object.defineProperty(restore.owner, restore.key, restore.descriptor); stopGpuLutObservationCurrentV1(); } };
}
export function readGpuGeometryObservationCurrentV1() { if (!active) throw new Error('Geometry observation is not installed.'); return active.read(); }
export function stopGpuGeometryObservationCurrentV1(): void { active?.stop(); active = undefined; }
export function resetGpuGeometryObservationCurrentV1(size: Readonly<{ width: number; height: number }>): void { stopGpuGeometryObservationCurrentV1(); startGpuGeometryObservationCurrentV1(size); }

export async function qualifyNativeGpuGeometryCurrentV1(value: Request) {
	if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 64 || value.height > 64
		|| value.width === 4 && value.height === 1 || value.values.length !== value.width * value.height * 4 || value.values.some(n => !Number.isFinite(n))) throw new RangeError('Geometry fixture requires bounded non-probe64² native RGBA.');
	const pixels = Float32Array.from(value.values), before = bits(pixels), frame = { descriptor: { schemaVersion: 1 as const, width: value.width, height: value.height,
		sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
	const text = gpuLutTextCurrentV1('swap2'), parsed = parseCubeLutV1(text), bytes = new TextEncoder().encode(text), sourceBackings: ArrayBuffer[] = [];
	const reference = { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256, byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax };
	const effects = value.mixed ? [{ id: 'wb', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } },
		{ id: 'crop', type: 'develop-geometry-v1', enabled: true, params: { cropX: 1 / 3, cropWidth: 2 / 3, rotationDegrees: 90 } },
		{ id: 'lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference } },
		{ id: 'turn', type: 'develop-geometry-v1', enabled: true, params: { rotationDegrees: 90 } }] : value.effects ?? [];
	const develop = normalizeImageDevelopStateCurrentV1(value.develop ?? { ...defaultImageDevelopStateV2(), ...(value.geometry ? { geometry: value.geometry } : {}), effects });
	let sourceCalls = 0, sourceActive = 0, maximumActive = 0;
	const source: CubeLutSourcePortV1 = { async withBytes(requested, consume, options) {
		if (this !== source || requested.sha256 !== reference.sha256 || sourceActive) throw new Error('Geometry LUT borrow changed identity/receiver or overlapped.');
		options?.signal?.throwIfAborted(); sourceCalls++; sourceActive++; maximumActive = Math.max(maximumActive, sourceActive);
		const snapshot = bytes.slice(); sourceBackings.push(snapshot.buffer); try { return await consume(snapshot); } finally { snapshot.fill(0); sourceActive--; }
	} };
	const options = value.mixed ? { source } : {};
	const expected = await withImageDevelopLinearCurrentV1({ frame, develop }, output => ({ descriptor: output.descriptor, bits: bits(output.pixels), values: [...output.pixels] }), PHOTO_DEVELOP_LINEAR_LIMITS_V1, options);
	sourceCalls = 0; maximumActive = 0; sourceBackings.length = 0;
	const stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke(); const reason: unknown = revoked.proxy;
	const entered = deferred(), release = deferred(); let callbacks = 0, backing: ArrayBuffer | undefined, settled = false, pending = false, heldNonzero = false, loss = false, backend: string | undefined, pixelReads = 0;
	const rawFrame = value.fault === 'preabort' ? { descriptor: frame.descriptor, get pixels(): never { pixelReads++; throw new Error('Preabort read geometry pixels.'); } } : frame;
	startGpuGeometryObservationCurrentV1(frame.descriptor);
	try {
		if (value.fault === 'preabort') stop.abort(reason);
		const observed = outcome(withImageDevelopGpuCurrentV1({ frame: rawFrame, develop, signal: stop.signal }, async (output, execution) => {
			callbacks++; backend = execution.backend; backing = output.pixels.buffer;
			if (value.fault === 'opaque') throw reason;
			const result = { ...execution, descriptor: output.descriptor, bits: bits(output.pixels), values: [...output.pixels], byteLength: backing.byteLength,
				byteOffset: output.pixels.byteOffset, sourceActiveAtDelivery: sourceActive };
			if (value.fault === 'held-abort' || value.fault === 'held-loss') { entered.resolve(); await release.promise; }
			return result;
		}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, options));
		void observed.then(() => { settled = true; });
		if (value.fault === 'held-abort' || value.fault === 'held-loss') {
			await Promise.race([entered.promise, observed.then(result => { if (!result.ok) throw result.error; throw new Error('Geometry scope settled before held consumer.'); })]);
			if (value.fault === 'held-abort') stop.abort(reason); else loss = active!.lose();
			await new Promise<void>(resolve => { setTimeout(resolve, 0); }); pending = !settled; heldNonzero = backing !== undefined && !retired(backing); release.resolve();
		}
		const result = await observed;
		return { ...(result.ok ? result.value : {}), backend, rejected: !result.ok, exactReason: !result.ok && Object.is(result.error, reason), callbacks, pixelReads,
			before, sourceBits: bits(pixels), expected, sourceCalls, maximumActive, sourceRetired: sourceBackings.every(retired), pending, heldNonzero, loss,
			outputRetired: backing !== undefined && retired(backing), observation: readGpuGeometryObservationCurrentV1() };
	} finally { release.resolve(); stopGpuGeometryObservationCurrentV1(); pixels.fill(0); bytes.fill(0); }
}
