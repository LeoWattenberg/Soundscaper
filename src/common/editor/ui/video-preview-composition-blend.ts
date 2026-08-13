/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VIDEO_CLIP_COMPOSITION_BLEND_MODES,
	type VideoClipCompositionBlendMode,
} from '../video-clip-composition.ts';

import { VIDEO_PREVIEW_GEOMETRY_VERTEX_SHADER_SOURCE } from './video-preview-geometry-shader.ts';

const MODE_CODES = new Map<VideoClipCompositionBlendMode, number>(
	VIDEO_CLIP_COMPOSITION_BLEND_MODES.map((mode, index) => [mode, index]),
);

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_backdrop;
uniform sampler2D u_source;
uniform int u_blend_mode;
in vec2 v_uv;
out vec4 out_color;

vec3 blend_color(vec3 backdrop, vec3 source) {
	if (u_blend_mode == 1) return backdrop * source;
	if (u_blend_mode == 2) return backdrop + source - backdrop * source;
	if (u_blend_mode == 3) return mix(
		2.0 * backdrop * source,
		1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source),
		step(vec3(0.5), backdrop)
	);
	if (u_blend_mode == 4) return min(backdrop, source);
	if (u_blend_mode == 5) return max(backdrop, source);
	if (u_blend_mode == 6) return abs(backdrop - source);
	if (u_blend_mode == 7) return backdrop + source - 2.0 * backdrop * source;
	return source;
}

