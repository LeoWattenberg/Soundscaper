/* SPDX-License-Identifier: AGPL-3.0-only */
import { preparePixelFrameWebGl2RepairCurrentV1 as prepare } from '../../../src/common/editor/imaging/pixel-frame-webgl2-repair-current-v1.ts';
import { withPixelFrameWebGl2RepairCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-repair-context-current-v1.ts';
import { prepareLinearRepairsV1, writeLinearRepairsV1 } from '../../../src/common/editor/imaging/pixel-frame-linear-repair-v1.ts';
import { LINEAR_KERNEL_LIMITS_V1 } from '../../../src/common/editor/imaging/linear-kernel-descriptor-v1.ts';
import { pixelFrameWebGl2ComponentEquivalentCurrentV1 as equivalent } from '../../../src/common/editor/imaging/pixel-frame-webgl2-numeric-current-v1.ts';
import type { ImageDevelopRepairSpotV1 } from '../../../src/common/editor/imaging/image-develop-repair-spots-v1.ts';
const words = (p: Float32Array<ArrayBuffer>) => [...new Uint32Array(p.buffer, p.byteOffset, p.length)];
const retired = (b: ArrayBuffer) => b.byteLength === 0 || new Uint8Array(b).every(n => n === 0);
function spot(mode: 'clone' | 'heal', changes: Partial<ImageDevelopRepairSpotV1> = {}): ImageDevelopRepairSpotV1 {
	return { id: 'spot', mode, enabled: true, target: { x: .5, y: .5 }, source: { x: .5, y: .5 }, radius: .2, feather: 0, opacity: 1, ...changes };
}
export function nativeGpuRepairSceneCurrentV1(name: 'clone-alpha' | 'heal-coupled' | 'heal-forward' | 'heal-reverse') {
	const width = name === 'clone-alpha' ? 6 : name === 'heal-coupled' ? 10 : 11, height = name === 'heal-coupled' ? 5 : 3;
	const pixels = new Float32Array(width * height * 4); for (let at = 3; at < pixels.length; at += 4) pixels[at] = 1;
	const put = (x: number, y: number, v: readonly number[]) => { pixels.set(v, (y * width + x) * 4); };
	const patch = (x0: number, y0: number, w: number, h: number, n: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, [n, n, n, 1]); };
	let spots: readonly ImageDevelopRepairSpotV1[], literals: readonly Readonly<{ x: number; y: number; rgba: readonly number[] }>[];
	if (name === 'clone-alpha') {
		put(0, 0, [8, -4, 2, 1]); for (const [x, y] of [[1, 0], [0, 1], [1, 1]]) put(x!, y!, [99, -99, 33, 0]); put(4, 1, [2, 4, -2, .5]);
		spots = [spot('clone', { target: { x: 4.5 / 6, y: .5 }, source: { x: 1 / 6, y: 1 / 3 }, opacity: .5 })]; literals = [{ x: 4, y: 1, rgba: [2.75, 3, -1.5, .5] }];
	} else if (name === 'heal-coupled') {
		patch(0, 1, 4, 3, -2); for (const [x, y] of [[8, 2], [7, 1], [7, 3]]) put(x!, y!, [4, 4, 4, 1]);
		spots = [spot('heal', { target: { x: .7, y: .5 }, source: { x: .2, y: .5 }, radius: .15 })]; literals = [{ x: 6, y: 2, rgba: [1, 1, 1, 1] }, { x: 7, y: 2, rgba: [3, 3, 3, 1] }];
	} else {
		patch(0, 0, 3, 3, .5); put(1, 1, [1, 1, 1, 1]); patch(4, 0, 3, 3, 2); put(5, 1, [8, 8, 8, 1]); patch(8, 0, 3, 3, 4); put(9, 1, [0, 0, 0, 1]);
		const a = spot('heal', { id: 'a', target: { x: 9.5 / 11, y: .5 }, source: { x: 1.5 / 11, y: .5 }, opacity: .5 }), b = { ...a, id: 'b', source: { x: 5.5 / 11, y: .5 } };
		spots = name === 'heal-forward' ? [a, b] : [b, a]; const n = name === 'heal-forward' ? 6.125 : 4.75; literals = [{ x: 9, y: 1, rgba: [n, n, n, 1] }];
	}
	return { width, height, pixels, spots, literals };
}
/** Whole CPU oracle is computed and retired before GL. Its bounded word scalars
 * never feed a texture/uniform; all native donor/RHS/Jacobi data comes from O. */
