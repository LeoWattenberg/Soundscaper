import {
	BLUR_KERNEL,
	EFFECT_CODES,
	EFFECT_PROGRAM_COUNT,
	GAUSSIAN_BLUR_RENDER_SCALE,
	createProgram,
	finiteNumber,
	programLocations,
	videoEffectPasses,
} from './video-preview-effects.js';

export {
	VIDEO_PREVIEW_MAX_GAUSSIAN_BLUR_KERNEL_SIGMA,
	VIDEO_PREVIEW_PIXELATE_GRID_SIZE,
	videoEffectPasses,
} from './video-preview-effects.js';

const MAX_RENDER_DIMENSION = 4096;
const COPY_PASS = Object.freeze({});
const RECT_COPY_PASS = Object.freeze({ code: 8 });
const FINAL_YUV420_PASS = Object.freeze({ code: 7 });
const EMPTY_EFFECTS = Object.freeze([]);
const ZERO_VECTOR_2 = Object.freeze([0, 0]);
const ZERO_VECTOR_4 = Object.freeze([0, 0, 0, 0]);

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
			gl.uniform1i(locations.auxTexture, 1);
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
			anchor: createRenderTarget(this.gl, width, height),
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
		auxiliaryTexture = null,
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
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, auxiliaryTexture || texture);
		gl.activeTexture(gl.TEXTURE0);
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
					if (pass.preserveSource) {
						this.clearTarget(this.targets.anchor);
						this.draw(
							sourceTarget.texture,
							this.targets.anchor,
							RECT_COPY_PASS,
							1,
							null,
							contentViewport,
							contentViewport,
							sourceTarget,
						);
					}
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
							null,
							null,
							null,
							pass.auxiliary ? this.targets.anchor.texture : null,
						);
						entryComposited = true;
						continue;
					}
					const destinationTarget = sourceTarget === this.targets.ping
						? this.targets.pong
						: this.targets.ping;
					this.clearTarget(destinationTarget);
					this.draw(
						sourceTarget.texture,
						destinationTarget,
						pass,
						1,
						null,
						contentViewport,
						null,
						null,
						null,
						pass.auxiliary ? this.targets.anchor.texture : null,
					);
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
