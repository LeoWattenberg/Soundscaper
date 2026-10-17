/* SPDX-License-Identifier: AGPL-3.0-only */

export { readRawImportCustodyCurrentV1 as readGpuPreviewPhotoCustodyCurrentV1 } from './lightscaper-raw-import-current-reference.ts';

interface Pass { readonly kind: number; readonly params0: readonly number[]; readonly params1: readonly number[]; readonly width: number; readonly height: number }
interface Readback { readonly width: number; readonly height: number; readonly bits: Uint32Array<ArrayBuffer>; readonly passes: readonly Pass[] }
interface Context {
	readonly gl: WebGL2RenderingContext; readonly renderer: string; readonly native: boolean; readonly floatTarget: boolean;
	kind: number; params0: number[]; params1: number[]; width: number; height: number;
	probe: Float32Array<ArrayBuffer> | null; normalProbe: boolean; passes: Pass[];
}
type Kind = 'Texture' | 'Framebuffer' | 'Shader' | 'Program' | 'VertexArray' | 'Buffer' | 'Sync';
const KINDS: readonly Kind[] = ['Texture', 'Framebuffer', 'Shader', 'Program', 'VertexArray', 'Buffer', 'Sync'];
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
interface Observation {
	read(): ReturnType<typeof snapshot>;
	reset(): void;
	stop(): void;
}
let active: Observation | undefined;

/** Observe only the actual application path. This helper never imports or
 * invokes a renderer, supplies a context/capability, or changes GL results. */
export function startGpuPreviewObservationCurrentV1(): void {
	if (active) throw new Error('GPU preview observation is already owned.');
	const restorations: { owner: object; key: string; descriptor: PropertyDescriptor }[] = [];
	const contexts = new Map<WebGL2RenderingContext, Context>(), uniforms = new Map<object, string>();
	const handles = new Map<Kind, Map<object, WebGL2RenderingContext>>(KINDS.map(kind => [kind, new Map<object, WebGL2RenderingContext>()] as const));
	const deleted = new Map<Kind, Set<object>>(KINDS.map(kind => [kind, new Set<object>()] as const));
	const reads: Readback[] = [], backings: ArrayBuffer[] = [];
	let attempts = 0, floatUploads = 0, floatTargets = 0;
	const prototype = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype;
	function context(gl: WebGL2RenderingContext): Context {
		let current = contexts.get(gl); if (current) return current;
		if (contexts.size >= 32) throw new Error('GPU observer context inventory exceeded its bounded generation.');
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		current = { gl, renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
			native: gl instanceof WebGL2RenderingContext, floatTarget: gl.getExtension('EXT_color_buffer_float') !== null,
			kind: 0, params0: [], params1: [], width: 0, height: 0, probe: null, normalProbe: false, passes: [] };
		contexts.set(gl, current); return current;
	}
	function install(ownerValue: object | null, key: string, after: (receiver: object, args: unknown[], value: unknown) => void) {
		let owner = ownerValue;
		while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) return;
		const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
		if (typeof descriptor.value !== 'function') throw new TypeError(`Native observation requires ${key}.`);
		const invoke = descriptor.value as (...args: unknown[]) => unknown;
		restorations.push({ owner, key, descriptor });
		Object.defineProperty(owner, key, { ...descriptor, value: function (this: object, ...args: unknown[]) {
			const result = Reflect.apply(invoke, this, args); after(this, args, result); return result;
		} });
	}
	for (const canvas of [typeof HTMLCanvasElement === 'undefined' ? null : HTMLCanvasElement.prototype,
		typeof OffscreenCanvas === 'undefined' ? null : OffscreenCanvas.prototype]) install(canvas, 'getContext', (_receiver, args, result) => {
			if (args[0] !== 'webgl2') return; attempts++;
			if (result && typeof result === 'object') context(result as WebGL2RenderingContext);
		});
	for (const kind of KINDS) {
		install(prototype, `create${kind}`, (receiver, _args, result) => {
			if (result && typeof result === 'object') handles.get(kind)!.set(result, receiver as WebGL2RenderingContext);
		});
		install(prototype, `delete${kind}`, (_receiver, args) => { if (args[0] && typeof args[0] === 'object') deleted.get(kind)!.add(args[0]); });
	}
	install(prototype, 'fenceSync', (receiver, _args, result) => {
		if (result && typeof result === 'object') handles.get('Sync')!.set(result, receiver as WebGL2RenderingContext);
	});
	install(prototype, 'getUniformLocation', (_receiver, args, result) => {
		if (result && typeof result === 'object' && typeof args[1] === 'string') uniforms.set(result, args[1]);
	});
	install(prototype, 'uniform1i', (receiver, args) => {
		if (args[0] && typeof args[0] === 'object' && uniforms.get(args[0]) === 'uKind') context(receiver as WebGL2RenderingContext).kind = Number(args[1]);
	});
	install(prototype, 'uniform4f', (receiver, args) => {
		const name = args[0] && typeof args[0] === 'object' ? uniforms.get(args[0]) : undefined;
		if (name !== 'uParams0' && name !== 'uParams1') return;
		context(receiver as WebGL2RenderingContext)[name === 'uParams0' ? 'params0' : 'params1'] = args.slice(1, 5).map(Number);
	});
	install(prototype, 'viewport', (receiver, args) => { const current = context(receiver as WebGL2RenderingContext); current.width = Number(args[2]); current.height = Number(args[3]); });
	install(prototype, 'texImage2D', (receiver, args) => {
		const gl = receiver as WebGL2RenderingContext, current = context(gl);
		if (args[2] === gl.RGBA32F) floatTargets++;
		if (args[7] !== gl.FLOAT || !(args[8] instanceof Float32Array)) return;
		floatUploads++;
		if (args[3] === 4 && args[4] === 1 && args[8].length === 16) {
			current.probe?.fill(0); current.probe = new Float32Array(args[8]);
		}
	});
	install(prototype, 'texStorage2D', (receiver, args) => { if (args[2] === (receiver as WebGL2RenderingContext).RGBA32F) floatTargets++; });
	install(prototype, 'texSubImage2D', (receiver, args) => { if (args[7] === (receiver as WebGL2RenderingContext).FLOAT && args[8] instanceof Float32Array) floatUploads++; });
	const draw = (receiver: object) => {
		const value = context(receiver as WebGL2RenderingContext);
		if (value.passes.length >= 64) throw new Error('GPU observer stage inventory exceeded its bounded generation.');
		value.passes.push({ kind: value.kind, params0: [...value.params0], params1: [...value.params1], width: value.width, height: value.height });
	};
	install(prototype, 'drawArrays', draw); install(prototype, 'drawElements', draw);
	install(prototype, 'readPixels', (receiver, args) => {
		const gl = receiver as WebGL2RenderingContext, current = context(gl), output = args[6];
		if (args[5] !== gl.FLOAT || !(output instanceof Float32Array)) return;
		const width = Number(args[2]), height = Number(args[3]);
		if (width === 4 && height === 1 && current.kind === 1 && current.probe && current.params0.slice(0, 3).every(n => n === 2)) {
			current.normalProbe = current.probe.every((n, at) => {
				const expected = Math.fround(n * (at % 4 === 3 ? 1 : 2));
				return Math.abs(expected) > 0 && Math.abs(expected) < 2 ** -126 || Object.is(output[at], expected);
			});
		}
		if (width !== 32 || height !== 32) return;
		if (output.length !== 4096 || reads.length >= 16) throw new Error('GPU observer readback exceeded the owned32² fixture.');
		reads.push({ width, height, bits: new Uint32Array(output.buffer, output.byteOffset, output.length).slice(),
			passes: current.passes.filter(pass => pass.width === width && pass.height === height).map(pass => ({ ...pass, params0: [...pass.params0], params1: [...pass.params1] })) });
		backings.push(output.buffer as ArrayBuffer);
	});
	const alive = () => {
		let count = 0;
		for (const kind of KINDS) for (const [handle, gl] of handles.get(kind)!) {
			const is = Reflect.get(prototype!, `is${kind}`) as (...args: unknown[]) => unknown;
			if (Reflect.apply(is, gl, [handle])) count++;
		}
		return count;
	};
	function read() { return snapshot({ attempts, floatUploads, floatTargets, reads, contexts: [...contexts.values()],
		aliveHandles: alive(), handles, deleted, backings }); }
	function reset() {
		if (alive()) throw new Error('GPU observation cannot reset before native handle retirement.');
		for (const value of reads) value.bits.fill(0);
		for (const value of contexts.values()) value.probe?.fill(0);
		reads.length = 0; backings.length = 0; contexts.clear(); uniforms.clear();
		for (const kind of KINDS) { handles.get(kind)!.clear(); deleted.get(kind)!.clear(); }
		attempts = 0; floatUploads = 0; floatTargets = 0;
	}
	active = { read, reset, stop() { reset(); for (const value of restorations.reverse()) Object.defineProperty(value.owner, value.key, value.descriptor); active = undefined; } };
}

