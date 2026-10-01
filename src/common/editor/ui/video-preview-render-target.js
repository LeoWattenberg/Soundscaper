/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoPreviewTargetPool,
	VIDEO_PREVIEW_TARGET_NAMES,
} from '../controller/clip-video/video-preview-target-pool.ts';

const TARGET_POOLS = new WeakMap();

export function createVideoPreviewRenderTarget(gl, width, height) {
	let texture = null;
	let framebuffer = null;
	try {
		texture = gl.createTexture();
		framebuffer = gl.createFramebuffer();
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
			throw new Error('The WebGL video render target is incomplete.');
		}
		return { framebuffer, height, texture, width };
	} catch (error) {
		if (framebuffer) gl.deleteFramebuffer(framebuffer);
		if (texture) gl.deleteTexture(texture);
		throw error;
	}
}

export function deleteVideoPreviewRenderTarget(gl, target) {
	if (!target) return;
	gl.deleteFramebuffer(target.framebuffer);
	gl.deleteTexture(target.texture);
}

export function createVideoPreviewRenderTargets(gl, width, height, blurScale) {
	const pool = createVideoPreviewTargetPool({
		width, height, blurScale,
		allocate: (targetWidth, targetHeight) => createVideoPreviewRenderTarget(gl, targetWidth, targetHeight),
		release: (target) => deleteVideoPreviewRenderTarget(gl, target),
	});
	const targets = {};
	for (const name of VIDEO_PREVIEW_TARGET_NAMES) {
		Object.defineProperty(targets, name, { enumerable: true, get: () => pool.get(name) });
	}
	TARGET_POOLS.set(targets, pool);
	return targets;
}

export function allocatedVideoPreviewRenderTargets(targets) {
	return TARGET_POOLS.get(targets)?.allocated() || Object.values(targets || {});
}

export function deleteVideoPreviewRenderTargets(gl, targets) {
	const pool = TARGET_POOLS.get(targets);
	if (pool) {
		pool.dispose();
		return;
	}
	for (const target of Object.values(targets || {})) deleteVideoPreviewRenderTarget(gl, target);
}

/** Validate the replacement composition target before releasing the live target set. */
export function replaceVideoPreviewRenderTargets(gl, canvas, previousTargets, width, height, blurScale) {
	const nextTargets = createVideoPreviewRenderTargets(gl, width, height, blurScale);
	const previousWidth = canvas.width;
	const previousHeight = canvas.height;
	try {
		void nextTargets.composition;
		canvas.width = width;
		canvas.height = height;
	} catch (error) {
		canvas.width = previousWidth;
		canvas.height = previousHeight;
		deleteVideoPreviewRenderTargets(gl, nextTargets);
		throw error;
	}
	deleteVideoPreviewRenderTargets(gl, previousTargets);
	return nextTargets;
}
