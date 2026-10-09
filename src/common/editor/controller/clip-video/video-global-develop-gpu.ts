/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyGlobalDevelopPreviewLookupV1 } from '../../video-global-develop-v1.ts';

interface Resource { readonly texture: WebGLTexture; pass: unknown; configured: boolean }
const RESOURCES = new WeakMap<WebGL2RenderingContext, Resource>();
const UNSET = Symbol('unuploaded global develop pass');
const ACTIVE = new WeakSet<WebGL2RenderingContext>();

/** One 256x1 RGBA8 texture per injected context, reused serially across authored passes. */
export function bindVideoGlobalDevelopGpu(gl: WebGL2RenderingContext, location: WebGLUniformLocation | null, pass: unknown): void {
	if (ACTIVE.has(gl)) throw new Error('Global develop transfer is already active.');
	let resource = RESOURCES.get(gl);
	const bytes = resource?.pass === pass ? null : copyGlobalDevelopPreviewLookupV1(pass);
	ACTIVE.add(gl);
	try {
		if (location === null) throw new Error('Global develop transfer sampler is unavailable.');
		if (!resource) {
			const texture = gl.createTexture(); if (!texture) throw new Error('Global develop transfer allocation failed.');
			resource = { texture, pass: UNSET, configured: false }; RESOURCES.set(gl, resource);
		}
		gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, resource.texture);
		if (!resource.configured) {
			for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
			for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
			resource.configured = true;
		}
		if (bytes) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes); resource.pass = pass;
		}
		gl.uniform1i(location, 2);
	} finally { bytes?.fill(0); try { gl.activeTexture(gl.TEXTURE0); } finally { ACTIVE.delete(gl); } }
}

/** Disposal and context restoration both retire the same owned resource. */
export function disposeVideoGlobalDevelopGpu(gl: WebGL2RenderingContext): void {
	if (ACTIVE.has(gl)) throw new Error('Global develop transfer is already active.');
	const resource = RESOURCES.get(gl); if (!resource) return;
	ACTIVE.add(gl);
	try { gl.deleteTexture(resource.texture); RESOURCES.delete(gl); } finally { ACTIVE.delete(gl); }
}
