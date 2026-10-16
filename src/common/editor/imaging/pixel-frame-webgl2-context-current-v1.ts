/* SPDX-License-Identifier: AGPL-3.0-only */
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { PIXEL_FRAME_WEBGL2_GLOBAL_VERTEX_CURRENT_V1 as VERTEX, PIXEL_FRAME_WEBGL2_GLOBAL_FRAGMENT_CURRENT_V1 as FRAGMENT } from './pixel-frame-webgl2-global-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_COLOR_FRAGMENT_CURRENT_V1 as COLOR_FRAGMENT } from './pixel-frame-webgl2-color-glsl-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1 as LUT_FRAGMENT } from './pixel-frame-webgl2-lut-glsl-current-v1.ts';
import { pixelFrameWebGl2PassSupportedCurrentV1, type PreparedPixelFrameWebGl2PassCurrentV1 } from './pixel-frame-webgl2-pass-current-v1.ts';
import type { PixelFrameWebGl2LutResourcesCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import { pixelFrameWebGl2NumericEligibleCurrentV1, validatePixelFrameWebGl2ColorReadbackCurrentV1 } from './pixel-frame-webgl2-numeric-current-v1.ts';

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
export async function openPixelFrameWebGl2ContextCurrentV1(frame: Readonly<LinearWorkingPixelFrameV1>, passes: readonly PreparedPixelFrameWebGl2PassCurrentV1[],
	allocate: () => Float32Array<ArrayBuffer>, signal?: AbortSignal, resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>) {
	checkRepairSignalV1(signal);
	if (passes.some(pass => !pixelFrameWebGl2PassSupportedCurrentV1(pass, resources))) unavailable('numeric-range');
	const extended = passes.some(pass => pass.kind > 2), hasLuts = passes.some(pass => pass.kind === 8);
	const cubeSize = hasLuts ? resources!.maximumSize : 0;
	const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1)
		: typeof document === 'object' ? document.createElement('canvas') : unavailable('canvas-unavailable');
	let gl: WebGL2RenderingContext | null;
	try { gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false }) as WebGL2RenderingContext | null; }
	catch { return unavailable('context-unavailable'); }
	if (!gl) return unavailable('context-unavailable');
	const native = gl;
	const textures: WebGLTexture[] = [], shaders: WebGLShader[] = [], programs: WebGLProgram[] = [], framebuffers: WebGLFramebuffer[] = [], arrays: WebGLVertexArrayObject[] = [];
	const synchronizations: WebGLSync[] = [];
	let uniforms: Float32Array<ArrayBuffer> | undefined;
	let cubeUpload: Float32Array<ArrayBuffer> | undefined, cubeTexture: WebGLTexture | undefined;
	let cubeAllocated = false;
	let disposed = false;
	const assertCurrent = () => {
		checkRepairSignalV1(signal);
		if (native.isContextLost()) unavailable('context-lost');
		if (native.getError() !== native.NO_ERROR) unavailable('execution-unavailable');
	};
	const dispose = () => {
		if (disposed) return; disposed = true; const failures: unknown[] = [];
		const attempt = (work: () => void) => { try { work(); } catch (error) { failures.push(error); } };
		attempt(() => { uniforms?.fill(0); });
		attempt(() => { cubeUpload?.fill(0); });
		// Clear live application-visible textures before deleting handles. A lost
		// context already revokes those handles and cannot accept an overwrite.
		if (!native.isContextLost() && framebuffers[0]) attempt(() => {
			native.bindFramebuffer(native.FRAMEBUFFER, framebuffers[0]!);
			const zero = new Float32Array(4);
			try {
				for (const texture of textures) { native.framebufferTexture2D(native.FRAMEBUFFER, native.COLOR_ATTACHMENT0, native.TEXTURE_2D, texture, 0); native.clearBufferfv(native.COLOR, 0, zero); }
				if (cubeTexture && cubeAllocated) for (let layer = 0; layer < cubeSize; layer++) {
					native.framebufferTextureLayer(native.FRAMEBUFFER, native.COLOR_ATTACHMENT0, cubeTexture, 0, layer);
					if (native.checkFramebufferStatus(native.FRAMEBUFFER) !== native.FRAMEBUFFER_COMPLETE) throw new Error('Native GPU LUT layer cannot retire physically.');
					native.clearBufferfv(native.COLOR, 0, zero);
				}
			}
			finally { zero.fill(0); } native.finish();
		});
		for (const value of synchronizations) attempt(() => { native.deleteSync(value); });
		for (const value of arrays) attempt(() => { native.deleteVertexArray(value); });
		for (const value of framebuffers) attempt(() => { native.deleteFramebuffer(value); });
		for (const value of textures) attempt(() => { native.deleteTexture(value); });
		if (cubeTexture) attempt(() => { native.deleteTexture(cubeTexture!); });
		for (const value of programs) attempt(() => { native.deleteProgram(value); });
		for (const value of shaders) attempt(() => { native.deleteShader(value); });
		attempt(() => { native.getExtension('WEBGL_lose_context')?.loseContext(); });
		attempt(() => { canvas.width = 0; canvas.height = 0; });
		if (failures.length === 1) throw failures[0];
		if (failures.length) throw new AggregateError(failures, 'Native GPU GL retirement failed.', { cause: failures[0] });
	};
	try {
		if (!native.getExtension('EXT_color_buffer_float')) unavailable('float-target-unavailable');
		if (extended && Number(native.getParameter(native.MAX_FRAGMENT_UNIFORM_VECTORS)) < (hasLuts ? 143 : 142)) unavailable('uniform-capacity');
		if (hasLuts && Number(native.getParameter(native.MAX_3D_TEXTURE_SIZE)) < cubeSize) unavailable('lut-texture-capacity');
		if (hasLuts && Number(native.getParameter(native.MAX_TEXTURE_IMAGE_UNITS)) < 2) unavailable('sampler-capacity');
		const limit = Number(native.getParameter(native.MAX_TEXTURE_SIZE));
		const viewport = native.getParameter(native.MAX_VIEWPORT_DIMS) as Int32Array;
		if (frame.descriptor.width > limit || frame.descriptor.height > limit || frame.descriptor.width > viewport[0]! || frame.descriptor.height > viewport[1]!) unavailable('texture-capacity');
		const program = native.createProgram(); if (!program) return unavailable('execution-unavailable'); programs.push(program);
		for (const [kind, source] of [[native.VERTEX_SHADER, VERTEX], [native.FRAGMENT_SHADER, hasLuts ? LUT_FRAGMENT : extended ? COLOR_FRAGMENT : FRAGMENT]] as const) {
			const shader = native.createShader(kind); if (!shader) return unavailable('execution-unavailable'); shaders.push(shader);
			native.shaderSource(shader, source); native.compileShader(shader);
			if (!native.getShaderParameter(shader, native.COMPILE_STATUS)) unavailable('execution-unavailable'); native.attachShader(program, shader);
		}
		native.linkProgram(program); if (!native.getProgramParameter(program, native.LINK_STATUS)) unavailable('execution-unavailable');
		const uniform = (name: string) => { const location = native.getUniformLocation(program, name); if (!location) return unavailable('execution-unavailable'); return location; };
		const image = uniform('uImage'), kind = uniform('uKind'), params0 = uniform('uParams0'), params1 = uniform('uParams1');
		const cube = hasLuts ? uniform('uCube') : undefined;
		const colorUniforms = extended ? { params2: uniform('uParams2'), bands: uniform('uBands[0]'),
			counts: uniform('uCurveCounts'), points: uniform('uCurvePoints[0]') } : undefined;
		for (let index = 0; index < 2; index++) {
			const texture = native.createTexture(); if (!texture) return unavailable('execution-unavailable'); textures.push(texture);
			native.bindTexture(native.TEXTURE_2D, texture);
			for (const key of [native.TEXTURE_MIN_FILTER, native.TEXTURE_MAG_FILTER]) native.texParameteri(native.TEXTURE_2D, key, native.NEAREST);
			for (const key of [native.TEXTURE_WRAP_S, native.TEXTURE_WRAP_T]) native.texParameteri(native.TEXTURE_2D, key, native.CLAMP_TO_EDGE);
		}
		const framebuffer = native.createFramebuffer(); if (!framebuffer) return unavailable('execution-unavailable'); framebuffers.push(framebuffer);
		const array = native.createVertexArray(); if (!array) return unavailable('execution-unavailable'); arrays.push(array);
		native.bindVertexArray(array); native.useProgram(program); native.uniform1i(image, 0);
		if (cube) {
			native.uniform1i(cube, 1); native.activeTexture(native.TEXTURE1);
			const texture = native.createTexture(); if (!texture) return unavailable('execution-unavailable'); cubeTexture = texture;
			native.bindTexture(native.TEXTURE_3D, texture);
			for (const key of [native.TEXTURE_MIN_FILTER, native.TEXTURE_MAG_FILTER]) native.texParameteri(native.TEXTURE_3D, key, native.NEAREST);
			for (const key of [native.TEXTURE_WRAP_S, native.TEXTURE_WRAP_T, native.TEXTURE_WRAP_R]) native.texParameteri(native.TEXTURE_3D, key, native.CLAMP_TO_EDGE);
			native.texImage3D(native.TEXTURE_3D, 0, native.RGBA32F, cubeSize, cubeSize, cubeSize, 0, native.RGBA, native.FLOAT, null);
			assertCurrent(); cubeAllocated = true; native.activeTexture(native.TEXTURE0);
		}
		native.disable(native.BLEND); native.disable(native.DITHER); native.disable(native.DEPTH_TEST); native.disable(native.SCISSOR_TEST);
		native.pixelStorei(native.UNPACK_ALIGNMENT, 1); native.pixelStorei(native.PACK_ALIGNMENT, 1);
		native.pixelStorei(native.UNPACK_FLIP_Y_WEBGL, false); native.pixelStorei(native.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		const upload = (index: number, width: number, height: number, pixels: Float32Array<ArrayBuffer> | null) => {
			native.bindTexture(native.TEXTURE_2D, textures[index]!); native.texImage2D(native.TEXTURE_2D, 0, native.RGBA32F, width, height, 0, native.RGBA, native.FLOAT, pixels);
		};
		const draw = (input: number, output: number, width: number, height: number, pass?: PreparedPixelFrameWebGl2PassCurrentV1) => {
			assertCurrent(); native.bindFramebuffer(native.FRAMEBUFFER, framebuffer);
			native.framebufferTexture2D(native.FRAMEBUFFER, native.COLOR_ATTACHMENT0, native.TEXTURE_2D, textures[output]!, 0);
			if (native.checkFramebufferStatus(native.FRAMEBUFFER) !== native.FRAMEBUFFER_COMPLETE) unavailable('float-target-unavailable');
			native.viewport(0, 0, width, height); native.activeTexture(native.TEXTURE0); native.bindTexture(native.TEXTURE_2D, textures[input]!);
			native.uniform1i(kind, pass?.kind ?? 0);
			if (pass?.kind === 8) {
				native.uniform4f(params0, ...pass.reference.domainMin, pass.reference.size);
				native.uniform4f(params1, ...pass.reference.domainMax, 0);
				const count = resources!.writeUpload(pass, cubeUpload!);
				native.activeTexture(native.TEXTURE1); native.bindTexture(native.TEXTURE_3D, cubeTexture!);
				native.texSubImage3D(native.TEXTURE_3D, 0, 0, 0, 0, pass.reference.size, pass.reference.size, pass.reference.size,
					native.RGBA, native.FLOAT, cubeUpload!.subarray(0, count));
				native.activeTexture(native.TEXTURE0); assertCurrent();
			} else if (pass) {
				native.uniform4f(params0, ...pass.params0); native.uniform4f(params1, ...pass.params1);
				if (colorUniforms && uniforms) {
					native.uniform4f(colorUniforms.params2, ...pass.params2);
					for (let band = 0; band < 8; band++) uniforms.set(pass.bands[band]!, band * 4);
					uniforms.set(pass.curvePoints, 32);
					native.uniform4fv(colorUniforms.bands, uniforms.subarray(0, 32));
					native.uniform4i(colorUniforms.counts, ...pass.curveCounts);
					native.uniform2fv(colorUniforms.points, uniforms.subarray(32));
				}
			}
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
		if (!await pixelFrameWebGl2NumericEligibleCurrentV1(frame.pixels, passes, subnormalCopy, subnormalArithmetic, assertCurrent, resources)) unavailable('numeric-range');
		if (extended) uniforms = new Float32Array(288);
		if (hasLuts) cubeUpload = new Float32Array(cubeSize ** 3 * 4);
		const { width, height } = frame.descriptor; upload(0, width, height, frame.pixels); upload(1, width, height, null); assertCurrent();
		let current = 0;
		for (const pass of passes) {
			draw(current, 1 - current, width, height, pass); current = 1 - current;
			if (pass.kind === 8) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); assertCurrent(); }
		}
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
		if (!await validatePixelFrameWebGl2ColorReadbackCurrentV1(frame.pixels, pixels, passes, assertCurrent, resources)) unavailable('numeric-range');
		return Object.freeze({ pixels, assertCurrent, dispose });
	} catch (error) {
		let retirement: { error: unknown } | undefined;
		try { dispose(); } catch (cleanup) { retirement = { error: cleanup }; }
		if (retirement && !Object.is(error, retirement.error))
			throw new AggregateError([error, retirement.error], 'Native GPU execution and GL retirement failed.', { cause: error });
		throw error;
	}
}
