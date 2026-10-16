/* SPDX-License-Identifier: AGPL-3.0-only */
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { PIXEL_FRAME_WEBGL2_GLOBAL_VERTEX_CURRENT_V1 as VERTEX, PIXEL_FRAME_WEBGL2_GLOBAL_FRAGMENT_CURRENT_V1 as FRAGMENT,
	pixelFrameWebGl2GlobalChannelCurrentV1, type PreparedPixelFrameWebGl2GlobalCurrentV1 } from './pixel-frame-webgl2-global-current-v1.ts';

const UNAVAILABLE = new WeakMap<object, string>();
export class PixelFrameWebGl2UnavailableCurrentV1 extends Error {
	constructor(reason: string) { super(`Native GPU unavailable: ${reason}.`); UNAVAILABLE.set(this, reason); }
}
export function pixelFrameWebGl2UnavailableReasonCurrentV1(value: unknown): string | null {
	return typeof value === 'object' && value !== null ? UNAVAILABLE.get(value) ?? null : null;
}
const MINIMUM_NORMAL = 2 ** -126;
const unavailable = (reason: string): never => { throw new PixelFrameWebGl2UnavailableCurrentV1(reason); };

/** Private native GL owner. The source/readback allocations belong to the outer
 * physical ledger. Probe buffers are fixed and wiped before image execution.
 * Released handles do not certify physical driver-memory erasure. */