void main() {
	vec4 backdrop_sample = texture(u_backdrop, v_uv);
	vec4 source_sample = texture(u_source, v_uv);
	float backdrop_alpha = clamp(backdrop_sample.a, 0.0, 1.0);
	float source_alpha = clamp(source_sample.a, 0.0, 1.0);
	vec3 backdrop = backdrop_alpha > 0.00001
		? backdrop_sample.rgb / backdrop_alpha : vec3(0.0);
	vec3 source = source_alpha > 0.00001
		? source_sample.rgb / source_alpha : vec3(0.0);
	vec3 blended = blend_color(backdrop, source);
	vec3 premultiplied = (1.0 - source_alpha) * backdrop_sample.rgb
		+ source_alpha * ((1.0 - backdrop_alpha) * source + backdrop_alpha * blended);
	float alpha = source_alpha + backdrop_alpha * (1.0 - source_alpha);
	out_color = vec4(premultiplied, alpha);
}`;

interface VideoPreviewRenderTarget {
	readonly framebuffer: WebGLFramebuffer;
	readonly height: number;
	readonly texture: WebGLTexture;
	readonly width: number;
}

export interface VideoPreviewCompositionBlendRuntime {
	readonly buffer: WebGLBuffer;
	readonly program: WebGLProgram;
	readonly locations: Readonly<{
		backdrop: WebGLUniformLocation | null;
		blendMode: WebGLUniformLocation | null;
		position: number;
		positionTransform: WebGLUniformLocation | null;
		source: WebGLUniformLocation | null;
		textureTransform: WebGLUniformLocation | null;
	}>;
}

export function videoPreviewBlendModeCode(value: unknown): number {
	if (typeof value !== 'string' || !MODE_CODES.has(value as VideoClipCompositionBlendMode)) {
		throw new RangeError('Unsupported video preview blend mode.');
	}
	return MODE_CODES.get(value as VideoClipCompositionBlendMode) as number;
}

export function createVideoPreviewCompositionBlendRuntime(
	gl: WebGL2RenderingContext,
): VideoPreviewCompositionBlendRuntime {
	const program = createProgram(gl);
	const buffer = gl.createBuffer();
	if (!buffer) {
		gl.deleteProgram(program);
		throw new Error('Unable to allocate video preview blend geometry.');
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	return Object.freeze({
		buffer,
		program,
		locations: Object.freeze({
			backdrop: gl.getUniformLocation(program, 'u_backdrop'),
			blendMode: gl.getUniformLocation(program, 'u_blend_mode'),
			position: gl.getAttribLocation(program, 'a_position'),
			positionTransform: gl.getUniformLocation(program, 'u_position_transform'),
			source: gl.getUniformLocation(program, 'u_source'),
			textureTransform: gl.getUniformLocation(program, 'u_texture_transform'),
		}),
	});
}

export function drawVideoPreviewCompositionBlend(
	gl: WebGL2RenderingContext,
	runtime: VideoPreviewCompositionBlendRuntime,
	options: Readonly<{
		backdropTexture: WebGLTexture;
		blendMode: VideoClipCompositionBlendMode;
		sourceTexture: WebGLTexture;
		target: VideoPreviewRenderTarget;
	}>,
): void {
	gl.disable(gl.BLEND);
	gl.useProgram(runtime.program);
	gl.bindBuffer(gl.ARRAY_BUFFER, runtime.buffer);
	gl.enableVertexAttribArray(runtime.locations.position);
	gl.vertexAttribPointer(runtime.locations.position, 2, gl.FLOAT, false, 0, 0);
	gl.bindFramebuffer(gl.FRAMEBUFFER, options.target.framebuffer);
	gl.viewport(0, 0, options.target.width, options.target.height);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, options.backdropTexture);
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, options.sourceTexture);
	gl.uniform1i(runtime.locations.backdrop, 0);
	gl.uniform1i(runtime.locations.source, 1);
	gl.uniform1i(runtime.locations.blendMode, videoPreviewBlendModeCode(options.blendMode));
	gl.uniformMatrix3fv(runtime.locations.positionTransform, false, IDENTITY_POSITION);
	gl.uniformMatrix3fv(runtime.locations.textureTransform, false, IDENTITY_TEXTURE);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function disposeVideoPreviewCompositionBlendRuntime(
	gl: WebGL2RenderingContext,
	runtime: VideoPreviewCompositionBlendRuntime | null | undefined,
): void {
	if (!runtime) return;
	gl.deleteBuffer(runtime.buffer);
	gl.deleteProgram(runtime.program);
}

/** Reference premultiplied-alpha blend math for deterministic contract tests. */
export function videoPreviewBlendPixel(
	mode: VideoClipCompositionBlendMode,
	backdropSample: readonly [number, number, number, number],
	sourceSample: readonly [number, number, number, number],
): readonly [number, number, number, number] {
	videoPreviewBlendModeCode(mode);
	const backdropAlpha = unit(backdropSample[3]);
	const sourceAlpha = unit(sourceSample[3]);
	const backdrop = unassociate(backdropSample, backdropAlpha);
	const source = unassociate(sourceSample, sourceAlpha);
	const blended = backdrop.map((channel, index) => blendChannel(
		mode, channel, source[index] as number,
	));
	const rgb = backdrop.slice(0, 3).map((_, index) => (
		(1 - sourceAlpha) * (backdropSample[index] as number)
		+ sourceAlpha * ((1 - backdropAlpha) * (source[index] as number)
			+ backdropAlpha * (blended[index] as number))
	));
	return Object.freeze([
		rgb[0] as number,
		rgb[1] as number,
		rgb[2] as number,
		sourceAlpha + backdropAlpha * (1 - sourceAlpha),
	]);
}

const IDENTITY_POSITION = new Float32Array([2, 0, 0, 0, 2, 0, -1, -1, 1]);
const IDENTITY_TEXTURE = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
	const vertex = compileShader(gl, gl.VERTEX_SHADER, VIDEO_PREVIEW_GEOMETRY_VERTEX_SHADER_SOURCE);
	const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
	const program = gl.createProgram();
	if (!program) throw new Error('Unable to allocate video preview blend program.');
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program;
	const message = gl.getProgramInfoLog(program) ?? 'Unknown video preview blend link failure.';
	gl.deleteProgram(program);
	throw new Error(message);
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Unable to allocate a video preview blend shader.');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
	const message = gl.getShaderInfoLog(shader) ?? 'Unknown video preview blend compilation failure.';
	gl.deleteShader(shader);
	throw new Error(message);
}

function unit(value: number): number {
	if (!Number.isFinite(value)) throw new RangeError('Video preview blend samples must be finite.');
	return Math.max(0, Math.min(1, value));
}

function unassociate(sample: readonly number[], alpha: number): number[] {
	return sample.slice(0, 3).map((value) => alpha > 1e-5 ? value / alpha : 0);
}

function blendChannel(
	mode: VideoClipCompositionBlendMode,
	backdrop: number,
	source: number,
): number {
	switch (mode) {
		case 'normal': return source;
		case 'multiply': return backdrop * source;
		case 'screen': return backdrop + source - backdrop * source;
		case 'overlay': return backdrop <= 0.5
			? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
		case 'darken': return Math.min(backdrop, source);
		case 'lighten': return Math.max(backdrop, source);
		case 'difference': return Math.abs(backdrop - source);
		case 'exclusion': return backdrop + source - 2 * backdrop * source;
	}
}
