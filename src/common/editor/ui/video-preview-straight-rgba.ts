/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderRgbaFrameV13 } from '../unified-exact-render-finishing-consumers-v13.ts';
import { aggregateScapeErrors } from '../scape-abort.ts';

const CHECK_ABORT = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Frame's admitted, privately copied bytes enter the maintained effect target,
 * without passing through canvas image upload or premultiplied composition. */
export async function renderVideoPreviewStraightRgba(
	frame: UnifiedExactRenderRgbaFrameV13, effects: readonly unknown[], signal: AbortSignal,
): Promise<UnifiedExactRenderRgbaFrameV13> {
	Reflect.apply(CHECK_ABORT, signal, []);
	if (!globalThis.document?.createElement) throw new Error('Selected finishing browser effects are unavailable outside a WebGL2 document.');
	const [backend, entry] = await Promise.all([
		import('./video-preview-compositor.js'), import('./video-preview-entry-effects.js'),
	]);
	Reflect.apply(CHECK_ABORT, signal, []);
	const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
	const compositor = backend.createVideoPreviewCompositor(canvas), gl = compositor.gl as WebGL2RenderingContext;
	let texture: WebGLTexture | null = null;
	let pixels: Uint8Array<ArrayBuffer> | null = null, failed = false, failure: unknown;
	try {
		compositor.resizeToDisplaySize({ outputWidth: frame.width, outputHeight: frame.height });
		texture = gl.createTexture(); if (!texture) throw new Error('Straight effect source texture allocation failed.');
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
		for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
		for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		// Typed uploads ignore UNPACK_FLIP_Y_WEBGL. Match the maintained DOM
		// texture orientation without canvas alpha conversion or a second frame.
		flipRows(frame.pixels, frame.width, frame.height);
		try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frame.width, frame.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.pixels); }
		finally { flipRows(frame.pixels, frame.width, frame.height); }
		const passes = compositor.passesForEffects(effects, { x: 1, y: 1 });
		const target = entry.applyVideoPreviewEntryEffects(compositor, texture, passes,
			{ x: 0, y: 0, width: frame.width, height: frame.height }, undefined, 'straight-exact-effect');
		pixels = new Uint8Array(frame.pixels.byteLength);
		gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.finish();
		gl.readPixels(0, 0, frame.width, frame.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		if (gl.getError() !== gl.NO_ERROR) throw new Error('Straight effect evaluation failed in WebGL2.');
		flipRows(pixels, frame.width, frame.height);
		Reflect.apply(CHECK_ABORT, signal, []);
	} catch (error) { failed = true; failure = error; }
	finally {
		const cleanup: unknown[] = [];
		for (const release of [() => { if (texture) gl.deleteTexture(texture); }, () => { compositor.dispose(); }, () => { canvas.remove(); }]) {
			try { release(); } catch (error) { cleanup.push(error); }
		}
		if (cleanup.length) {
			failure = failed ? aggregateScapeErrors(failure, cleanup, 'Straight effect cleanup failed.', {
				primaryIsAbort: Reflect.apply(ABORTED, signal, []) === true && Reflect.apply(REASON, signal, []) === failure,
			}) : cleanup.length === 1 ? cleanup[0] : new AggregateError(cleanup, 'Straight effect cleanup failed.');
			failed = true;
		}
		if (failed) pixels?.fill(0);
	}
	if (failed) throw failure;
	try { Reflect.apply(CHECK_ABORT, signal, []); } catch (error) { pixels?.fill(0); throw error; }
	if (!pixels) throw new Error('Straight effect readback was not produced.');
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

function flipRows(pixels: Uint8Array, width: number, height: number): void {
	if (height < 2) return;
	const rowBytes = width * 4, row = new Uint8Array(rowBytes);
	try {
		for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
			const first = top * rowBytes, last = bottom * rowBytes;
			row.set(pixels.subarray(first, first + rowBytes));
			pixels.copyWithin(first, last, last + rowBytes); pixels.set(row, last);
		}
	} finally { row.fill(0); }
}
