/* SPDX-License-Identifier: AGPL-3.0-only */
import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
export { readGpuPreviewPhotoCustodyCurrentV1 as readGpuRepairPhotoCustodyCurrentV1 } from './lightscaper-develop-gpu-preview-current-reference.ts';

const bits = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const retired = (backing: ArrayBuffer) => Number(Reflect.apply(SIZE, backing, [])) === 0 || new Uint8Array(backing).every(n => n === 0);
const descriptor = Object.freeze({ schemaVersion: 1 as const, width: 32, height: 32, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
export function gpuRepairUiSpotsCurrentV1() {
	const common = { enabled: true, target: { x: 24.5 / 32, y: 24.5 / 32 }, radius: 1.5 / 32, feather: 0 };
	return [{ ...common, id: 'clone-ui', mode: 'clone', source: { x: 8.5 / 32, y: 24.5 / 32 }, opacity: 1 },
		{ ...common, id: 'heal-ui', mode: 'heal', source: { x: 8.5 / 32, y: 8.5 / 32 }, opacity: .5 }];
}
function source(words: readonly number[]) {
	if (words.length !== 4096 || words.some((n, at) => !Number.isInteger(n) || n < 0 || n > 65535 || at % 4 === 3 && n !== 65535)) throw new RangeError('Repair UI requires the actual32² opaque Original words.');
	return Float32Array.from(words, n => n / 65535);
}
function display(values: readonly number[]) { return values.map((n, at) => {
	if (at % 4 === 3) return Math.round(n * 255); const v = Math.max(0, Math.min(1, n));
	return Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055));
}); }
function decoded(words: readonly number[]) { return new Float32Array(Uint32Array.from(words).buffer); }
async function cpu(pixels: Float32Array<ArrayBuffer>, develop: unknown) {
	let backing: ArrayBuffer | undefined;
	const value = await withImageDevelopLinearCurrentV1({ frame: { descriptor, pixels }, develop }, output => { backing = output.pixels.buffer; return bits(output.pixels); }, PROFILE);
	if (!backing || !retired(backing)) throw new Error('Repair CPU witness output did not retire.'); return value;
}

/** Literal overlap oracle: constant target/donor halos make the Poisson
 * solution exactly the original target. Half-opacity Heal then averages that
 * Original context with the preceding full Clone, not an earlier donor plane.
 * The complete unchanged CPU writer remains the whole-frame authority. */
export async function gpuRepairWordsReferenceCurrentV1(words: readonly number[]) {
	const pixels = source(words), spots = gpuRepairUiSpotsCurrentV1(), center = (24 * 32 + 24) * 4;
	const authored = { ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots } };
	try {
		for (const [cx, cy] of [[24, 24], [8, 24], [8, 8]] as const) for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
			for (let channel = 0; channel < 4; channel++) if (!Object.is(pixels[(y * 32 + x) * 4 + channel], pixels[(cy * 32 + cx) * 4 + channel])) throw new Error('Repair RAW fixture literal requires flat actual decoded halos.');
		}
		const cloned = await cpu(pixels, { ...authored, repairs: { schemaVersion: 1, spots: spots.slice(0, 1) } }), after = await cpu(pixels, authored);
		const donor = pixels.slice((24 * 32 + 8) * 4, (24 * 32 + 9) * 4), expected = new Float32Array(4);
		try {
			for (let channel = 0; channel < 3; channel++) expected[channel] = .5 * donor[channel]! + .5 * pixels[center + channel]!;
			expected[3] = 1; const literal = bits(expected), donorBits = bits(donor);
			if (!literal.every((word, channel) => word === after[center + channel]) || !donorBits.every((word, channel) => word === cloned[center + channel])) throw new Error('Native CPU repair result differs from independent Clone/Poisson overlap literals.');
			const sourceBits = bits(pixels);
			if (after.every((word, at) => word === cloned[at]) || after.every((word, at) => word === sourceBits[at])) throw new Error('Both authored repair stages must visibly change this actual Original.');
			const values = decoded(after), cloneValues = decoded(cloned);
			try { return { before: display([...pixels]), after: display([...values]), cloned: display([...cloneValues]), bits: after, cloneBits: cloned, sourceBits, literal: { center, clone: donorBits, healed: literal } }; }
			finally { values.fill(0); cloneValues.fill(0); }
		} finally { donor.fill(0); expected.fill(0); }
	} finally { pixels.fill(0); }
}

/** An independent call to the maintained whole broker using the actual saved
 * recipe/native custody words. It never supplies pixels or a backend to UI. */
