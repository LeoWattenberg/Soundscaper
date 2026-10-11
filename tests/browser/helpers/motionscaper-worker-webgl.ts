/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, type Page } from '@playwright/test';

interface WorkerFloatWitness { readonly available: boolean; readonly reason: string }

/** Independently witness a real worker's float target; host WebGL support is not worker support. */
export async function expectMotionWorkerBackend(page: Page, actual: string | undefined): Promise<void> {
	const witness = await page.evaluate(async (): Promise<WorkerFloatWitness> => {
		const probe = (): void => {
			let gl: WebGL2RenderingContext | null = null;
			try {
				if (typeof OffscreenCanvas !== 'function') { postMessage({ available: false, reason: 'OffscreenCanvas unavailable in worker' }); return; }
				gl = new OffscreenCanvas(1, 1).getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
				if (!gl) { postMessage({ available: false, reason: 'WebGL2 unavailable in worker' }); return; }
				if (!gl.getExtension('EXT_color_buffer_float')) { postMessage({ available: false, reason: 'Float color targets unavailable in worker' }); return; }
				const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
				if (!texture || !framebuffer) throw new Error('Worker float witness could not allocate its one-pixel target.');
				try {
					gl.bindTexture(gl.TEXTURE_2D, texture); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
					gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
					if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Worker RGBA32F framebuffer is incomplete.');
					const sample = new Float32Array([0.125, 0.25, 0.5, 1]), pixels = new Float32Array(4);
					gl.clearBufferfv(gl.COLOR, 0, sample); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixels);
					if (gl.getError() !== gl.NO_ERROR || pixels.some((value, index) => value !== sample[index])) throw new Error('Worker RGBA32F readback failed.');
					postMessage({ available: true, reason: 'Worker WebGL2 RGBA32F target and exact float readback available' });
				} finally { gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); }
			} catch (error) { postMessage({ error: String(error) }); }
			finally { gl?.getExtension('WEBGL_lose_context')?.loseContext(); }
		};
		const url = URL.createObjectURL(new Blob([`(${probe.toString()})();`], { type: 'text/javascript' }));
		const worker = new Worker(url, { type: 'module', name: 'motion-independent-float-witness' });
		try {
			return await new Promise<WorkerFloatWitness>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Worker float witness exceeded its five-second deadline.')), 5000);
				worker.addEventListener('error', event => { clearTimeout(timeout); reject(new Error(event.message)); }, { once: true });
				worker.addEventListener('message', (event: MessageEvent<unknown>) => {
					clearTimeout(timeout); const value = event.data;
					if (!value || typeof value !== 'object' || !('available' in value) || typeof value.available !== 'boolean' || !('reason' in value) || typeof value.reason !== 'string') {
						reject(new Error(`Invalid worker float witness: ${JSON.stringify(value)}`)); return;
					}
					resolve({ available: value.available, reason: value.reason });
				}, { once: true });
			});
		} finally { worker.terminate(); URL.revokeObjectURL(url); }
	});
	expect(actual, witness.reason).toBe(witness.available ? 'worker-webgl2' : 'worker-cpu');
}
