/* SPDX-License-Identifier: AGPL-3.0-only */
import { test, type Page } from '@playwright/test';

interface HostRequirements { readonly floatTarget?: boolean; readonly contextLoss?: boolean }
interface HostWitness { readonly available: boolean; readonly reason: string }
interface HostCanvas { getContext(id: 'webgl2', attributes: WebGLContextAttributes): WebGL2RenderingContext | null }

/** Absence is a host qualification limit; an admitted target that fails remains an error. */
export function probeMotionHostWebGl(requirements: HostRequirements, createCanvas: () => HostCanvas = () => document.createElement('canvas')): HostWitness {
	const gl = createCanvas().getContext('webgl2', { alpha: true, premultipliedAlpha: Boolean(requirements.floatTarget), antialias: false,
		depth: false, stencil: false, preserveDrawingBuffer: false });
	if (!gl) return { available: false, reason: 'Host WebGL2 is unavailable' };
	try {
		if (requirements.floatTarget && !gl.getExtension('EXT_color_buffer_float')) return { available: false, reason: 'Host EXT_color_buffer_float is unavailable' };
		if (requirements.contextLoss && !gl.getExtension('WEBGL_lose_context')) return { available: false, reason: 'Host WEBGL_lose_context is unavailable' };
		const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
		try {
			if (!texture || !framebuffer) throw new Error('Host WebGL2 witness could not allocate its one-pixel target.');
			gl.bindTexture(gl.TEXTURE_2D, texture); gl.texStorage2D(gl.TEXTURE_2D, 1, requirements.floatTarget ? gl.RGBA32F : gl.RGBA8, 1, 1);
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
			if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Host WebGL2 witness framebuffer is incomplete.');
			const expected = requirements.floatTarget ? new Float32Array([.125, .25, .5, 1]) : new Uint8Array([32, 64, 128, 255]);
			const clear = requirements.floatTarget ? new Float32Array(expected) : Float32Array.from(expected, value => value / 255);
			const pixels = requirements.floatTarget ? new Float32Array(4) : new Uint8Array(4);
			gl.clearBufferfv(gl.COLOR, 0, clear); gl.readPixels(0, 0, 1, 1, gl.RGBA, requirements.floatTarget ? gl.FLOAT : gl.UNSIGNED_BYTE, pixels);
			if (gl.getError() !== gl.NO_ERROR || pixels.some((value, index) => value !== expected[index])) throw new Error('Host WebGL2 witness exact readback failed.');
			return { available: true, reason: `Host WebGL2 ${requirements.floatTarget ? 'RGBA32F' : 'RGBA8'} target and exact readback available` };
		} finally { if (framebuffer) gl.deleteFramebuffer(framebuffer); if (texture) gl.deleteTexture(texture); }
	} finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}

/** Preserve the observed reason in reports, without treating a CPU fallback as GPU proof. */
export async function requireMotionHostWebGl(page: Page, requirements: HostRequirements = {}): Promise<void> {
	const witness = await page.evaluate(probeMotionHostWebGl, requirements);
	test.info().annotations.push({ type: 'host-gpu-qualification', description: witness.reason });
	test.skip(!witness.available, `${witness.reason}; direct GPU qualification is unavailable on this host.`);
}