export async function qualifyGpuRepairSavedWordsCurrentV1(value: Readonly<{ words: readonly number[]; develop: unknown }>) {
	const pixels = source(value.words), before = bits(pixels);
	let calls = 0, backing: ArrayBuffer | undefined, observing = false;
	try {
		const expected = await cpu(pixels, value.develop);
		startGpuRepairUiObservationCurrentV1(); observing = true;
		const result = await withImageDevelopGpuCurrentV1({ frame: { descriptor, pixels }, develop: value.develop }, (output, execution) => {
			calls++; backing = output.pixels.buffer;
			return { ...execution, bits: bits(output.pixels), descriptor: output.descriptor, actualReadback: active!.hasReadback(backing), handlesAtDelivery: active!.read().aliveHandles };
		}, PROFILE);
		const observation = readGpuRepairUiObservationCurrentV1(), sourceUnchanged = before.every((word, at) => word === new Uint32Array(pixels.buffer)[at]);
		pixels.fill(0);
		return { ...result, calls, expected, sourceBits: before, sourceUnchanged, outputRetired: backing !== undefined && retired(backing), inputRetired: pixels.every(n => n === 0), observation };
	} finally { pixels.fill(0); if (observing) stopGpuRepairUiObservationCurrentV1(); }
}

type Kind = 'Texture' | 'Framebuffer' | 'Shader' | 'Program' | 'VertexArray' | 'Buffer' | 'Sync';
const KINDS: readonly Kind[] = ['Texture', 'Framebuffer', 'Shader', 'Program', 'VertexArray', 'Buffer', 'Sync'];
interface Readback { bits: number[]; jacobi: number; clone: number; healBlend: number; width: number; height: number }
interface Context { gl: WebGL2RenderingContext; renderer: string; native: boolean; program: object | null; jacobi: number; clone: number; healBlend: number; sourceUploads: number; sources: number[][] }
interface Tracker { read: () => ReturnType<typeof snapshot>; reset: () => void; stop: () => void; hasReadback: (backing: ArrayBuffer) => boolean }
let active: Tracker | undefined;

/** Transparent native counters only. Heal has64 genuine Jacobi draws per spot;
 * no per-draw history or inherited64-draw ceiling can truncate this observer. */
