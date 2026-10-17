/* SPDX-License-Identifier: AGPL-3.0-only */

import { preparePixelFrameWebGl2RepairCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-repair-current-v1.ts';
import { withPixelFrameWebGl2RepairCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-repair-context-current-v1.ts';

type Fault = 'jacobi-abort' | 'held-abort' | 'detach-opaque';
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const retired = (backing: ArrayBuffer) => Number(Reflect.apply(SIZE, backing, [])) === 0 || new Uint8Array(backing).every(n => n === 0);
const bits = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function hasPrimary(error: unknown, target: unknown): boolean {
	if (Object.is(error, target)) return true;
	return error instanceof AggregateError && error.errors.some((child: unknown) => hasPrimary(child, target));
}
function hasCleanup(error: unknown, primary: unknown): boolean {
	if (Object.is(error, primary)) return false;
	return error instanceof TypeError || error instanceof AggregateError && error.errors.some((child: unknown) => hasCleanup(child, primary));
}
async function turn(): Promise<void> {
	await new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => {
		channel.port1.close(); channel.port2.close(); resolve();
	}; channel.port2.postMessage(null); });
}

/** Candidate-owner lifetime only. No accepted-backend or main-host claim.
 * The real GPU executes the same coupled10×5 Heal scene as the positive K
 * corpus. Abort occurs after a real Jacobi draw or in a genuinely held external
 * consumer; transfer/opaque uses the actual delivered native readback. */
export async function runNativeGpuRepairFaultCurrentV1(fault: Fault) {
	const width = 10, height = 5, pixels = new Float32Array(width * height * 4);
	for (let at = 3; at < pixels.length; at += 4) pixels[at] = 1;
	for (let y = 1; y < 4; y++) for (let x = 0; x < 4; x++) pixels.set([-2, -2, -2, 1], (y * width + x) * 4);
	for (const [x, y] of [[8, 2], [7, 1], [7, 3]] as const) pixels.set([4, 4, 4, 1], (y * width + x) * 4);
	const before = bits(pixels), descriptor = { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const };
	const plan = preparePixelFrameWebGl2RepairCurrentV1({ schemaVersion: 1, spots: [{ id: 'spot', enabled: true,
		mode: fault === 'detach-opaque' ? 'clone' : 'heal', target: { x: .7, y: .5 }, source: { x: .2, y: .5 }, radius: .15, feather: 0, opacity: 1 }] }, descriptor);
	const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
	if (!gl) { pixels.fill(0); throw new Error('Repair faults require an actual native WebGL2 context.'); }
	const stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke(); const reason: unknown = revoked.proxy;
	const entered = deferred(), release = deferred(), reads = new Set<ArrayBuffer>(), uploads = new Set<ArrayBuffer>(), jacobi = new Set<object>();
	const restore: (() => void)[] = [];
	let nativeJacobi = 0, callbacks = 0, current: object | null = null, settled = false, heldPending = false, heldReadbackLive = false, heldHandles = 0;
	let backing: ArrayBuffer | undefined, transferred: ArrayBuffer | undefined, atDelivery: NativeFacts | undefined;
	const native = observeNativeHandles(gl);
	const patch = (key: string, after: (args: unknown[], result: unknown) => void) => {
		let owner: object | null = WebGL2RenderingContext.prototype; while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) throw new Error(`Native repair fault requires ${key}.`);
		const target = owner, descriptor = Object.getOwnPropertyDescriptor(target, key)!, original = descriptor.value as (...args: unknown[]) => unknown;
		restore.push(() => { Object.defineProperty(target, key, descriptor); }); Object.defineProperty(target, key, { ...descriptor, value: function(this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(original, this, args); if (this === gl) after(args, result); return result;
		} });
	};
	patch('getUniformLocation', (args, result) => { if (result && args[1] === 'uPrevious' && args[0] && typeof args[0] === 'object') jacobi.add(args[0]); });
	patch('useProgram', args => { current = args[0] && typeof args[0] === 'object' ? args[0] : null; });
	patch('drawArrays', () => { if (current && jacobi.has(current)) { nativeJacobi++;
		if (fault === 'jacobi-abort' && nativeJacobi === 1) stop.abort(reason);
	} });
	patch('readPixels', args => { if (args[6] instanceof Float32Array || args[6] instanceof Uint32Array) reads.add(args[6].buffer as ArrayBuffer); });
	patch('texImage2D', args => { if (args[8] instanceof Float32Array) uploads.add(args[8].buffer as ArrayBuffer); });
	const work = withPixelFrameWebGl2RepairCurrentV1(gl, plan, { descriptor, pixels }, async frame => {
		callbacks++; backing = frame.pixels.buffer; atDelivery = native.read();
		if (!reads.has(backing)) throw new Error('Repair delivery did not lend the actual native readback.');
		if (fault === 'detach-opaque') { transferred = structuredClone(backing, { transfer: [backing] }); throw reason; }
		if (fault === 'jacobi-abort') throw new Error('Repair delivered after the first-Jacobi abort should have fenced the attempt.');
		entered.resolve(); await release.promise;
	}, stop.signal).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	void work.then(() => { settled = true; });
	let result: Awaited<typeof work> | undefined, setupFailure: unknown;
	try {
		if (fault === 'held-abort') {
			await Promise.race([entered.promise, work.then(outcome => { if (!outcome.ok) throw outcome.error; throw new Error('Repair settled before its held consumer.'); })]);
			stop.abort(reason); await turn(); heldPending = !settled; heldHandles = native.read().aliveHandles;
			heldReadbackLive = backing !== undefined && !retired(backing); release.resolve();
		}
		result = await work;
	} catch (error) { setupFailure = error; }
	finally { release.resolve(); await work; }
	const after = native.read(), facts = { rejected: result ? !result.ok : true,
		exactReason: result !== undefined && !result.ok && Object.is(result.error, reason), primaryRetained: result !== undefined && !result.ok && hasPrimary(result.error, reason),
		cleanupRetained: result !== undefined && !result.ok && hasCleanup(result.error, reason), callbacks, nativeJacobi, heldPending, heldHandles, heldReadbackLive,
		atDelivery, after, before, sourceAfter: bits(pixels), readbacksRetired: [...reads].every(retired), uploadsRetired: [...uploads].every(retired),
		outputRetired: backing === undefined || retired(backing) };
	const failures: unknown[] = setupFailure === undefined ? [] : [setupFailure];
	for (const undo of restore.reverse()) try { undo(); } catch (error) { failures.push(error); }
	try { native.stop(); } catch (error) { failures.push(error); }
	try { if (transferred) new Uint8Array(transferred).fill(0); pixels.fill(0); canvas.width = 0; canvas.height = 0; } catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0]; if (failures.length) throw new AggregateError(failures, 'Repair fault fixture and cleanup failed.', { cause: failures[0] });
	return facts;
}