export async function openPixelFrameWebGl2ContextCurrentV1(frame: Readonly<LinearWorkingPixelFrameV1>, passes: readonly Readonly<PreparedPixelFrameWebGl2GlobalCurrentV1>[],
	allocate: () => Float32Array<ArrayBuffer>, signal?: AbortSignal) {
	checkRepairSignalV1(signal);
	const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1)
		: typeof document === 'object' ? document.createElement('canvas') : unavailable('canvas-unavailable');
	let gl: WebGL2RenderingContext | null;
	try { gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false }) as WebGL2RenderingContext | null; }
	catch { return unavailable('context-unavailable'); }
	if (!gl) return unavailable('context-unavailable');
	const native = gl;
	const textures: WebGLTexture[] = [], shaders: WebGLShader[] = [], programs: WebGLProgram[] = [], framebuffers: WebGLFramebuffer[] = [], arrays: WebGLVertexArrayObject[] = [];
	const synchronizations: WebGLSync[] = [];
	let disposed = false;
	const assertCurrent = () => {
		checkRepairSignalV1(signal);
		if (native.isContextLost()) unavailable('context-lost');
		if (native.getError() !== native.NO_ERROR) unavailable('execution-unavailable');
	};
	const dispose = () => {
		if (disposed) return; disposed = true; const failures: unknown[] = [];
		const attempt = (work: () => void) => { try { work(); } catch (error) { failures.push(error); } };
		// Clear live application-visible textures before deleting handles. A lost
		// context already revokes those handles and cannot accept an overwrite.
		if (!native.isContextLost() && framebuffers[0]) attempt(() => {
			native.bindFramebuffer(native.FRAMEBUFFER, framebuffers[0]!);
			const zero = new Float32Array(4);
			try { for (const texture of textures) { native.framebufferTexture2D(native.FRAMEBUFFER, native.COLOR_ATTACHMENT0, native.TEXTURE_2D, texture, 0); native.clearBufferfv(native.COLOR, 0, zero); } }
			finally { zero.fill(0); } native.finish();
		});
		for (const value of synchronizations) attempt(() => { native.deleteSync(value); });
		for (const value of arrays) attempt(() => { native.deleteVertexArray(value); });
		for (const value of framebuffers) attempt(() => { native.deleteFramebuffer(value); });
		for (const value of textures) attempt(() => { native.deleteTexture(value); });
		for (const value of programs) attempt(() => { native.deleteProgram(value); });
		for (const value of shaders) attempt(() => { native.deleteShader(value); });
		attempt(() => { native.getExtension('WEBGL_lose_context')?.loseContext(); });
		attempt(() => { canvas.width = 0; canvas.height = 0; });
		if (failures.length === 1) throw failures[0];
		if (failures.length) throw new AggregateError(failures, 'Native GPU GL retirement failed.', { cause: failures[0] });
	};
	try {
		if (!native.getExtension('EXT_color_buffer_float')) unavailable('float-target-unavailable');
		const limit = Number(native.getParameter(native.MAX_TEXTURE_SIZE));
		const viewport = native.getParameter(native.MAX_VIEWPORT_DIMS) as Int32Array;
		if (frame.descriptor.width > limit || frame.descriptor.height > limit || frame.descriptor.width > viewport[0]! || frame.descriptor.height > viewport[1]!) unavailable('texture-capacity');
		const program = native.createProgram(); if (!program) return unavailable('execution-unavailable'); programs.push(program);
		for (const [kind, source] of [[native.VERTEX_SHADER, VERTEX], [native.FRAGMENT_SHADER, FRAGMENT]] as const) {
			const shader = native.createShader(kind); if (!shader) return unavailable('execution-unavailable'); shaders.push(shader);
			native.shaderSource(shader, source); native.compileShader(shader);
			if (!native.getShaderParameter(shader, native.COMPILE_STATUS)) unavailable('execution-unavailable'); native.attachShader(program, shader);
		}
		native.linkProgram(program); if (!native.getProgramParameter(program, native.LINK_STATUS)) unavailable('execution-unavailable');
		const uniform = (name: string) => { const location = native.getUniformLocation(program, name); if (!location) return unavailable('execution-unavailable'); return location; };
		const image = uniform('uImage'), kind = uniform('uKind'), params0 = uniform('uParams0'), params1 = uniform('uParams1');
		for (let index = 0; index < 2; index++) {
			const texture = native.createTexture(); if (!texture) return unavailable('execution-unavailable'); textures.push(texture);
			native.bindTexture(native.TEXTURE_2D, texture);
			for (const key of [native.TEXTURE_MIN_FILTER, native.TEXTURE_MAG_FILTER]) native.texParameteri(native.TEXTURE_2D, key, native.NEAREST);
			for (const key of [native.TEXTURE_WRAP_S, native.TEXTURE_WRAP_T]) native.texParameteri(native.TEXTURE_2D, key, native.CLAMP_TO_EDGE);
		}
		const framebuffer = native.createFramebuffer(); if (!framebuffer) return unavailable('execution-unavailable'); framebuffers.push(framebuffer);
		const array = native.createVertexArray(); if (!array) return unavailable('execution-unavailable'); arrays.push(array);
		native.bindVertexArray(array); native.useProgram(program); native.uniform1i(image, 0);
		native.disable(native.BLEND); native.disable(native.DITHER); native.disable(native.DEPTH_TEST); native.disable(native.SCISSOR_TEST);
		native.pixelStorei(native.UNPACK_ALIGNMENT, 1); native.pixelStorei(native.PACK_ALIGNMENT, 1);
		native.pixelStorei(native.UNPACK_FLIP_Y_WEBGL, false); native.pixelStorei(native.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		const upload = (index: number, width: number, height: number, pixels: Float32Array<ArrayBuffer> | null) => {
			native.bindTexture(native.TEXTURE_2D, textures[index]!); native.texImage2D(native.TEXTURE_2D, 0, native.RGBA32F, width, height, 0, native.RGBA, native.FLOAT, pixels);
		};
		const draw = (input: number, output: number, width: number, height: number, pass?: Readonly<PreparedPixelFrameWebGl2GlobalCurrentV1>) => {
			assertCurrent(); native.bindFramebuffer(native.FRAMEBUFFER, framebuffer);
			native.framebufferTexture2D(native.FRAMEBUFFER, native.COLOR_ATTACHMENT0, native.TEXTURE_2D, textures[output]!, 0);
			if (native.checkFramebufferStatus(native.FRAMEBUFFER) !== native.FRAMEBUFFER_COMPLETE) unavailable('float-target-unavailable');
			native.viewport(0, 0, width, height); native.activeTexture(native.TEXTURE0); native.bindTexture(native.TEXTURE_2D, textures[input]!);
			native.uniform1i(kind, pass ? pass.type === 'white-balance-v1' ? 1 : 2 : 0);
			if (pass) { native.uniform4f(params0, ...pass.params0); native.uniform4f(params1, ...pass.params1); }
			native.drawArrays(native.TRIANGLES, 0, 3); assertCurrent();
		};
		const probe = Float32Array.of(-0, 3.5, -2, 0, 1e-30, -1e-30, MINIMUM_NORMAL, .5, 2 ** -149, -(2 ** -149), .25, 1, 1 / 65535, 2 / 65535, 3 / 65535, 2 ** -149);
		const read = new Float32Array(probe.length); let subnormalCopy = true, subnormalArithmetic = true;
		try {
			upload(0, 4, 1, probe); upload(1, 4, 1, null);
			for (const mode of [0, 1]) {
				draw(0, 1, 4, 1); native.uniform1i(kind, mode); native.uniform4f(params0, 2, 2, 2, 0); native.drawArrays(native.TRIANGLES, 0, 3);
				native.readPixels(0, 0, 4, 1, native.RGBA, native.FLOAT, read); assertCurrent();
				for (let index = 0; index < probe.length; index++) {
					const expected = Math.fround(probe[index]! * (mode === 1 && index % 4 !== 3 ? 2 : 1));
					if (Object.is(read[index], expected)) continue;
					if (Math.abs(expected) > 0 && Math.abs(expected) < MINIMUM_NORMAL) {
						if (mode === 0 || index % 4 === 3) subnormalCopy = false; else subnormalArithmetic = false;
					} else unavailable('float-conformance-failed');
				}
			}
		} finally { probe.fill(0); read.fill(0); }
		if (!await numericEligible(frame.pixels, passes, subnormalCopy, subnormalArithmetic, assertCurrent)) unavailable('numeric-range');
		const { width, height } = frame.descriptor; upload(0, width, height, frame.pixels); upload(1, width, height, null); assertCurrent();
		let current = 0;
		for (const pass of passes) { draw(current, 1 - current, width, height, pass); current = 1 - current; }
		if (!passes.length) { draw(0, 1, width, height); current = 1; }
		const fence = native.fenceSync(native.SYNC_GPU_COMMANDS_COMPLETE, 0); if (!fence) return unavailable('execution-unavailable');
		synchronizations.push(fence); native.flush();
		// Let cancellation reach queued GPU work before the synchronous transfer.
		// A zero-timeout fence poll never blocks the browser's event loop.
		await new Promise<void>(resolve => { setTimeout(resolve, 0); }); assertCurrent();
		for (;;) {
			const status = native.clientWaitSync(fence, 0, 0); assertCurrent();
			if (status === native.ALREADY_SIGNALED || status === native.CONDITION_SATISFIED) break;
			if (status !== native.TIMEOUT_EXPIRED) unavailable('execution-unavailable');
			await new Promise<void>(resolve => { setTimeout(resolve, 0); }); assertCurrent();
		}
		native.bindFramebuffer(native.FRAMEBUFFER, framebuffer); native.framebufferTexture2D(native.FRAMEBUFFER, native.COLOR_ATTACHMENT0, native.TEXTURE_2D, textures[current]!, 0);
		const pixels = allocate(); native.readPixels(0, 0, width, height, native.RGBA, native.FLOAT, pixels); assertCurrent();
		for (const value of pixels) if (!Number.isFinite(value)) throw new RangeError('Native GPU output exceeds finite Float32 range.');
		return Object.freeze({ pixels, assertCurrent, dispose });
	} catch (error) {
		let retirement: { error: unknown } | undefined;
		try { dispose(); } catch (cleanup) { retirement = { error: cleanup }; }
		if (retirement && !Object.is(error, retirement.error))
			throw new AggregateError([error, retirement.error], 'Native GPU execution and GL retirement failed.', { cause: error });
		throw error;
	}
}

