const MAX_RENDER_DIMENSION = 4096;
const COPY_PASS = Object.freeze({});
const RECT_COPY_PASS = Object.freeze({ code: 8 });
const FINAL_YUV420_PASS = Object.freeze({ code: 7 });
const EMPTY_EFFECTS = Object.freeze([]);
const ZERO_VECTOR_2 = Object.freeze([0, 0]);
const ZERO_VECTOR_4 = Object.freeze([0, 0, 0, 0]);
const MAX_GAUSSIAN_BLUR_PAIR_COUNT = 30;
const EFFECT_PROGRAM_COUNT = 9;
// Calibrated default pass scale that retains the strict FFmpeg golden-frame gates.
const GAUSSIAN_BLUR_RENDER_SCALE = 2 / 3;
const GAUSSIAN_BLUR_SIGMA_CALIBRATION = 0.85;
// Adaptive blur downsampling keeps the complete three-sigma kernel inside this
// bound instead of silently truncating high-sigma previews. Export is unaffected.
export const VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA = (
	MAX_GAUSSIAN_BLUR_PAIR_COUNT * 2 - 1
) / 3 / GAUSSIAN_BLUR_SIGMA_CALIBRATION;
const BLUR_KERNEL = Symbol('blurKernel');
export const VIDEO_PREVIEW_PIXELATE_GRID_SIZE = 2;

const EFFECT_CODES = Object.freeze({
	'color-adjust': 1,
	pixelate: 2,
	vignette: 3,
	'gaussian-blur': 4,
	sharpen: 5,
	'rgb-split': 6,
});

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
	v_uv = a_position * 0.5 + 0.5;
	gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform int u_effect;
uniform vec2 u_resolution;
uniform vec2 u_source_resolution;
uniform vec4 u_content_rect;
uniform vec4 u_source_rect;
uniform vec2 u_direction;
uniform vec4 u_params0;
uniform vec4 u_params1;
uniform float u_opacity;
uniform vec2 u_blur_pairs[${MAX_GAUSSIAN_BLUR_PAIR_COUNT}];
uniform int u_blur_pair_count;
uniform float u_blur_weight_sum;

in vec2 v_uv;
out vec4 out_color;

vec4 sample_frame(vec2 uv) {
	return texture(u_texture, clamp(uv, vec2(0.0), vec2(1.0)));
}

vec4 sample_content(vec2 uv) {
	vec2 half_texel = 0.5 / max(u_source_resolution, vec2(1.0));
	vec2 bounded_uv = clamp(uv, half_texel, vec2(1.0) - half_texel);
	return texture(u_texture, u_source_rect.xy + bounded_uv * u_source_rect.zw);
}

vec3 rgb_to_limited_yuv(vec3 rgb) {
	return vec3(
		16.0 / 255.0 + dot(rgb, vec3(65.481, 128.553, 24.966) / 255.0),
		128.0 / 255.0 + dot(rgb, vec3(-37.797, -74.203, 112.0) / 255.0),
		128.0 / 255.0 + dot(rgb, vec3(112.0, -93.786, -18.214) / 255.0)
	);
}

vec3 limited_yuv_to_rgb(vec3 yuv) {
	float luma = 1.164383 * (yuv.x - 16.0 / 255.0);
	float cb = yuv.y - 128.0 / 255.0;
	float cr = yuv.z - 128.0 / 255.0;
	return vec3(
		luma + 1.596027 * cr,
		luma - 0.391762 * cb - 0.812968 * cr,
		luma + 2.017232 * cb
	);
}

