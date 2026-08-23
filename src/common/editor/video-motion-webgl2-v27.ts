/* SPDX-License-Identifier: AGPL-3.0-only */

/** Dedicated WebGL2 temporal-denoise accelerator; admission remains CPU-parity checked. */

import {
	createGrayVideoFrameV1,
	resolveStabilizationTransformV1,
} from './video-motion-processing-v27.ts';
import type {
	VideoMotionWebGl2AcceleratorV1,
	VideoTemporalNeighborV1,
} from './video-motion-denoise-v27.ts';

export interface DisposableVideoMotionWebGl2AcceleratorV1
	extends VideoMotionWebGl2AcceleratorV1 {
	dispose(): void;
}

interface WebGl2CanvasLike {
	getContext(
		kind: 'webgl2',
		options?: WebGLContextAttributes,
	): WebGL2RenderingContext | null;
}

const MAXIMUM_NEIGHBORS = 16;
const VERTEX_SHADER = `#version 300 es
precision highp float;
const vec2 POSITIONS[3] = vec2[3](vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0));
void main(){gl_Position=vec4(POSITIONS[gl_VertexID],0.0,1.0);}`;
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uFrames;
uniform ivec2 uSize;
uniform int uNeighborCount;
uniform mat3 uCurrentToNeighbor[16];
uniform float uStrength;
layout(location=0) out float outSample;
void main(){
	vec2 pixel=gl_FragCoord.xy-vec2(0.5);
	float original=texelFetch(uFrames,ivec3(ivec2(pixel),0),0).r;
	float total=original;
	float count=1.0;
	for(int index=0;index<16;index++){
		if(index>=uNeighborCount) break;
		vec2 coordinate=(uCurrentToNeighbor[index]*vec3(pixel,1.0)).xy;
		if(coordinate.x<0.0||coordinate.y<0.0
			||coordinate.x>float(uSize.x-1)||coordinate.y>float(uSize.y-1)) continue;
		vec2 uv=(coordinate+vec2(0.5))/vec2(uSize);
		total+=texture(uFrames,vec3(uv,float(index+1))).r;
		count+=1.0;
	}
	outSample=mix(original,total/count,uStrength);
}`;

export function tryCreateVideoMotionWebGl2AcceleratorV1(
	canvasValue: unknown,
): DisposableVideoMotionWebGl2AcceleratorV1 | null {
	if (!canvasValue || typeof canvasValue !== 'object'
		|| typeof (canvasValue as Partial<WebGl2CanvasLike>).getContext !== 'function') return null;
	try {
		const gl = (canvasValue as WebGl2CanvasLike).getContext('webgl2', {
			alpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			preserveDrawingBuffer: false,
		});
		return gl ? createVideoMotionWebGl2AcceleratorV1(gl) : null;
	} catch {
		return null;
	}
}

export function createVideoMotionWebGl2AcceleratorV1(
	glValue: unknown,
): DisposableVideoMotionWebGl2AcceleratorV1 {
	const gl = webGl2Context(glValue);
	if (!gl.getExtension('EXT_color_buffer_float')
		|| !gl.getExtension('OES_texture_float_linear')) {
		throw new Error('WebGL2 float render targets and filtering are unavailable.');
	}
	if (Number(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)) < MAXIMUM_NEIGHBORS + 1) {
		throw new Error('WebGL2 texture-array capacity is insufficient for temporal denoise.');
	}
	const program = createProgram(gl);
	const uniforms = Object.freeze({
		frames: uniform(gl, program, 'uFrames'),
		size: uniform(gl, program, 'uSize'),
		neighborCount: uniform(gl, program, 'uNeighborCount'),
		currentToNeighbor: uniform(gl, program, 'uCurrentToNeighbor[0]'),
		strength: uniform(gl, program, 'uStrength'),
	});
	let disposed = false;
	let active = false;
	return Object.freeze({
		kind: 'webgl2' as const,
		async temporalDenoise(
			request: Parameters<VideoMotionWebGl2AcceleratorV1['temporalDenoise']>[0],
		) {
			if (disposed) throw new Error('The WebGL2 motion accelerator is closed.');
			if (active) throw new Error('The WebGL2 motion accelerator cannot overlap operations.');
			active = true;
			try {
				throwIfAborted(request.signal);
				const current = request.current;
				const neighbors = request.neighbors;
				if (neighbors.length > MAXIMUM_NEIGHBORS) {
					throw new RangeError('WebGL2 temporal denoise neighbors exceed their bound.');
				}
				const strength = finiteUnit(request.strength, 'WebGL2 denoise strength');
				return run(gl, program, uniforms, current.width, current.height,
					current.samples, neighbors, strength, request.signal);
			} finally {
				active = false;
			}
		},
		dispose() {
			if (active) throw new Error('The WebGL2 motion accelerator is active.');
			if (disposed) return;
			disposed = true;
			gl.deleteProgram(program);
		},
	});
}

function run(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	uniforms: Readonly<{
		frames: WebGLUniformLocation;
		size: WebGLUniformLocation;
		neighborCount: WebGLUniformLocation;
		currentToNeighbor: WebGLUniformLocation;
		strength: WebGLUniformLocation;
	}>,
	width: number,
	height: number,
	current: readonly number[],
	neighbors: readonly VideoTemporalNeighborV1[],
	strength: number,
	signal?: AbortSignal,
) {
	const frames = requiredTexture(gl.createTexture(), 'WebGL2 frame-array texture');
	const output = requiredTexture(gl.createTexture(), 'WebGL2 output texture');
	const framebuffer = requiredFramebuffer(gl.createFramebuffer());
	const vertexArray = requiredVertexArray(gl.createVertexArray());
	try {
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, frames);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R32F, width, height,
			neighbors.length + 1, 0, gl.RED, gl.FLOAT, null);
		uploadLayer(gl, 0, width, height, current);
		neighbors.forEach((neighbor, index) => {
			throwIfAborted(signal);
			uploadLayer(gl, index + 1, width, height, neighbor.frame.samples);
		});

		gl.bindTexture(gl.TEXTURE_2D, output);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error('The WebGL2 temporal-denoise framebuffer is incomplete.');
		}

		gl.viewport(0, 0, width, height);
		gl.useProgram(program);
		gl.bindVertexArray(vertexArray);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, frames);
		gl.uniform1i(uniforms.frames, 0);
		gl.uniform2i(uniforms.size, width, height);
		gl.uniform1i(uniforms.neighborCount, neighbors.length);
		gl.uniform1f(uniforms.strength, strength);
		gl.uniformMatrix3fv(uniforms.currentToNeighbor, false, transformMatrices(neighbors));
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		throwIfAborted(signal);
		const samples = new Float32Array(width * height);
		// readPixels is the required transfer boundary; no per-frame gl.finish() is used.
		gl.readPixels(0, 0, width, height, gl.RED, gl.FLOAT, samples);
		if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) {
			throw new Error('The WebGL2 temporal-denoise operation failed.');
		}
		throwIfAborted(signal);
		return createGrayVideoFrameV1({ width, height, samples: [...samples] });
	} finally {
		gl.bindVertexArray(null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.deleteVertexArray(vertexArray);
		gl.deleteFramebuffer(framebuffer);
		gl.deleteTexture(output);
		gl.deleteTexture(frames);
	}
}

function uploadLayer(
	gl: WebGL2RenderingContext,
	layer: number,
	width: number,
	height: number,
	samples: readonly number[],
): void {
	if (samples.length !== width * height) throw new RangeError('WebGL2 denoise frame geometry changed.');
	gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer,
		width, height, 1, gl.RED, gl.FLOAT, Float32Array.from(samples));
}

function transformMatrices(neighbors: readonly VideoTemporalNeighborV1[]): Float32Array {
	const result = new Float32Array(MAXIMUM_NEIGHBORS * 9);
	neighbors.forEach((neighbor, index) => {
		const transform = resolveStabilizationTransformV1(neighbor.transformToCurrent, 1);
		const cosine = Math.cos(transform.rotationRadians) * transform.scale;
		const sine = Math.sin(transform.rotationRadians) * transform.scale;
		result.set([
			cosine, sine, 0,
			-sine, cosine, 0,
			transform.translateX, transform.translateY, 1,
		], index * 9);
	});
	return result;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
	const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
	const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
	const program = gl.createProgram();
	if (!program) throw new Error('WebGL2 could not allocate the temporal-denoise program.');
	try {
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(`WebGL2 temporal-denoise link failed: ${gl.getProgramInfoLog(program) ?? 'unknown error'}`);
		}
		return program;
	} catch (error) {
		gl.deleteProgram(program);
		throw error;
	} finally {
		gl.deleteShader(fragment);
		gl.deleteShader(vertex);
	}
}

function compileShader(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
	const shader = gl.createShader(kind);
	if (!shader) throw new Error('WebGL2 could not allocate a temporal-denoise shader.');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const reason = gl.getShaderInfoLog(shader) ?? 'unknown error';
		gl.deleteShader(shader);
		throw new Error(`WebGL2 temporal-denoise shader failed: ${reason}`);
	}
	return shader;
}

function uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
	const result = gl.getUniformLocation(program, name);
	if (!result) throw new Error(`WebGL2 temporal-denoise uniform ${name} is unavailable.`);
	return result;
}

function webGl2Context(value: unknown): WebGL2RenderingContext {
	if (!value || typeof value !== 'object'
		|| typeof (value as Partial<WebGL2RenderingContext>).texImage3D !== 'function'
		|| typeof (value as Partial<WebGL2RenderingContext>).drawArrays !== 'function') {
		throw new TypeError('A WebGL2 context is required for motion acceleration.');
	}
	return value as WebGL2RenderingContext;
}

function requiredTexture(value: WebGLTexture | null, name: string): WebGLTexture {
	if (!value) throw new Error(`${name} could not be allocated.`);
	return value;
}

function requiredFramebuffer(value: WebGLFramebuffer | null): WebGLFramebuffer {
	if (!value) throw new Error('The WebGL2 temporal-denoise framebuffer could not be allocated.');
	return value;
}

function requiredVertexArray(value: WebGLVertexArrayObject | null): WebGLVertexArrayObject {
	if (!value) throw new Error('The WebGL2 temporal-denoise vertex array could not be allocated.');
	return value;
}

function finiteUnit(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${name} must be within zero and one.`);
	}
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The WebGL2 motion operation was aborted.', 'AbortError');
}