function snapshot(value: { attempts: number; floatUploads: number; floatTargets: number; reads: readonly Readback[]; contexts: readonly Context[];
	aliveHandles: number; handles: Map<Kind, Map<object, WebGL2RenderingContext>>; deleted: Map<Kind, Set<object>>; backings: readonly ArrayBuffer[] }) {
	return { attempts: value.attempts, floatUploads: value.floatUploads, floatTargets: value.floatTargets, aliveHandles: value.aliveHandles,
		normalFloatSupported: value.contexts.some(context => context.floatTarget && context.normalProbe),
		contexts: value.contexts.map(({ renderer, native, floatTarget, normalProbe }) => ({ renderer, native, floatTarget, normalProbe })),
		readbacks: value.reads.map(read => ({ ...read, bits: Array.from(read.bits) })),
		created: Object.fromEntries(KINDS.map(kind => [kind, value.handles.get(kind)!.size])),
		deleted: Object.fromEntries(KINDS.map(kind => [kind, [...value.handles.get(kind)!.keys()].filter(handle => value.deleted.get(kind)!.has(handle)).length])),
		readbacksRetired: value.backings.every(backing => Number(Reflect.apply(SIZE, backing, [])) > 0 && new Uint8Array(backing).every(n => n === 0)) };
}
export function readGpuPreviewObservationCurrentV1() { if (!active) throw new Error('GPU preview observation is not installed.'); return active.read(); }
export function resetGpuPreviewObservationCurrentV1(): void { if (!active) throw new Error('GPU preview observation is not installed.'); active.reset(); }
export function stopGpuPreviewObservationCurrentV1(): void { active?.stop(); }
