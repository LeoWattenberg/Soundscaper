/* SPDX-License-Identifier: AGPL-3.0-only */

import { withPixelFrameWebGl2CurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-current-v1.ts';
import { preparePixelFrameWebGl2GlobalsCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-global-current-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../../../src/common/editor/imaging/image-develop-linear-frame-v1.ts';

interface Request {
	readonly width: number; readonly height: number; readonly values: readonly number[];
	readonly effects: readonly unknown[]; readonly primaries?: 'srgb' | 'bt709';
}
type Kind = 'texture' | 'framebuffer' | 'program' | 'shader' | 'vertexArray' | 'buffer' | 'sync';
type Fault = 'none' | 'abort-after-read' | 'loss-after-read' | 'abort-during-preflight' | 'abort-during-draw';
type Lifetime = 'preabort' | 'abort-after-read' | 'held-abort' | 'held-loss' | 'detach' | 'opaque';
type Context = WebGL2RenderingContext;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const TYPES: readonly Kind[] = ['texture', 'framebuffer', 'program', 'shader', 'vertexArray', 'buffer', 'sync'];
const SUFFIX = { texture: 'Texture', framebuffer: 'Framebuffer', program: 'Program', shader: 'Shader', vertexArray: 'VertexArray', buffer: 'Buffer', sync: 'Sync' } as const;

function fixture(value: Request) {
	if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1
		|| value.width > 64 || value.height > 64 || value.values.length !== value.width * value.height * 4
		|| value.values.some(n => !Number.isFinite(n))) throw new RangeError('The native GPU browser fixture is bounded to64×64 finite samples.');
	const pixels = Float32Array.from(value.values), before = bits(pixels);
	const frame: Readonly<LinearWorkingPixelFrameV1> = Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1,
		width: value.width, height: value.height, sampleFormat: 'float32', primaries: value.primaries ?? 'srgb', transfer: 'linear' }), pixels });
	return { frame, before, passes: preparePixelFrameWebGl2GlobalsCurrentV1(value.effects) };
}
function bits(value: Float32Array<ArrayBuffer>): number[] { return [...new Uint32Array(value.buffer, value.byteOffset, value.length)]; }
function equal(left: readonly number[], right: readonly number[]): boolean { return left.length === right.length && left.every((n, at) => n === right[at]); }
function invertedRows(values: readonly number[], width: number, height: number): number[] {
	return Array.from({ length: height }, (_, y) => values.slice((height - y - 1) * width * 4, (height - y) * width * 4)).flat();
}
function wbBits(frame: Readonly<LinearWorkingPixelFrameV1>): number[] {
	return bits(frame.pixels.map((n, at) => at % 4 === 0 ? n * 2 : at % 4 === 2 ? n / 2 : n));
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
async function taskTurn(): Promise<void> {
	await new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => {
		channel.port1.close(); channel.port2.close(); resolve();
	}; channel.port2.postMessage(null); });
}
function outcome<Result>(work: Promise<Result>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

/** Transparent native observation only. Every call preserves the actual GL
 * receiver/result. Loss faults use the real context-loss extension. No shader,
 * GL result, capability or rendered pixel is supplied by this helper. */
function observe(width: number, height: number, fault: Fault = 'none', stop?: AbortController, reason?: unknown, faultBits?: readonly number[]) {
	const restorations: { owner: object; key: string; descriptor: PropertyDescriptor }[] = [];
	const prototype = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype;
	const contexts = new Map<Context, { renderer: string; vendor: string; version: string; maximumTextureSize: number; floatTarget: boolean; nativeReceiver: boolean; lose: WEBGL_lose_context | null }>();
	const handles = new Map<Kind, Map<object, Context>>(TYPES.map(kind => [kind, new Map<object, Context>()] as const));
	const deleted = new Map<Kind, Set<object>>(TYPES.map(kind => [kind, new Set<object>()] as const));
	const reads: { width: number; height: number; floating: boolean; bits: number[] }[] = [], readbackBackings: ArrayBuffer[] = [];
	const errors: number[] = []; let draws = 0, floatTargets = 0, floatUploads = 0, lossTriggered = false, abortTriggered = false;
	const remember = (gl: Context) => {
		if (contexts.has(gl)) return;
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		contexts.set(gl, { renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
			vendor: String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)), version: String(gl.getParameter(gl.VERSION)),
			maximumTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)), floatTarget: gl.getExtension('EXT_color_buffer_float') !== null,
			nativeReceiver: gl instanceof WebGL2RenderingContext,
			lose: gl.getExtension('WEBGL_lose_context') });
	};
	const install = (key: string, after: (gl: Context, args: unknown[], value: unknown) => void) => {
		let owner: object | null = prototype;
		while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) return;
		const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
		if (typeof descriptor.value !== 'function') throw new TypeError(`Native WebGL ${key} is unavailable.`);
		const call = descriptor.value as (...args: unknown[]) => unknown;
		restorations.push({ owner, key, descriptor });
		Object.defineProperty(owner, key, { ...descriptor, value: function (this: Context, ...args: unknown[]) {
			remember(this); const result = Reflect.apply(call, this, args); after(this, args, result); return result;
		} });
	};
	for (const kind of TYPES) {
		install(`create${SUFFIX[kind]}`, (gl, _args, value) => { if (value && typeof value === 'object') handles.get(kind)!.set(value, gl); });
		install(`delete${SUFFIX[kind]}`, (_gl, args) => { const value = args[0]; if (value && typeof value === 'object') deleted.get(kind)!.add(value); });
	}
	install('fenceSync', (gl, _args, value) => { if (value && typeof value === 'object') handles.get('sync')!.set(value, gl); });
	install('texImage2D', (gl, args) => { if (args[2] === gl.RGBA32F) floatTargets++; if (args[7] === gl.FLOAT && args[8] instanceof Float32Array) floatUploads++; });
	install('texStorage2D', (gl, args) => { if (args[2] === gl.RGBA32F) floatTargets++; });
	install('texSubImage2D', (gl, args) => { if (args[7] === gl.FLOAT && args[8] instanceof Float32Array) floatUploads++; });
	install('drawArrays', gl => {
		draws++;
		if (fault === 'abort-during-draw' && !abortTriggered) {
			const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
			if (viewport[2] === width && viewport[3] === height) { abortTriggered = true; setTimeout(() => { stop!.abort(reason); }, 0); }
		}
	}); install('drawElements', () => { draws++; });
	install('getError', (_gl, _args, value) => { if (typeof value === 'number') errors.push(value); });
	install('readPixels', (gl, args) => {
		const output = args[6], floating = args[5] === gl.FLOAT && output instanceof Float32Array;
		const captured = { width: Number(args[2]), height: Number(args[3]), floating, bits: floating ? bits(output as Float32Array<ArrayBuffer>) : [] };
		reads.push(captured);
		if (fault === 'abort-during-preflight' && !abortTriggered) { abortTriggered = true; setTimeout(() => { stop!.abort(reason); }, 0); }
		if (!floating || args[2] !== width || args[3] !== height) return;
		readbackBackings.push((output as Float32Array<ArrayBuffer>).buffer);
		// Fault only the independently known source result, never an unrelated
		// capability-probe draw which happens to use the same small extent.
		if (faultBits && !equal(captured.bits, faultBits) && !equal(invertedRows(captured.bits, width, height), faultBits)) return;
		if (fault === 'abort-after-read' && !abortTriggered) { abortTriggered = true; stop!.abort(reason); }
		if (fault === 'loss-after-read' && !lossTriggered) {
			const extension = contexts.get(gl)!.lose;
			if (!extension) throw new Error('The real context cannot exercise context loss.');
			lossTriggered = true; extension.loseContext();
		}
	});
	const alive = () => {
		let count = 0;
		for (const kind of TYPES) for (const [handle, gl] of handles.get(kind)!) {
			const test = Reflect.get(prototype!, `is${SUFFIX[kind]}`) as (handle: object) => boolean;
			if (Reflect.apply(test, gl, [handle])) count++;
		}
		return count;
	};
	return {
		alive,
		lose() {
			const entry = [...contexts].find(([gl, value]) => value.lose && !gl.isContextLost());
			if (!entry) return false; entry[1].lose!.loseContext(); lossTriggered = true; return true;
		},
		facts() { return { contexts: [...contexts.values()].map(({ lose: _lose, ...value }) => value), draws, floatTargets, floatUploads,
			reads, errors, lossTriggered, abortTriggered, aliveHandles: alive(),
			created: Object.fromEntries(TYPES.map(kind => [kind, handles.get(kind)!.size])),
			deleted: Object.fromEntries(TYPES.map(kind => [kind, [...handles.get(kind)!.keys()].filter(handle => deleted.get(kind)!.has(handle)).length])),
			readbacksRetired: readbackBackings.every(backing => Number(Reflect.apply(SIZE, backing, [])) === 0 || new Uint8Array(backing).every(n => n === 0)) }; },
		restore() { for (const value of restorations.reverse()) Object.defineProperty(value.owner, value.key, value.descriptor); },
	};
}