export function startGpuRepairUiObservationCurrentV1(): void {
	if (active) throw new Error('Repair UI observation is already active.');
	const restores: (() => void)[] = [], contexts = new Map<WebGL2RenderingContext, Context>(), uniforms = new Map<object, Set<string>>();
	const created = new Map<Kind, Map<object, WebGL2RenderingContext>>(KINDS.map(kind => [kind, new Map<object, WebGL2RenderingContext>()] as const));
	const removed = new Map<Kind, Set<object>>(KINDS.map(kind => [kind, new Set<object>()] as const));
	const backings = new Set<ArrayBuffer>(), uploads = new Set<ArrayBuffer>(), finalBackings = new Set<ArrayBuffer>(), reads: Readback[] = [];
	const prototype = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype;
	let attempts = 0;
	const context = (gl: WebGL2RenderingContext): Context => {
		let state = contexts.get(gl); if (state) return state;
		if (contexts.size >= 64) throw new RangeError('Repair observation exceeded its bounded context generations.');
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		state = { gl, renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), native: gl instanceof WebGL2RenderingContext,
			program: null, jacobi: 0, clone: 0, healBlend: 0, sourceUploads: 0, sources: [] }; contexts.set(gl, state); return state;
	};
	const patch = (value: object | null, key: string, after: (receiver: object, args: unknown[], result: unknown) => void) => {
		let owner = value; while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) { if (value) throw new TypeError(`Repair native observation requires ${key}.`); return; }
		const target = owner, property = Object.getOwnPropertyDescriptor(target, key)!;
		if (typeof property.value !== 'function') throw new TypeError(`Repair native observation requires callable ${key}.`);
		const invoke = property.value as (...args: unknown[]) => unknown; restores.push(() => { Object.defineProperty(target, key, property); });
		Object.defineProperty(target, key, { ...property, value: function(this: object, ...args: unknown[]) { const result = Reflect.apply(invoke, this, args); after(this, args, result); return result; } });
	};
	const alive = () => {
		let count = 0;
		for (const kind of KINDS) for (const [handle, gl] of created.get(kind)!) {
			const method = Reflect.get(prototype!, `is${kind}`) as (...args: unknown[]) => unknown;
			if (Reflect.apply(method, gl, [handle])) count++;
		} return count;
	};
	const reset = () => {
		if (alive() || [...backings, ...uploads].some(backing => !retired(backing))) throw new Error('Repair observation cannot reset before physical retirement.');
		for (const read of reads) read.bits.fill(0); for (const state of contexts.values()) for (const values of state.sources) values.fill(0);
		reads.length = 0; contexts.clear(); uniforms.clear(); backings.clear(); uploads.clear(); finalBackings.clear(); attempts = 0;
		for (const kind of KINDS) { created.get(kind)!.clear(); removed.get(kind)!.clear(); }
	};
	try {
		for (const canvas of [typeof HTMLCanvasElement === 'undefined' ? null : HTMLCanvasElement.prototype, typeof OffscreenCanvas === 'undefined' ? null : OffscreenCanvas.prototype]) patch(canvas, 'getContext', (_receiver, args, result) => {
			if (args[0] !== 'webgl2') return; attempts++; if (result && typeof result === 'object') context(result as WebGL2RenderingContext);
		});
		for (const kind of KINDS) {
			if (kind === 'Sync') continue;
			patch(prototype, `create${kind}`, (receiver, _args, handle) => { if (handle && typeof handle === 'object') created.get(kind)!.set(handle, receiver as WebGL2RenderingContext); });
			patch(prototype, `delete${kind}`, (_receiver, args) => { if (args[0] && typeof args[0] === 'object') removed.get(kind)!.add(args[0]); });
		}
		patch(prototype, 'fenceSync', (receiver, _args, handle) => { if (handle && typeof handle === 'object') created.get('Sync')!.set(handle, receiver as WebGL2RenderingContext); });
		patch(prototype, 'deleteSync', (_receiver, args) => { if (args[0] && typeof args[0] === 'object') removed.get('Sync')!.add(args[0]); });
		patch(prototype, 'getUniformLocation', (_receiver, args, result) => { if (!result || !args[0] || typeof args[0] !== 'object' || typeof args[1] !== 'string') return;
			let names = uniforms.get(args[0]); if (!names) { names = new Set(); uniforms.set(args[0], names); } names.add(args[1]); });
		patch(prototype, 'useProgram', (receiver, args) => { context(receiver as WebGL2RenderingContext).program = args[0] && typeof args[0] === 'object' ? args[0] : null; });
		patch(prototype, 'drawArrays', (receiver) => { const state = context(receiver as WebGL2RenderingContext), names = state.program ? uniforms.get(state.program) : undefined;
			if (names?.has('uPrevious')) state.jacobi++; else if (names?.has('uCurrent') && names.has('uSolution')) state.healBlend++;
			else if (names?.has('uOriginal') && names.has('uCurrent')) state.clone++; });
		const upload = (receiver: object, args: unknown[]) => { if (!(args[8] instanceof Float32Array)) return;
			const backing = args[8].buffer; if (!(backing instanceof ArrayBuffer)) throw new TypeError('Repair observed upload requires actual fixed ArrayBuffer.'); uploads.add(backing);
			if (args[3] === 32 && args[4] === 32 && args[8].length === 4096) { const state = context(receiver as WebGL2RenderingContext); state.sourceUploads++;
				if (state.sources.length >= 4) throw new RangeError('Repair context uploaded the Original repeatedly.'); state.sources.push([...new Uint32Array(backing, args[8].byteOffset, args[8].length)]); } };
		patch(prototype, 'texImage2D', upload);
		patch(prototype, 'readPixels', (receiver, args) => { if (!(args[6] instanceof Float32Array)) return;
			const output = args[6], backing = output.buffer; if (!(backing instanceof ArrayBuffer)) throw new TypeError('Repair observed readback requires actual fixed ArrayBuffer.'); backings.add(backing);
			if (args[2] !== 32 || args[3] !== 32) return;
			if (output.length !== 4096 || reads.length >= 32) throw new RangeError('Repair UI readbacks exceed the owned32² fixture.');
			const state = context(receiver as WebGL2RenderingContext); finalBackings.add(backing);
			reads.push({ width: 32, height: 32, bits: [...new Uint32Array(backing, output.byteOffset, output.length)], jacobi: state.jacobi, clone: state.clone, healBlend: state.healBlend });
		});
		active = { read: () => snapshot(attempts, contexts, created, removed, reads, alive(), backings, uploads), reset,
			hasReadback: backing => finalBackings.has(backing), stop() { for (const restore of restores.reverse()) restore(); reset(); } };
	} catch (error) { for (const restore of restores.reverse()) restore(); throw error; }
}
export function readGpuRepairUiObservationCurrentV1() { if (!active) throw new Error('Repair UI observation is absent.'); return active.read(); }
export function resetGpuRepairUiObservationCurrentV1(): void { if (!active) throw new Error('Repair UI observation is absent.'); active.reset(); }
export function stopGpuRepairUiObservationCurrentV1(): void { const value = active; active = undefined; value?.stop(); }
function snapshot(attempts: number, contexts: Map<WebGL2RenderingContext, Context>, created: Map<Kind, Map<object, WebGL2RenderingContext>>,
	removed: Map<Kind, Set<object>>, readbacks: readonly Readback[], aliveHandles: number, backings: Set<ArrayBuffer>, uploads: Set<ArrayBuffer>) {
	return { attempts, aliveHandles, readbacks: readbacks.map(read => ({ ...read, bits: [...read.bits] })),
		contexts: [...contexts.values()].map(value => ({ renderer: value.renderer, native: value.native, jacobi: value.jacobi, clone: value.clone, healBlend: value.healBlend,
			sourceUploads: value.sourceUploads, sources: value.sources.map(words => [...words]) })),
		created: Object.fromEntries(KINDS.map(kind => [kind, created.get(kind)!.size])), deleted: Object.fromEntries(KINDS.map(kind => [kind, removed.get(kind)!.size])),
		readbacksRetired: [...backings].every(retired), visibleStatusScratchRetired: [...backings].every(retired), uploadsRetired: [...uploads].every(retired) };
}