void main() {
	vec2 content_uv = (v_uv - u_content_rect.xy) / max(u_content_rect.zw, vec2(0.00001));
	if (u_effect != 0 && (
		content_uv.x < 0.0 || content_uv.y < 0.0
		|| content_uv.x > 1.0 || content_uv.y > 1.0
	)) {
		out_color = vec4(0.0);
		return;
	}
	vec4 color = u_effect == 0 ? sample_frame(v_uv) : sample_content(content_uv);

	if (u_effect == 7) {
		// Match export's final yuv420p chroma negotiation before RGBA display.
		vec2 output_pixel = floor(content_uv * u_resolution);
		// With LINEAR filtering, the center of each 2x2 block averages all
		// four source texels before the linear RGB-to-chroma conversion.
		vec2 chroma_pixel = floor(output_pixel * 0.5) * 2.0 + 1.0;
		vec3 chroma_rgb = sample_content(chroma_pixel / max(u_resolution, vec2(1.0))).rgb;
		float y = 16.0 / 255.0 + dot(color.rgb, vec3(65.481, 128.553, 24.966) / 255.0);
		float cb = 128.0 / 255.0 + dot(chroma_rgb, vec3(-37.797, -74.203, 112.0) / 255.0);
		float cr = 128.0 / 255.0 + dot(chroma_rgb, vec3(112.0, -93.786, -18.214) / 255.0);
		float luma = 1.164383 * (y - 16.0 / 255.0);
		color.rgb = vec3(
			luma + 1.596027 * (cr - 128.0 / 255.0),
			luma - 0.391762 * (cb - 128.0 / 255.0) - 0.812968 * (cr - 128.0 / 255.0),
			luma + 2.017232 * (cb - 128.0 / 255.0)
		);
	} else if (u_effect == 1) {
		float brightness = u_params0.x;
		float contrast = u_params0.y;
		float saturation = u_params0.z;
		float gamma = max(0.01, u_params0.w);
		vec3 yuv = rgb_to_limited_yuv(color.rgb);
		yuv.x = clamp(pow(max((yuv.x - 0.5) * contrast + 0.5 + brightness, 0.0), 1.0 / gamma), 0.0, 1.0);
		yuv.yz = clamp((yuv.yz - 0.5) * saturation + 0.5, 0.0, 1.0);
		float hue = radians(u_params1.x);
		vec2 chroma = yuv.yz - 128.0 / 255.0;
		yuv.yz = clamp(vec2(
			chroma.x * cos(hue) - chroma.y * sin(hue),
			chroma.x * sin(hue) + chroma.y * cos(hue)
		) + 128.0 / 255.0, 0.0, 1.0);
		// These are the same legal-range guards serialized after eq/hue for export.
		yuv.x = clamp(yuv.x, 16.0 / 255.0, 235.0 / 255.0);
		yuv.yz = clamp(yuv.yz, vec2(16.0 / 255.0), vec2(240.0 / 255.0));
		color.rgb = limited_yuv_to_rgb(yuv);
	} else if (u_effect == 2) {
		float block_size = max(1.0, u_params0.x);
		vec2 pixel_size = vec2(block_size) / max(u_resolution, vec2(1.0));
		vec2 top_origin_uv = vec2(content_uv.x, 1.0 - content_uv.y);
		vec2 block_origin = floor(top_origin_uv / pixel_size) * pixel_size;
		vec2 block_extent = min(pixel_size, vec2(1.0) - block_origin);
		vec4 block_average = vec4(0.0);
		for (int sample_y = 0; sample_y < ${VIDEO_PREVIEW_PIXELATE_GRID_SIZE}; sample_y += 1) {
			for (int sample_x = 0; sample_x < ${VIDEO_PREVIEW_PIXELATE_GRID_SIZE}; sample_x += 1) {
				vec2 sample_position = (vec2(float(sample_x), float(sample_y)) + 0.5)
					/ float(${VIDEO_PREVIEW_PIXELATE_GRID_SIZE});
				vec2 top_origin_sample = block_origin + sample_position * block_extent;
				block_average += sample_content(vec2(top_origin_sample.x, 1.0 - top_origin_sample.y));
			}
		}
		color = block_average / float(${VIDEO_PREVIEW_PIXELATE_GRID_SIZE * VIDEO_PREVIEW_PIXELATE_GRID_SIZE});
	} else if (u_effect == 3) {
		float amount = clamp(u_params0.x, 0.0, 1.0);
		float angle = amount * (1.57079632679 - 0.001);
		vec2 render_pixel = floor(content_uv * u_resolution);
		vec2 ffmpeg_pixel = vec2(render_pixel.x, u_resolution.y - 1.0 - render_pixel.y);
		vec2 centered_pixels = ffmpeg_pixel - u_resolution * 0.5;
		float maximum_distance = max(0.00001, length(u_resolution * 0.5));
		float normalized_distance = clamp(length(centered_pixels) / maximum_distance, 0.0, 1.0);
		float cosine = cos(angle * normalized_distance);
		float attenuation = cosine * cosine * cosine * cosine;
		color.rgb = floor(color.rgb * attenuation * 255.0) / 255.0;
	} else if (u_effect == 4) {
		vec4 blurred = sample_content(content_uv);
		for (int pair_index = 0; pair_index < ${MAX_GAUSSIAN_BLUR_PAIR_COUNT}; pair_index += 1) {
			if (pair_index >= u_blur_pair_count) break;
			vec2 pair = u_blur_pairs[pair_index];
			vec2 offset = u_direction * pair.x / max(u_resolution, vec2(1.0));
			blurred += sample_content(content_uv + offset) * pair.y;
			blurred += sample_content(content_uv - offset) * pair.y;
		}
		color = blurred / max(u_blur_weight_sum, 0.00001);
	} else if (u_effect == 5) {
		float amount = max(0.0, u_params0.x);
		float pixel_scale = max(0.0001, u_params0.y);
		vec2 texel = vec2(pixel_scale) / max(u_resolution, vec2(1.0));
		float blurred_luminance = 0.0;
		// Linear sampling combines the [1, 4] side pairs of the exact
		// [1, 4, 6, 4, 1] binomial kernel into one sample at +/- 1.2 texels.
		// The resulting separable [5, 6, 5] weights retain the original 5x5
		// convolution while reducing its 25 texture reads to nine.
		for (int offset_y = -1; offset_y <= 1; offset_y += 1) {
			float weight_y = offset_y == 0 ? 6.0 : 5.0;
			for (int offset_x = -1; offset_x <= 1; offset_x += 1) {
				float weight_x = offset_x == 0 ? 6.0 : 5.0;
				vec3 sample_rgb = sample_content(
					content_uv + vec2(float(offset_x), float(offset_y)) * texel * 1.2
				).rgb;
				blurred_luminance += dot(sample_rgb, vec3(0.299, 0.587, 0.114))
					* weight_x * weight_y;
			}
		}
		blurred_luminance /= 256.0;
		float source_luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
		color.rgb += vec3(amount * (source_luminance - blurred_luminance));
		// Preserve FFmpeg's luma-only unsharp and its YUV420 chroma siting.
		vec2 output_pixel = floor(content_uv * u_resolution);
		vec2 chroma_pixel = floor(output_pixel * 0.5) * 2.0 + 1.99;
		vec3 chroma_rgb = sample_content(chroma_pixel / max(u_resolution, vec2(1.0))).rgb;
		vec3 yuv = rgb_to_limited_yuv(color.rgb);
		yuv.yz = rgb_to_limited_yuv(chroma_rgb).yz;
		color.rgb = limited_yuv_to_rgb(yuv);
	} else if (u_effect == 6) {
		vec2 red_offset = vec2(-u_params0.x, u_params0.y)
			/ max(u_resolution, vec2(1.0));
		color.r = sample_content(content_uv + red_offset).r;
		color.b = sample_content(content_uv - red_offset).b;
	}

	color.a *= clamp(u_opacity, 0.0, 1.0);
	out_color = color;
}`;

function finiteNumber(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function gaussianBlurKernel(sigma) {
	// This scale calibrates the finite kernel to gblur's single-step IIR response.
	const calibratedSigma = Math.max(0.01, sigma * GAUSSIAN_BLUR_SIGMA_CALIBRATION);
	const radius = Math.ceil(calibratedSigma * 3);
	const pairs = new Float32Array(MAX_GAUSSIAN_BLUR_PAIR_COUNT * 2);
	let pairCount = 0;
	let weightSum = 1;
	for (let pairIndex = 0; pairIndex < MAX_GAUSSIAN_BLUR_PAIR_COUNT; pairIndex += 1) {
		const nearIndex = 1 + pairIndex * 2;
		const farIndex = nearIndex + 1;
		const nearWeight = nearIndex <= radius
			? Math.exp(-0.5 * nearIndex * nearIndex / (calibratedSigma * calibratedSigma))
			: 0;
		const farWeight = farIndex <= radius
			? Math.exp(-0.5 * farIndex * farIndex / (calibratedSigma * calibratedSigma))
			: 0;
		const pairWeight = nearWeight + farWeight;
		if (pairWeight <= 0) break;
		pairs[pairCount * 2] = (nearIndex * nearWeight + farIndex * farWeight) / pairWeight;
		pairs[pairCount * 2 + 1] = pairWeight;
		weightSum += 2 * pairWeight;
		pairCount += 1;
	}
	return { pairCount, pairs, weightSum };
}

function gaussianBlurPass(sigma, renderScale, direction, kernel) {
	const pass = {
		code: EFFECT_CODES['gaussian-blur'],
		params0: [sigma, 0, 0, 0],
		params1: [renderScale, 0, 0, 0],
		direction,
	};
	Object.defineProperty(pass, BLUR_KERNEL, { value: kernel });
	return pass;
}

/**
 * Convert one canonical video-effect record into one or more GPU passes.
 * Gaussian blur expands to two convolution passes.
 */
export function videoEffectPasses(effect, previewScale = {}) {
	if (!effect || effect.enabled === false) return [];
	const code = EFFECT_CODES[effect.type];
	if (!code) return [];
	const params = effect.params || {};
	const scaleX = Math.max(0.0001, finiteNumber(previewScale.x, 1));
	const scaleY = Math.max(0.0001, finiteNumber(previewScale.y, 1));
	const pixelScale = Math.min(scaleX, scaleY);
	if (effect.type === 'color-adjust') {
		const brightness = finiteNumber(params.brightness, 0);
		const contrast = finiteNumber(params.contrast, 1);
		const saturation = finiteNumber(params.saturation, 1);
		const gamma = finiteNumber(params.gamma, 1);
		const hueDegrees = finiteNumber(params.hueDegrees, 0);
		if (
			brightness === 0
			&& contrast === 1
			&& saturation === 1
			&& gamma === 1
			&& hueDegrees === 0
		) return [];
		return [{
			code,
			params0: [brightness, contrast, saturation, gamma],
			params1: [hueDegrees, 0, 0, 0],
			direction: [0, 0],
		}];
	}
	if (effect.type === 'gaussian-blur') {
		const sigma = finiteNumber(params.sigma, 0) * pixelScale;
		if (sigma <= 0) return [];
		const renderScale = Math.min(
			GAUSSIAN_BLUR_RENDER_SCALE,
			VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA / sigma,
		);
		const kernel = gaussianBlurKernel(sigma * renderScale);
		return [
			gaussianBlurPass(sigma, renderScale, [1, 0], kernel),
			gaussianBlurPass(sigma, renderScale, [0, 1], kernel),
		];
	}
	if (effect.type === 'rgb-split') {
		const offsetX = finiteNumber(params.offsetX, 0) * pixelScale;
		const offsetY = finiteNumber(params.offsetY, 0) * pixelScale;
		if (offsetX === 0 && offsetY === 0) return [];
		return [{
			code,
			params0: [offsetX, offsetY, 0, 0],
			params1: [0, 0, 0, 0],
			direction: [0, 0],
		}];
	}
	if (effect.type === 'sharpen') {
		const amount = finiteNumber(params.amount, 0);
		if (amount <= 0) return [];
		return [{
			code,
			params0: [amount, pixelScale, 0, 0],
			params1: [0, 0, 0, 0],
			direction: [0, 0],
		}];
	}
	const value = effect.type === 'pixelate'
		? finiteNumber(params.blockSize, 1) * pixelScale
		: effect.type === 'vignette'
			? finiteNumber(params.amount, 0)
			: finiteNumber(params.amount, 0);
	if (effect.type === 'vignette' && value <= 0) return [];
	return [{
		code,
		params0: [value, 0, 0, 0],
		params1: [0, 0, 0, 0],
		direction: [0, 0],
	}];
}

function compileShader(gl, type, source) {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Unable to allocate a WebGL shader.');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
	const message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation failure.';
	gl.deleteShader(shader);
	throw new Error(message);
}

function createProgram(gl, effectCode) {
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
	const fragmentSource = FRAGMENT_SHADER_SOURCE.replace(
		'uniform int u_effect;',
		`const int u_effect = ${effectCode};`,
	);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
	const program = gl.createProgram();
	if (!program) throw new Error('Unable to allocate a WebGL program.');
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);
	if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
	const message = gl.getProgramInfoLog(program) || 'Unknown WebGL program link failure.';
	gl.deleteProgram(program);
	throw new Error(message);
}

function programLocations(gl, program) {
	return {
		position: gl.getAttribLocation(program, 'a_position'),
		texture: gl.getUniformLocation(program, 'u_texture'),
		resolution: gl.getUniformLocation(program, 'u_resolution'),
		sourceResolution: gl.getUniformLocation(program, 'u_source_resolution'),
		contentRect: gl.getUniformLocation(program, 'u_content_rect'),
		sourceRect: gl.getUniformLocation(program, 'u_source_rect'),
		direction: gl.getUniformLocation(program, 'u_direction'),
		params0: gl.getUniformLocation(program, 'u_params0'),
		params1: gl.getUniformLocation(program, 'u_params1'),
		opacity: gl.getUniformLocation(program, 'u_opacity'),
		blurPairs: gl.getUniformLocation(program, 'u_blur_pairs[0]'),
		blurPairCount: gl.getUniformLocation(program, 'u_blur_pair_count'),
		blurWeightSum: gl.getUniformLocation(program, 'u_blur_weight_sum'),
	};
}

function createRenderTarget(gl, width, height) {
	const texture = gl.createTexture();
	const framebuffer = gl.createFramebuffer();
	if (!texture || !framebuffer) throw new Error('Unable to allocate a WebGL render target.');
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
		gl.deleteFramebuffer(framebuffer);
		gl.deleteTexture(texture);
		throw new Error('The WebGL video render target is incomplete.');
	}
	return { framebuffer, height, texture, width };
}

function deleteRenderTarget(gl, target) {
	if (!target) return;
	gl.deleteFramebuffer(target.framebuffer);
	gl.deleteTexture(target.texture);
}

function containViewport(sourceWidth, sourceHeight, outerX, outerY, outerWidth, outerHeight, viewport) {
	const scale = Math.min(outerWidth / sourceWidth, outerHeight / sourceHeight);
	const fittedWidth = Math.max(1, Math.round(sourceWidth * scale));
	const fittedHeight = Math.max(1, Math.round(sourceHeight * scale));
	viewport.x = outerX + Math.round((outerWidth - fittedWidth) / 2);
	viewport.y = outerY + Math.round((outerHeight - fittedHeight) / 2);
	viewport.width = fittedWidth;
	viewport.height = fittedHeight;
	return viewport;
}

/**
 * Mirror export geometry inside the physical preview panel: contain the export
 * canvas first, then contain a source inside that shared canvas viewport.
 */
export function videoPreviewViewports(
	sourceWidth,
	sourceHeight,
	panelWidth,
	panelHeight,
	referenceWidth,
	referenceHeight,
	result = null,
) {
	const output = result || {
		canvas: { x: 0, y: 0, width: 1, height: 1 },
		content: { x: 0, y: 0, width: 1, height: 1 },
		pixelScale: 1,
	};
	const safeSourceWidth = Math.max(1, finiteNumber(sourceWidth, 1));
	const safeSourceHeight = Math.max(1, finiteNumber(sourceHeight, 1));
	const safePanelWidth = Math.max(1, finiteNumber(panelWidth, 1));
	const safePanelHeight = Math.max(1, finiteNumber(panelHeight, 1));
	const safeReferenceWidth = Math.max(1, finiteNumber(referenceWidth, safePanelWidth));
	const safeReferenceHeight = Math.max(1, finiteNumber(referenceHeight, safePanelHeight));
	containViewport(
		safeReferenceWidth,
		safeReferenceHeight,
		0,
		0,
		safePanelWidth,
		safePanelHeight,
		output.canvas,
	);
	containViewport(
		safeSourceWidth,
		safeSourceHeight,
		output.canvas.x,
		output.canvas.y,
		output.canvas.width,
		output.canvas.height,
		output.content,
	);
	output.pixelScale = Math.min(
		safePanelWidth / safeReferenceWidth,
		safePanelHeight / safeReferenceHeight,
	);
	return output;
}

/** Map a full-resolution nested content rect into the active blur target. */
export function videoPreviewBlurViewport(
	contentViewport,
	panelWidth,
	panelHeight,
	blurTargetWidth,
	blurTargetHeight,
	renderScale = GAUSSIAN_BLUR_RENDER_SCALE,
	result = null,
) {
	const output = result || { x: 0, y: 0, width: 1, height: 1 };
	const safeTargetWidth = Math.max(1, Math.floor(finiteNumber(blurTargetWidth, 1)));
	const safeTargetHeight = Math.max(1, Math.floor(finiteNumber(blurTargetHeight, 1)));
	const targetScale = Math.max(0.0001, finiteNumber(renderScale, GAUSSIAN_BLUR_RENDER_SCALE))
		/ GAUSSIAN_BLUR_RENDER_SCALE;
	const scaleX = safeTargetWidth / Math.max(1, panelWidth) * targetScale;
	const scaleY = safeTargetHeight / Math.max(1, panelHeight) * targetScale;
	output.x = Math.min(safeTargetWidth - 1, Math.max(0, Math.round(contentViewport.x * scaleX)));
	output.y = Math.min(safeTargetHeight - 1, Math.max(0, Math.round(contentViewport.y * scaleY)));
	output.width = Math.min(
		safeTargetWidth - output.x,
		Math.max(1, Math.round(contentViewport.width * scaleX)),
	);
	output.height = Math.min(
		safeTargetHeight - output.y,
		Math.max(1, Math.round(contentViewport.height * scaleY)),
	);
	return output;
}

/**
 * Small WebGL2 compositor used only by the interactive video preview. Export
 * remains deterministic and uses the domain/export effect descriptions.
 */
export class VideoPreviewCompositor {
	constructor(canvas, options = {}) {
		if (!canvas?.getContext) throw new TypeError('A canvas is required for video preview composition.');
		this.canvas = canvas;
		this.onContextLost = options.onContextLost;
		this.onContextRestored = options.onContextRestored;
		this.gl = canvas.getContext('webgl2', {
			alpha: true,
			antialias: false,
			depth: false,
			preserveDrawingBuffer: false,
			premultipliedAlpha: false,
			stencil: false,
		});
		if (!this.gl) throw new Error('WebGL2 is unavailable.');
		this.disposed = false;
		this.contextLost = false;
		this.previewScale = { x: 1, y: 1 };
		this.viewports = {
			canvas: { x: 0, y: 0, width: 1, height: 1 },
			content: { x: 0, y: 0, width: 1, height: 1 },
			pixelScale: 1,
		};
		this.referenceViewports = {
			canvas: { x: 0, y: 0, width: 1, height: 1 },
			content: { x: 0, y: 0, width: 1, height: 1 },
			pixelScale: 1,
		};
		this.finalEffectResolution = { width: 1, height: 1 };
		this.blurContentViewport = { x: 0, y: 0, width: 1, height: 1 };
		this.effectStackCache = new WeakMap();
		this.renderGeneration = 0;
		this.handleContextLost = (event) => {
			event.preventDefault();
			this.contextLost = true;
			this.onContextLost?.();
		};
		this.handleContextRestored = () => {
			if (this.disposed) return;
			try {
				this.initializeResources();
				this.contextLost = false;
				this.onContextRestored?.();
			} catch {
				this.contextLost = true;
				this.onContextLost?.();
			}
		};
		this.initializeResources();
		canvas.addEventListener('webglcontextlost', this.handleContextLost);
		canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
	}

	initializeResources() {
		this.programs = Array.from(
			{ length: EFFECT_PROGRAM_COUNT },
			(_, effectCode) => createProgram(this.gl, effectCode),
		);
		this.programLocations = this.programs.map((program) => programLocations(this.gl, program));
		this.positionBuffer = this.gl.createBuffer();
		if (!this.positionBuffer) throw new Error('Unable to allocate the video preview geometry.');
		this.program = this.programs[0];
		this.locations = this.programLocations[0];
		this.currentProgram = null;
		this.boundBlurKernel = null;
		this.targets = null;
		this.videoTextures = new Map();
		this.configureGeometry();
	}

	passesForEffects(effects, previewScale) {
		const cached = this.effectStackCache.get(effects);
		if (cached?.scaleX === previewScale.x && cached.scaleY === previewScale.y) return cached.passes;
		const passes = [];
		for (const effect of effects) passes.push(...videoEffectPasses(effect, previewScale));
		this.effectStackCache.set(effects, {
			scaleX: previewScale.x,
			scaleY: previewScale.y,
			passes,
		});
		return passes;
	}

	configureGeometry() {
		const gl = this.gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
			-1, -1,
			1, -1,
			-1, 1,
			1, 1,
		]), gl.STATIC_DRAW);
		for (let index = 0; index < this.programs.length; index += 1) {
			const locations = this.programLocations[index];
			gl.useProgram(this.programs[index]);
			gl.enableVertexAttribArray(locations.position);
			gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);
			gl.uniform1i(locations.texture, 0);
		}
		this.currentProgram = null;
	}

	resizeToDisplaySize() {
		const rect = this.canvas.getBoundingClientRect();
		const pixelRatio = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
		let width = Math.max(1, Math.round(rect.width * pixelRatio));
		let height = Math.max(1, Math.round(rect.height * pixelRatio));
		const scale = Math.min(1, MAX_RENDER_DIMENSION / Math.max(width, height));
		width = Math.max(1, Math.round(width * scale));
		height = Math.max(1, Math.round(height * scale));
		if (this.canvas.width === width && this.canvas.height === height && this.targets) return;
		this.canvas.width = width;
		this.canvas.height = height;
		for (const target of Object.values(this.targets || {})) deleteRenderTarget(this.gl, target);
		this.targets = {
			ping: createRenderTarget(this.gl, width, height),
			pong: createRenderTarget(this.gl, width, height),
			layer: createRenderTarget(this.gl, width, height),
			composition: createRenderTarget(this.gl, width, height),
			blurPing: createRenderTarget(
				this.gl,
				Math.max(1, Math.round(width * GAUSSIAN_BLUR_RENDER_SCALE)),
				Math.max(1, Math.round(height * GAUSSIAN_BLUR_RENDER_SCALE)),
			),
			blurPong: createRenderTarget(
				this.gl,
				Math.max(1, Math.round(width * GAUSSIAN_BLUR_RENDER_SCALE)),
				Math.max(1, Math.round(height * GAUSSIAN_BLUR_RENDER_SCALE)),
			),
		};
	}

	uploadVideo(video) {
		const gl = this.gl;
		let record = this.videoTextures.get(video);
		if (!record) {
			const texture = gl.createTexture();
			if (!texture) throw new Error('Unable to allocate a video frame texture.');
			record = { texture, width: 0, height: 0, generation: this.renderGeneration };
			this.videoTextures.set(video, record);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		} else {
			record.generation = this.renderGeneration;
			gl.bindTexture(gl.TEXTURE_2D, record.texture);
		}
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		if (record.width !== video.videoWidth || record.height !== video.videoHeight) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
			record.width = video.videoWidth;
			record.height = video.videoHeight;
		} else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		return record.texture;
	}

	releaseVideo(video) {
		const record = this.videoTextures.get(video);
		if (!record) return;
		this.videoTextures.delete(video);
		this.gl.deleteTexture(record.texture);
	}

	pruneUnusedVideoTextures() {
		for (const [video, record] of this.videoTextures) {
			if (record.generation === this.renderGeneration) continue;
			this.gl.deleteTexture(record.texture);
			this.videoTextures.delete(video);
		}
	}

	clearTarget(target, red = 0, green = 0, blue = 0, alpha = 0) {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer || null);
		gl.viewport(0, 0, target?.width || this.canvas.width, target?.height || this.canvas.height);
		gl.clearColor(red, green, blue, alpha);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	draw(
		texture,
		target,
		pass = {},
		opacity = 1,
		viewport = null,
		contentViewport = null,
		sourceContentViewport = null,
		sourceTarget = null,
		effectResolution = null,
	) {
		const gl = this.gl;
		const targetWidth = target?.width || this.canvas.width;
		const targetHeight = target?.height || this.canvas.height;
		const effectCode = this.programs[pass.code] ? pass.code : 0;
		const program = this.programs[effectCode];
		const locations = this.programLocations[effectCode];
		if (program !== this.currentProgram) {
			gl.useProgram(program);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
			gl.enableVertexAttribArray(locations.position);
			gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);
			this.currentProgram = program;
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer || null);
		if (viewport) gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
		else gl.viewport(0, 0, targetWidth, targetHeight);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform2f(
			locations.resolution,
			effectResolution?.width || contentViewport?.width || targetWidth,
			effectResolution?.height || contentViewport?.height || targetHeight,
		);
		gl.uniform2f(
			locations.sourceResolution,
			sourceContentViewport?.width || contentViewport?.width || targetWidth,
			sourceContentViewport?.height || contentViewport?.height || targetHeight,
		);
		if (contentViewport) {
			gl.uniform4f(
				locations.contentRect,
				contentViewport.x / targetWidth,
				contentViewport.y / targetHeight,
				contentViewport.width / targetWidth,
				contentViewport.height / targetHeight,
			);
		} else gl.uniform4f(locations.contentRect, 0, 0, 1, 1);
		if (sourceContentViewport) {
			const sourceWidth = sourceTarget?.width || this.canvas.width;
			const sourceHeight = sourceTarget?.height || this.canvas.height;
			gl.uniform4f(
				locations.sourceRect,
				sourceContentViewport.x / sourceWidth,
				sourceContentViewport.y / sourceHeight,
				sourceContentViewport.width / sourceWidth,
				sourceContentViewport.height / sourceHeight,
			);
		} else if (contentViewport) {
			gl.uniform4f(
				locations.sourceRect,
				contentViewport.x / targetWidth,
				contentViewport.y / targetHeight,
				contentViewport.width / targetWidth,
				contentViewport.height / targetHeight,
			);
		} else gl.uniform4f(locations.sourceRect, 0, 0, 1, 1);
		gl.uniform2fv(locations.direction, pass.direction || ZERO_VECTOR_2);
		gl.uniform4fv(locations.params0, pass.params0 || ZERO_VECTOR_4);
		gl.uniform4fv(locations.params1, pass.params1 || ZERO_VECTOR_4);
		const blurKernel = pass[BLUR_KERNEL];
		if (blurKernel && blurKernel !== this.boundBlurKernel) {
			gl.uniform2fv(locations.blurPairs, blurKernel.pairs);
			gl.uniform1i(locations.blurPairCount, blurKernel.pairCount);
			gl.uniform1f(locations.blurWeightSum, blurKernel.weightSum);
			this.boundBlurKernel = blurKernel;
		}
		gl.uniform1f(locations.opacity, opacity);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	render(layers = [], options = {}) {
		if (this.disposed || this.contextLost) return -1;
		this.resizeToDisplaySize();
		this.renderGeneration += 1;
		const gl = this.gl;
		gl.disable(gl.BLEND);
		this.clearTarget(this.targets.composition, 0, 0, 0, 1);
		let renderedEntries = 0;
		const referenceWidth = Math.max(1, finiteNumber(options.referenceWidth, this.canvas.width));
		const referenceHeight = Math.max(1, finiteNumber(options.referenceHeight, this.canvas.height));
		const referenceViewports = videoPreviewViewports(
			referenceWidth,
			referenceHeight,
			this.canvas.width,
			this.canvas.height,
			referenceWidth,
			referenceHeight,
			this.referenceViewports,
		);
		const referenceViewport = referenceViewports.canvas;
		this.finalEffectResolution.width = referenceWidth;
		this.finalEffectResolution.height = referenceHeight;
		const previewScale = this.previewScale;
		let effectRenderFailed = false;

		for (const layer of layers) {
			this.clearTarget(this.targets.layer);
			let renderedLayerEntries = 0;
			for (const entry of layer.entries || []) {
				const video = entry.video;
				if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) continue;
				let videoTexture;
				try {
					videoTexture = this.uploadVideo(video);
				} catch {
					effectRenderFailed = true;
					continue;
				}
				const viewports = videoPreviewViewports(
					video.videoWidth,
					video.videoHeight,
					this.canvas.width,
					this.canvas.height,
					referenceWidth,
					referenceHeight,
					this.viewports,
				);
				const contentViewport = viewports.content;
				previewScale.x = viewports.pixelScale;
				previewScale.y = viewports.pixelScale;
				const opacity = finiteNumber(entry.opacity, 1);
				const passes = this.passesForEffects(entry.effects || EMPTY_EFFECTS, previewScale);
				if (!passes.length) {
					gl.enable(gl.BLEND);
					gl.blendEquation(gl.FUNC_ADD);
					gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
					this.draw(
						videoTexture,
						this.targets.layer,
						COPY_PASS,
						opacity,
						contentViewport,
					);
					renderedEntries += 1;
					renderedLayerEntries += 1;
					continue;
				}
				gl.disable(gl.BLEND);
				this.clearTarget(this.targets.ping);
				this.draw(
					videoTexture,
					this.targets.ping,
					COPY_PASS,
					1,
					contentViewport,
				);
				let sourceTarget = this.targets.ping;
				let entryComposited = false;
				for (let passIndex = 0; passIndex < passes.length; passIndex += 1) {
					const pass = passes[passIndex];
					if (pass.code === EFFECT_CODES['gaussian-blur']) {
						const isHorizontalPass = pass.direction?.[0] === 1;
						if (isHorizontalPass) {
							const blurViewport = videoPreviewBlurViewport(
								contentViewport,
								this.canvas.width,
								this.canvas.height,
								this.targets.blurPing.width,
								this.targets.blurPing.height,
								pass.params1?.[0],
								this.blurContentViewport,
							);
							this.clearTarget(this.targets.blurPing);
							this.draw(
								sourceTarget.texture,
								this.targets.blurPing,
								RECT_COPY_PASS,
								1,
								null,
								blurViewport,
								contentViewport,
								sourceTarget,
							);
							this.clearTarget(this.targets.blurPong);
							this.draw(
								this.targets.blurPing.texture,
								this.targets.blurPong,
								pass,
								1,
								null,
								blurViewport,
							);
							sourceTarget = this.targets.blurPong;
						} else {
							this.clearTarget(this.targets.blurPing);
							this.draw(
								sourceTarget.texture,
								this.targets.blurPing,
								pass,
								1,
								null,
								this.blurContentViewport,
							);
							this.clearTarget(this.targets.ping);
							this.draw(
								this.targets.blurPing.texture,
								this.targets.ping,
								RECT_COPY_PASS,
								1,
								null,
								contentViewport,
								this.blurContentViewport,
								this.targets.blurPing,
							);
							sourceTarget = this.targets.ping;
						}
						continue;
					}
					if (passIndex === passes.length - 1) {
						gl.enable(gl.BLEND);
						gl.blendEquation(gl.FUNC_ADD);
						gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
						this.draw(
							sourceTarget.texture,
							this.targets.layer,
							pass,
							opacity,
							null,
							contentViewport,
						);
						entryComposited = true;
						continue;
					}
					const destinationTarget = sourceTarget === this.targets.ping
						? this.targets.pong
						: this.targets.ping;
					this.clearTarget(destinationTarget);
					this.draw(sourceTarget.texture, destinationTarget, pass, 1, null, contentViewport);
					sourceTarget = destinationTarget;
				}
				if (!entryComposited) {
					gl.enable(gl.BLEND);
					gl.blendEquation(gl.FUNC_ADD);
					gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
					this.draw(sourceTarget.texture, this.targets.layer, COPY_PASS, opacity);
				}
				renderedEntries += 1;
				renderedLayerEntries += 1;
			}
			if (!renderedLayerEntries) continue;
			gl.enable(gl.BLEND);
			gl.blendEquation(gl.FUNC_ADD);
			gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			this.draw(this.targets.layer.texture, this.targets.composition, COPY_PASS);
		}

		gl.disable(gl.BLEND);
		this.clearTarget(null, 0, 0, 0, 1);
		this.draw(
			this.targets.composition.texture,
			null,
			FINAL_YUV420_PASS,
			1,
			referenceViewport,
			null,
			referenceViewport,
			this.targets.composition,
			this.finalEffectResolution,
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.pruneUnusedVideoTextures();
		return effectRenderFailed ? -1 : renderedEntries;
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
		this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
		for (const target of Object.values(this.targets || {})) deleteRenderTarget(this.gl, target);
		for (const record of this.videoTextures?.values() || []) this.gl.deleteTexture(record.texture);
		this.videoTextures.clear();
		this.gl.deleteBuffer(this.positionBuffer);
		for (const program of this.programs) this.gl.deleteProgram(program);
	}
}

export function createVideoPreviewCompositor(canvas, options) {
	return new VideoPreviewCompositor(canvas, options);
}