export async function qualifyNativeGpuCurrentV1(value: Request) {
	const f = fixture(value), native = observe(value.width, value.height);
	let callbacks = 0, backing: ArrayBuffer | undefined;
	try {
		const result = await withPixelFrameWebGl2CurrentV1({ frame: f.frame, passes: f.passes }, view => {
			callbacks++; const frame = view.backend === 'webgl2' ? view.frame : view.source; backing = frame.pixels.buffer;
			return { backend: view.backend, reason: view.backend === 'cpu' ? view.reason : null, descriptor: frame.descriptor,
				pixels: [...frame.pixels], bits: bits(frame.pixels), dedicated: backing !== f.frame.pixels.buffer,
				liveHandlesAtDelivery: native.alive() };
		});
		return { ...result, callbacks, sourceBits: bits(f.frame.pixels), beforeBits: f.before,
			outputRetired: backing !== undefined && new Uint8Array(backing).every(n => n === 0), native: native.facts() };
	} finally { native.restore(); f.frame.pixels.fill(0); }
}

/** Lower owner lifetime only; this does not exercise Photo Session/Develop UI. */
export async function qualifyNativeGpuLifetimeCurrentV1(mode: Lifetime) {
	const f = fixture({ width: 3, height: 2, values: [-.25, 2, .125, .375, 1e-30, -(2 ** -126), 4, 0,
		.125, .25, .5, 1, .25, .5, 1, .5, -.5, 4, 2, .25, 2, 1, .5, 1],
		effects: [{ id: 'lifetime-wb', type: 'white-balance-v1', enabled: true, params: { temperature: 100, tint: 0 } }] });
	const stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke();
	const native = observe(3, 2, mode === 'abort-after-read' ? 'abort-after-read' : 'none', stop, revoked.proxy, wbBits(f.frame));
	const entered = deferred(), release = deferred();
	let callbacks = 0, settled = false, backing: ArrayBuffer | undefined, transfer: ArrayBuffer | undefined;
	let backend: 'webgl2' | 'cpu' | null = null, fallbackReason: string | null = null, pixelReads = 0;
	let heldPending = false, heldNonzero = false, contextLossAvailable = false;
	try {
		if (mode === 'preabort') stop.abort(revoked.proxy);
		const frame = mode === 'preabort' ? { descriptor: f.frame.descriptor, get pixels(): never { pixelReads++; throw new Error('Preabort consulted pixels.'); } } : f.frame;
		const work = withPixelFrameWebGl2CurrentV1({ frame, passes: f.passes, signal: stop.signal }, async view => {
			callbacks++; backend = view.backend; fallbackReason = view.backend === 'cpu' ? view.reason : null;
			const output = view.backend === 'webgl2' ? view.frame : view.source; backing = output.pixels.buffer;
			if (mode === 'opaque') throw revoked.proxy;
			if (mode === 'detach') { transfer = structuredClone(backing, { transfer: [backing] }); return 'transferred'; }
			entered.resolve(); await release.promise; return 'held';
		});
		const observed = outcome(work); void observed.then(() => { settled = true; });
		if (mode === 'held-abort' || mode === 'held-loss') {
			await Promise.race([entered.promise, observed.then(result => { if (!result.ok) throw result.error; throw new Error('Owner settled before scoped entry.'); })]);
			if (mode === 'held-abort') stop.abort(revoked.proxy);
			else contextLossAvailable = native.lose();
			await taskTurn(); heldPending = !settled; heldNonzero = backing !== undefined && new Uint8Array(backing).some(n => n !== 0);
		}
		release.resolve(); const result = await observed;
		const failure = result.ok ? undefined : result.error;
		const detachedFailure = mode === 'detach' && !result.ok && (failure instanceof TypeError
			|| failure instanceof AggregateError && failure.errors.some((error: unknown) => error instanceof TypeError));
		return { backend, fallbackReason, callbacks, rejected: !result.ok, exactAbort: Object.is(failure, revoked.proxy), pixelReads,
			heldPending, heldNonzero, contextLossAvailable, detachedFailure,
			transferNonzero: transfer !== undefined && new Uint8Array(transfer).some(n => n !== 0),
			outputRetired: backing !== undefined && Number(Reflect.apply(SIZE, backing, [])) > 0 && new Uint8Array(backing).every(n => n === 0),
			sourceUnchanged: equal(bits(f.frame.pixels), f.before), native: native.facts() };
	} finally { release.resolve(); if (transfer) new Uint8Array(transfer).fill(0); native.restore(); f.frame.pixels.fill(0); }
}