/** Some drivers flush denormals. Never grant an absolute-epsilon exception:
 * affected source/scale profiles take the exact whole CPU path. Nonlinear
 * near-zero arithmetic is conservatively refused until separately qualified. */
async function numericEligible(pixels: Float32Array<ArrayBuffer>, passes: readonly Readonly<PreparedPixelFrameWebGl2GlobalCurrentV1>[], copy: boolean, arithmetic: boolean, check: () => void): Promise<boolean> {
	const budget = new RepairTaskBudgetV1(check); check();
	const minimum = [Infinity, Infinity, Infinity];
	for (let offset = 0; offset < pixels.length; offset++) {
		if (budget.visit()) await budget.yield();
		const magnitude = Math.abs(pixels[offset]!); if (!magnitude) continue;
		if (magnitude < MINIMUM_NORMAL && (!copy || (offset % 4 !== 3 && passes.length && !arithmetic))) return false;
		if (offset % 4 !== 3) minimum[offset % 4] = Math.min(minimum[offset % 4]!, magnitude);
	}
	for (const pass of passes) {
		const p = pass.params0, q = pass.params1;
		const nonlinear = pass.type === 'tone-ladder-v1' && (p[1] !== 1 || p[2] !== 0 || p[3] !== 0 || q[0] !== 0 || q[1] !== 0);
		if (nonlinear && (minimum.some(value => value < 2 ** -60) || [...p, ...q].some(value => value !== 0 && Math.abs(value) < 2 ** -60))) return false;
		for (let channel = 0; channel < 3; channel++) {
			const gain = pass.type === 'white-balance-v1' ? p[channel]! : p[0] * p[1];
			minimum[channel] = Math.fround(minimum[channel]! * gain);
			if (!arithmetic && minimum[channel]! > 0 && minimum[channel]! < MINIMUM_NORMAL) return false;
		}
	}
	if (passes.some(nonlinear)) for (let offset = 0; offset < pixels.length; offset++) {
		if (offset % 4 === 3) continue;
		let current = pixels[offset]!;
		for (const pass of passes) {
			if (budget.visit()) await budget.yield();
			const next = Math.fround(pixelFrameWebGl2GlobalChannelCurrentV1(pass, current, offset % 4 as 0 | 1 | 2));
			if (!Number.isFinite(next)) throw new RangeError('Native GPU recipe exceeds finite Float32 range.');
			if (nonlinear(pass)) {
				const p = pass.params0, q = pass.params1;
				// F32 pivot/region arithmetic may cancel where the normative CPU
				// double intermediate retains a nonzero native sample. Refuse that
				// ill-conditioned profile instead of accepting an absolute epsilon.
				const scale = Math.abs(current * p[0] * p[1]) + Math.abs(.18 * (1 - p[1])) + Math.abs(p[2]) + Math.abs(p[3]) + Math.abs(q[0]) + Math.abs(q[1]);
				const uncertainty = 32 * 2 ** -23 * scale;
				if (uncertainty > 0 && Math.abs(next) <= uncertainty) return false;
			}
			if (!arithmetic && next !== 0 && Math.abs(next) < MINIMUM_NORMAL) return false;
			current = next;
		}
	}
	return true;
}

function nonlinear(pass: Readonly<PreparedPixelFrameWebGl2GlobalCurrentV1>): boolean {
	const p = pass.params0, q = pass.params1;
	return pass.type === 'tone-ladder-v1' && (p[1] !== 1 || p[2] !== 0 || p[3] !== 0 || q[0] !== 0 || q[1] !== 0);
}
