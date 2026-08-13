/* SPDX-License-Identifier: AGPL-3.0-only */

export function createVideoPreviewRenderTarget(gl, width, height) {
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

export function deleteVideoPreviewRenderTarget(gl, target) {
	if (!target) return;
	gl.deleteFramebuffer(target.framebuffer);
	gl.deleteTexture(target.texture);
}

export function createVideoPreviewRenderTargets(gl, width, height, blurScale) {
	const blurWidth = Math.max(1, Math.round(width * blurScale));
	const blurHeight = Math.max(1, Math.round(height * blurScale));
	return {
		ping: createVideoPreviewRenderTarget(gl, width, height),
		pong: createVideoPreviewRenderTarget(gl, width, height),
		layer: createVideoPreviewRenderTarget(gl, width, height),
		composition: createVideoPreviewRenderTarget(gl, width, height),
		compositionSwap: createVideoPreviewRenderTarget(gl, width, height),
		anchor: createVideoPreviewRenderTarget(gl, width, height),
		blurPing: createVideoPreviewRenderTarget(gl, blurWidth, blurHeight),
		blurPong: createVideoPreviewRenderTarget(gl, blurWidth, blurHeight),
	};
}

export function deleteVideoPreviewRenderTargets(gl, targets) {
	for (const target of Object.values(targets || {})) deleteVideoPreviewRenderTarget(gl, target);
}