export async function qualifyNativeGpuContextLossCurrentV1() {
	const f = fixture({ width: 3, height: 2, values: [.125, .25, 2, .375, -.25, .5, 4, 0,
		1, 2, .5, 1, .5, 1, 2, .5, .25, .125, 4, .25, -.5, 2, 1, 1],
		effects: [{ id: 'lost-wb', type: 'white-balance-v1', enabled: true, params: { temperature: 100, tint: 0 } }] });
	const native = observe(3, 2, 'loss-after-read', undefined, undefined, wbBits(f.frame)); let callbacks = 0, backing: ArrayBuffer | undefined;
	try {
		const result = await withPixelFrameWebGl2CurrentV1({ frame: f.frame, passes: f.passes }, view => {
			callbacks++; const frame = view.backend === 'webgl2' ? view.frame : view.source; backing = frame.pixels.buffer;
			return { backend: view.backend, reason: view.backend === 'cpu' ? view.reason : null,
				bits: bits(frame.pixels), liveHandlesAtDelivery: native.alive() };
		});
		return { ...result, callbacks, beforeBits: f.before, sourceUnchanged: equal(bits(f.frame.pixels), f.before),
			outputRetired: backing !== undefined && new Uint8Array(backing).every(n => n === 0), native: native.facts() };
	} finally { native.restore(); f.frame.pixels.fill(0); }
}

export async function qualifyNativeGpuPreflightCancellationCurrentV1(phase?: 'draw') {
	const values = Array.from({ length: 64 * 64 }, () => [.125, .25, .5, 1]).flat();
	const f = fixture({ width: 64, height: 64, values, effects: [{ id: 'preflight-tone', type: 'tone-ladder-v1', enabled: true, params: { contrast: 50 } }] });
	const stop = new AbortController(), reason = Symbol('native-preflight-abort'), native = observe(64, 64, phase === 'draw' ? 'abort-during-draw' : 'abort-during-preflight', stop, reason);
	let callbacks = 0, backend: string | undefined;
	try {
		const result = await outcome(withPixelFrameWebGl2CurrentV1({ frame: f.frame, passes: f.passes, signal: stop.signal }, view => { callbacks++; backend = view.backend; }));
		return { callbacks, backend, exactAbort: !result.ok && Object.is(result.error, reason), rejected: !result.ok,
			sourceUnchanged: equal(bits(f.frame.pixels), f.before), native: native.facts() };
	} finally { native.restore(); f.frame.pixels.fill(0); }
}
