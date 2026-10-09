/* SPDX-License-Identifier: AGPL-3.0-only */

interface Resource { readonly texture: WebGLTexture; pass: unknown; owner: unknown; configured: boolean }
const RESOURCES = new WeakMap<WebGL2RenderingContext, Resource>();
const UNSET = Symbol('unuploaded video effect lookup');
const ACTIVE = new WeakSet<WebGL2RenderingContext>();

/** Private owners provide an authenticated1KiB copy. One native texture and synchronous lease are shared by all separable processes. */
export function bindVideoEffectLookupGpu(gl: WebGL2RenderingContext, location: WebGLUniformLocation | null, pass: unknown,
	copy: (value: unknown) => Uint8Array<ArrayBuffer>): void {
	if (ACTIVE.has(gl)) throw new Error('Video effect transfer is already active.');
	ACTIVE.add(gl); let bytes: Uint8Array<ArrayBuffer> | null = null;
	try {
		let resource = RESOURCES.get(gl);
		bytes = resource && resource.pass === pass && resource.owner === copy ? null : copy(pass);
		if (location === null) throw new Error('Video effect transfer sampler is unavailable.');
		if (!resource) {
			const texture = gl.createTexture(); if (!texture) throw new Error('Video effect transfer allocation failed.');
			resource = { texture, pass: UNSET, owner: UNSET, configured: false }; RESOURCES.set(gl, resource);
		}
		gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, resource.texture);
		if (!resource.configured) {
			for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
			for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
			resource.configured = true;
		}
		if (bytes) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
			resource.pass = pass; resource.owner = copy; }
		gl.uniform1i(location, 2);
	} finally { bytes?.fill(0); try { gl.activeTexture(gl.TEXTURE0); } finally { ACTIVE.delete(gl); } }
}

export function disposeVideoEffectLookupGpu(gl: WebGL2RenderingContext): void {
	if (ACTIVE.has(gl)) throw new Error('Video effect transfer is already active.');
	const resource = RESOURCES.get(gl); if (!resource) return;
	ACTIVE.add(gl);
	try { gl.deleteTexture(resource.texture); RESOURCES.delete(gl); } finally { ACTIVE.delete(gl); }
}
