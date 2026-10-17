/* SPDX-License-Identifier: AGPL-3.0-only */

import { MOTION_BLEND_MODES } from './motion-composition.ts';
import type { MotionCompositor, MotionCompositeTarget } from './motion-composition-renderer.ts';
import { createMotionSurface, motionSurfaceLength, validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import type { MotionColor } from './motion-property.ts';
import { motionCompositeFragmentShader, motionCompositeVertexShader } from './motion-webgl-shaders.ts';

export interface MotionWebGlCompositor extends MotionCompositor { dispose(): void }
export type MotionWebGlAdmission = Readonly<{ compositor: MotionWebGlCompositor; fallbackReason: null } | { compositor: null; fallbackReason: string }>;

/** Own a dedicated context. Callers may choose the CPU compositor when admission refuses. */
export function createMotionWebGlCompositor(canvas: HTMLCanvasElement | OffscreenCanvas): MotionWebGlAdmission {
	const context = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
	if (!context || !('createVertexArray' in context)) return { compositor: null, fallbackReason: 'Motion WebGL2 is unavailable; use the CPU compositor.' };
	const gl = context;
	if (!gl.getExtension('EXT_color_buffer_float')) return { compositor: null, fallbackReason: 'Motion WebGL2 floating-point surfaces are unavailable; use the CPU compositor.' };
	let program: WebGLProgram;
	try { program = createProgram(gl); }
	catch (error) { return { compositor: null, fallbackReason: `Motion WebGL2 initialization failed: ${error instanceof Error ? error.message : String(error)}` }; }
	const vao = gl.createVertexArray();
	if (!vao) { gl.deleteProgram(program); return { compositor: null, fallbackReason: 'Motion WebGL2 vertex allocation failed; use the CPU compositor.' }; }
	let disposed = false;
	const targets = new Set<MotionCompositeTarget>();
	return { fallbackReason: null, compositor: {
		retainedSurfaceCount: 3,
		supportsReplacement: true,
		begin(width: number, height: number, background: MotionColor): MotionCompositeTarget {
			assertActive(); motionSurfaceLength(width, height);
			const limit: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
			if (typeof limit !== 'number' || width > limit || height > limit) throw new RangeError('Motion composition exceeds this WebGL2 texture size; use the CPU compositor.');
			const textures: WebGLTexture[] = []; const framebuffers: WebGLFramebuffer[] = [];
			let closed = false; let front = 0;
			const close = (): void => { if (!closed) { closed = true; for (const fbo of framebuffers) gl.deleteFramebuffer(fbo); for (const texture of textures) gl.deleteTexture(texture); } };
			try {
				for (let i = 0; i < 3; i++) {
					const texture = gl.createTexture(); if (!texture) throw new Error('Motion WebGL2 texture allocation failed.'); textures.push(texture);
					gl.bindTexture(gl.TEXTURE_2D, texture);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
					gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
					if (i < 2) {
						const fbo = gl.createFramebuffer(); if (!fbo) throw new Error('Motion WebGL2 framebuffer allocation failed.'); framebuffers.push(fbo);
						gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
						if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Motion WebGL2 floating-point framebuffer is incomplete.');
					}
				}
				const initial = createMotionSurface(width, height, background);
				gl.bindTexture(gl.TEXTURE_2D, textures[0]!); upload(initial); assertHealthy();
			} catch (error) { close(); throw error; }
			const target: MotionCompositeTarget = {
				replace(source) {
					assertTarget(); validateMotionSurface(source);
					if (source.width !== width || source.height !== height) throw new RangeError('Motion WebGL2 replacement dimensions are invalid.');
					gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textures[front]!); upload(source); assertHealthy();
				},
				composite(source, mode, opacity) {
					assertTarget(); validateMotionSurface(source);
					if (source.width !== width || source.height !== height || !Number.isFinite(opacity)) throw new RangeError('Motion WebGL2 composite dimensions/opacity are invalid.');
					gl.useProgram(program); gl.bindVertexArray(vao); gl.viewport(0, 0, width, height);
					gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DITHER);
					gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1 - front]!);
					gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textures[2]!); upload(source);
					gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, textures[front]!);
					gl.uniform1i(gl.getUniformLocation(program, 'uSource'), 0); gl.uniform1i(gl.getUniformLocation(program, 'uBackdrop'), 1);
					gl.uniform1i(gl.getUniformLocation(program, 'uMode'), MOTION_BLEND_MODES.indexOf(mode));
					gl.uniform1f(gl.getUniformLocation(program, 'uOpacity'), Math.min(1, Math.max(0, opacity)));
					gl.drawArrays(gl.TRIANGLES, 0, 3); assertHealthy(); front = 1 - front;
				},
				finish() {
					assertTarget(); const surface = createMotionSurface(width, height);
					gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[front]!); gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, surface.pixels);
					assertHealthy(); validateMotionSurface(surface); return surface;
				},
				dispose() { close(); targets.delete(target); },
			};
			targets.add(target); return target;
			function assertTarget(): void { assertActive(); if (closed) throw new Error('Motion WebGL2 composition target is disposed.'); }
			function upload(surface: MotionSurface): void {
				gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
				gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, surface.pixels);
			}
		},
		dispose() { if (!disposed) { for (const target of [...targets]) target.dispose(); disposed = true; gl.deleteVertexArray(vao); gl.deleteProgram(program); } },
	} };
	function assertActive(): void { if (disposed) throw new Error('Motion WebGL2 compositor is disposed.'); if (gl.isContextLost()) throw new Error('Motion WebGL2 context was lost; retry with the CPU compositor.'); }
	function assertHealthy(): void { assertActive(); const error = gl.getError(); if (error !== gl.NO_ERROR) throw new Error(`Motion WebGL2 failed (${error}); retry with the CPU compositor.`); }
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
	const program = gl.createProgram(); if (!program) throw new Error('Program allocation failed.');
	const shaders: WebGLShader[] = [];
	try {
		for (const [kind, source] of [[gl.VERTEX_SHADER, motionCompositeVertexShader], [gl.FRAGMENT_SHADER, motionCompositeFragmentShader]] as const) {
			const shader = gl.createShader(kind); if (!shader) throw new Error('Shader allocation failed.'); shaders.push(shader);
			gl.shaderSource(shader, source); gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed.');
			gl.attachShader(program, shader);
		}
		gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed.');
		return program;
	} catch (error) { gl.deleteProgram(program); throw error; }
	finally { for (const shader of shaders) gl.deleteShader(shader); }
}