export async function runNativeGpuRepairCurrentV1(name: Parameters<typeof nativeGpuRepairSceneCurrentV1>[0]) {
	const input = nativeGpuRepairSceneCurrentV1(name);
	try {
		const descriptor = { schemaVersion: 1 as const, width: input.width, height: input.height,
			sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, definition = { schemaVersion: 1, spots: input.spots };
		const source = { descriptor, pixels: input.pixels }, cpu = prepareLinearRepairsV1(definition, descriptor, LINEAR_KERNEL_LIMITS_V1), plan = prepare(definition, descriptor);
		const expected = new Float32Array(input.pixels.length), scratch = new Uint8Array(cpu.scratchBytes), before = words(input.pixels);
		let expectedWords: number[]; try { await writeLinearRepairsV1(cpu, input.pixels, expected, scratch); expectedWords = words(expected); } finally { expected.fill(0); scratch.fill(0); }
		const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
		if (!gl) { input.pixels.fill(0); throw new Error('Mandatory repair component requires actual WebGL2.'); }
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
		const restore: (() => void)[] = [], jacobiPrograms = new Set<object>(), readbacks = new Set<ArrayBuffer>(), uploads = new Set<ArrayBuffer>();
		const handles = new Map<object, string>(); let current: object | null = null, nativeJacobi = 0, floatUploads = 0, byteUploads = 0, callbacks = 0;
		const patch = (key: string, after: (args: unknown[], result: unknown) => void) => {
			let owner: object | null = WebGL2RenderingContext.prototype; while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
			if (!owner) throw new Error(`Missing native method ${key}`); const target = owner, descriptor = Object.getOwnPropertyDescriptor(target, key)!;
			if (typeof descriptor.value !== 'function') throw new Error(`Invalid native method ${key}`);
			const method = descriptor.value as (...args: unknown[]) => unknown; restore.push(() => { Object.defineProperty(target, key, descriptor); });
			Object.defineProperty(target, key, { ...descriptor, value: function(this: WebGL2RenderingContext, ...args: unknown[]) { const result = Reflect.apply(method, this, args); if (this === gl) after(args, result); return result; } });
		};
		let result: unknown;
		try {
			patch('compileShader', args => { const shader = args[0] as WebGLShader; if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Native repair shader: ${gl.getShaderInfoLog(shader)}`); });
			for (const [create, remove] of [['createTexture', 'deleteTexture'], ['createProgram', 'deleteProgram'], ['createShader', 'deleteShader'], ['createFramebuffer', 'deleteFramebuffer'], ['createVertexArray', 'deleteVertexArray'], ['fenceSync', 'deleteSync']]) {
				patch(create!, (_args, handle) => { if (handle && typeof handle === 'object') handles.set(handle, create!); }); patch(remove!, args => { if (args[0] && typeof args[0] === 'object') handles.delete(args[0]); });
			}
			patch('getUniformLocation', (args, location) => { if (location && typeof location === 'object' && typeof args[1] === 'string') { if (args[1] === 'uPrevious' && args[0] && typeof args[0] === 'object') jacobiPrograms.add(args[0]); } });
			patch('useProgram', args => { current = args[0] && typeof args[0] === 'object' ? args[0] : null; });
			patch('drawArrays', () => { if (current && jacobiPrograms.has(current)) nativeJacobi++; });
			patch('texImage2D', args => { if (args[8] instanceof Float32Array) { floatUploads++; const backing = args[8].buffer; if (!(backing instanceof ArrayBuffer)) throw new Error('Upload backing brand changed.'); uploads.add(backing); }
				if (args[2] === gl.R8UI && args[8] !== null) byteUploads++; });
			patch('readPixels', args => { if (args[6] instanceof Float32Array) { const backing = args[6].buffer; if (!(backing instanceof ArrayBuffer)) throw new Error('Readback backing brand changed.'); readbacks.add(backing); } });
			result = await withPixelFrameWebGl2RepairCurrentV1(gl, plan, source, (frame, draws) => {
				callbacks++; const actual = words(frame.pixels), normative = new Float32Array(Uint32Array.from(expectedWords).buffer);
				try {
					const matched = [...frame.pixels].every((n, at) => at % 4 === 3 ? Object.is(n, normative[at]) : equivalent(normative[at]!, n));
					const copiedExact = actual.every((word, at) => input.literals.some(point => point.y * input.width + point.x === Math.floor(at / 4)) || word === before[at]);
					return { actual, expectedWords, matched, copiedExact, draws, actualReadback: readbacks.has(frame.pixels.buffer), literals: input.literals.map(literal => ({ ...literal, actual: [...frame.pixels.slice((literal.y * input.width + literal.x) * 4, (literal.y * input.width + literal.x + 1) * 4)] })) };
				} finally { normative.fill(0); }
			});
			return { result, renderer, callbacks, nativeJacobi, floatUploads, byteUploads, aliveHandles: handles.size, readbacksRetired: [...readbacks].every(retired),
				uploadsRetired: [...uploads].every(retired), sourceUnchanged: words(input.pixels).every((n, at) => n === before[at]), scratchRetired: scratch.every(n => n === 0) };
		} finally { for (const undo of restore.reverse()) undo(); }
	} finally { input.pixels.fill(0); }
}
