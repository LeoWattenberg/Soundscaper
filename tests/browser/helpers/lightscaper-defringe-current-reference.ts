/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../src/common/editor/closed-domain-value.ts';
import { createVideoEffect } from '../../../src/common/editor/video-effects.js';
import { VideoPreviewCompositor } from '../../../src/common/editor/ui/video-preview-compositor.js';
import { applyVideoPreviewEntryEffects } from '../../../src/common/editor/ui/video-preview-entry-effects.js';

export { readRepairFramePhotoCustodyNativeV1 as readDefringePhotoCustodyCurrentV1 } from './lightscaper-repair-frame-current-reference.ts';

interface Pass { readonly code?: number; }
interface Compositor {
	readonly gl: WebGL2RenderingContext; readonly programs: readonly WebGLProgram[];
	resizeToDisplaySize(options: Readonly<{ outputWidth: number; outputHeight: number }>): void;
	passesForEffects(effects: readonly unknown[], scale: Readonly<{ x: number; y: number }>): readonly Pass[];
	dispose(): void;
}

/** Actual compositor/entry texture and one receiver-preserving native readback.
 * The observer never replaces a decoder, shader, effect or renderer. */
export function qualifyDefringeNativeCurrentV1(value: unknown) {
	const input = record(value, 'native defringe request', ['source', 'width', 'height', 'purple', 'green', 'edgeThreshold', 'enabled']);
	const values = readClosedDomainArray(field(input, 'source', 'native defringe request'), 'native defringe pixels', 4, 16_384);
	if (values.some(channel => typeof channel !== 'number' || !Number.isInteger(channel) || channel < 0 || channel > 255)) throw new TypeError('Native defringe requires byte samples.');
	const width = field(input, 'width', 'native defringe request'), height = field(input, 'height', 'native defringe request');
	if (typeof width !== 'number' || typeof height !== 'number' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
		|| width < 1 || height < 1 || width > 64 || height > 64 || values.length !== width * height * 4) throw new RangeError('Native defringe fixture dimensions differ.');
	const effect = createVideoEffect('defringe-v1', { id: 'native-defringe', params: { purple: field(input, 'purple', 'native defringe request'),
		green: field(input, 'green', 'native defringe request'), edgeThreshold: field(input, 'edgeThreshold', 'native defringe request') }, enabled: field(input, 'enabled', 'native defringe request') });
	const source = Uint8Array.from(values as number[]), before = [...source], upload = source.slice(), canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
	const nativeRead = Object.getOwnPropertyDescriptor(WebGL2RenderingContext.prototype, 'readPixels');
	if (!nativeRead || typeof nativeRead.value !== 'function') throw new Error('Native defringe readback is unavailable.');
	const read = nativeRead.value as (...args: unknown[]) => unknown;
	let compositor: Compositor | undefined, texture: WebGLTexture | null = null, output: Uint8Array<ArrayBuffer> | undefined;
	let reads = 0, nativeReceiver = true, result: { pixels: number[]; source: number[]; before: number[]; passCodes: (number | undefined)[];
		programCount: number; defringeProgramLinked: boolean; nativeWebgl2: boolean; nativeReadbacks: number; glError: number } | undefined;
	let failed = false, failure: unknown;
	try {
		compositor = new VideoPreviewCompositor(canvas) as unknown as Compositor; const gl = compositor.gl;
		compositor.resizeToDisplaySize({ outputWidth: width, outputHeight: height });
		const program = compositor.programs[36]; if (!program) throw new Error('The native defringe program is missing.');
		const linked = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
		texture = gl.createTexture(); if (!texture) throw new Error('Native defringe texture allocation failed.'); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
		for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
		for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		flipRows(upload, width, height); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, upload);
		const passes = compositor.passesForEffects([effect], { x: 1, y: 1 });
		const target = applyVideoPreviewEntryEffects(compositor, texture, passes, { x: 0, y: 0, width, height }, undefined, 'native-defringe') as { readonly framebuffer: WebGLFramebuffer };
		output = new Uint8Array(source.length);
		Object.defineProperty(WebGL2RenderingContext.prototype, 'readPixels', { ...nativeRead, value: function(this: WebGL2RenderingContext, ...args: unknown[]) {
			reads++; nativeReceiver &&= this === gl && this instanceof WebGL2RenderingContext; return Reflect.apply(read, this, args);
		} });
		gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.finish(); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, output); flipRows(output, width, height);
		result = { pixels: [...output], source: [...source], before, passCodes: passes.map(pass => pass.code), programCount: compositor.programs.length,
			defringeProgramLinked: linked, nativeWebgl2: nativeReceiver && gl instanceof WebGL2RenderingContext, nativeReadbacks: reads, glError: gl.getError() };
	} catch (error) { failed = true; failure = error; }
	const cleanup: unknown[] = [];
	for (const release of [() => { Object.defineProperty(WebGL2RenderingContext.prototype, 'readPixels', nativeRead); }, () => { output?.fill(0); },
		() => { upload.fill(0); }, () => { source.fill(0); }, () => { if (texture && compositor) compositor.gl.deleteTexture(texture); },
		() => { compositor?.dispose(); }, () => { compositor?.gl.getExtension('WEBGL_lose_context')?.loseContext(); },
		() => { canvas.width = 0; canvas.height = 0; canvas.remove(); }]) try { release(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup, 'Native defringe qualification or retirement failed.', failed ? { cause: failure } : undefined);
	if (failed) throw failure; if (!result) throw new Error('Native defringe qualification did not produce a result.');
	return { ...result, ownedBuffersRetired: source.every(channel => channel === 0) && upload.every(channel => channel === 0) && output?.every(channel => channel === 0) === true };
}

function flipRows(pixels: Uint8Array<ArrayBuffer>, width: number, height: number): void {
	const row = new Uint8Array(width * 4);
	try { for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
		const first = top * row.length, last = bottom * row.length; row.set(pixels.subarray(first, first + row.length));
		pixels.copyWithin(first, last, last + row.length); pixels.set(row, last);
	} } finally { row.fill(0); }
}