type NativeKind = 'Texture' | 'Framebuffer' | 'Shader' | 'Program' | 'VertexArray' | 'Buffer' | 'Sync';
interface NativeFacts {
	readonly aliveHandles: number;
	readonly contexts: readonly Readonly<{ renderer: string; native: boolean; floatTarget: boolean }>[];
	readonly created: Readonly<Record<NativeKind, number>>;
	readonly deleted: Readonly<Record<NativeKind, number>>;
}

/** Exact repair-fixture handle tracking, with no draw-history inventory or
 * inherited64-draw cutoff. The separate native Jacobi counter above observes
 * actual shader draws. One fixed fixture uses one actual native GL context. */
function observeNativeHandles(gl: WebGL2RenderingContext): Readonly<{ read(): NativeFacts; stop(): void }> {
	const kinds: readonly NativeKind[] = ['Texture', 'Framebuffer', 'Shader', 'Program', 'VertexArray', 'Buffer', 'Sync'];
	const handles = new Map<NativeKind, Set<object>>(kinds.map(kind => [kind, new Set<object>()]));
	const deleted = new Map<NativeKind, Set<object>>(kinds.map(kind => [kind, new Set<object>()]));
	const restores: (() => void)[] = [], prototype = WebGL2RenderingContext.prototype;
	const patch = (key: string, after: (args: unknown[], result: unknown) => void): void => {
		let owner: object | null = prototype; while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) throw new Error(`Repair native handle tracker requires ${key}.`);
		const target = owner, property = Object.getOwnPropertyDescriptor(target, key)!, original = property.value as (...args: unknown[]) => unknown;
		restores.push(() => { Object.defineProperty(target, key, property); });
		Object.defineProperty(target, key, { ...property, value: function(this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(original, this, args); if (this === gl) after(args, result); return result;
		} });
	};
	for (const kind of kinds) {
		patch(kind === 'Sync' ? 'fenceSync' : `create${kind}`, (_args, result) => {
			if (result && typeof result === 'object') handles.get(kind)!.add(result);
		});
		patch(`delete${kind}`, args => { if (args[0] && typeof args[0] === 'object') deleted.get(kind)!.add(args[0]); });
	}
	const extension = gl.getExtension('WEBGL_debug_renderer_info');
	const context = Object.freeze({ renderer: String(gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
		native: gl instanceof WebGL2RenderingContext, floatTarget: gl.getExtension('EXT_color_buffer_float') !== null });
	return Object.freeze({
		read(): NativeFacts {
			let aliveHandles = 0;
			for (const kind of kinds) for (const handle of handles.get(kind)!) {
				const is = Reflect.get(prototype, `is${kind}`) as (value: object) => boolean;
				if (Reflect.apply(is, gl, [handle])) aliveHandles++;
			}
			return { aliveHandles, contexts: [context],
				created: Object.fromEntries(kinds.map(kind => [kind, handles.get(kind)!.size])) as Record<NativeKind, number>,
				deleted: Object.fromEntries(kinds.map(kind => [kind, [...handles.get(kind)!].filter(handle => deleted.get(kind)!.has(handle)).length])) as Record<NativeKind, number> };
		},
		stop(): void { for (const restore of restores.reverse()) restore(); },
	});
}
