/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoEffect } from '../../src/common/editor/video-effects.js';
import { videoEffectPasses } from '../../src/common/editor/ui/video-preview-effects.js';
import { VideoPreviewCompositor } from '../../src/common/editor/ui/video-preview-compositor.js';
import { withGeometryPixelFrameV1 } from '../../src/common/editor/imaging/pixel-frame-geometry-v1.ts';
import { imageGeometryForVideoEffectV1 } from '../../src/common/editor/video-image-geometry-v1.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../../src/framescaper/editor-video-exact-browser-effects-finishing.ts';

function pixels(values: number[]) { return new Uint8Array(values.flatMap(value => value === 0 ? [0, 0, 0, 0] : [value, value + 10, value + 20, 255])); }
const CASES = [
	{ width: 4, height: 2, source: pixels([1, 2, 3, 4, 5, 6, 7, 8]), params: { cropX: 0.25, cropWidth: 0.5 } },
	{ width: 2, height: 2, source: pixels([1, 2, 3, 4]), params: { rotationDegrees: 90, flipHorizontal: 1 } },
	{ width: 2, height: 2, source: new Uint8Array([0, 10, 20, 255, 100, 110, 120, 255, 50, 60, 70, 255, 150, 160, 170, 255]),
		params: { perspective: 1, bottomRightX: 0.75, bottomLeftX: 0.25 } },
	{ width: 4, height: 1, source: new Uint8Array([255, 0, 0, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]), params: { cropX: 0.125, cropWidth: 0.5 } },
] as const;

/** Tiny actual native frames only: the production Frame adapter and maintained GL pass both consume the owning recipe. */
export async function qualifyImageGeometryNativeV1(index: number) {
	if (!Number.isSafeInteger(index) || index < 0 || index >= CASES.length) throw new RangeError('Unknown native geometry case.');
	const fixture = CASES[index]!, source = fixture.source.slice(), original = Array.from(source), signal = new AbortController().signal;
	const effect = createVideoEffect('develop-geometry-v1', { id: 'native-geometry', params: fixture.params });
	const frame = await applyVideoExactBrowserEffectsFinishing({ width: fixture.width, height: fixture.height, pixels: source }, [effect], signal);
	const natural = await withGeometryPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: fixture.width, height: fixture.height,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source }, geometry: imageGeometryForVideoEffectV1(effect, fixture.width, fixture.height), signal },
		output => ({ width: output.descriptor.width, height: output.descriptor.height, pixels: Array.from(output.pixels) }),
		{ limits: { maximumSidePixels: 16, maximumPixels: 256, maximumBytes: 1024 } });
	const canvas = document.createElement('canvas'); canvas.width = fixture.width; canvas.height = fixture.height;
	const compositor = new VideoPreviewCompositor(canvas), gl = compositor.gl, texture = gl.createTexture();
	if (!texture) { compositor.dispose(); throw new Error('Native geometry texture unavailable.'); }
	try {
		const upload = flipRows(source, fixture.width, fixture.height);
		gl.disable(gl.BLEND); gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fixture.width, fixture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, upload);
		gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
		const pass = videoEffectPasses(effect)[0]; if (!pass) throw new Error('Authored native geometry pass omitted.');
		compositor.draw(texture, null, pass);
		const readback = new Uint8Array(source.length); gl.readPixels(0, 0, fixture.width, fixture.height, gl.RGBA, gl.UNSIGNED_BYTE, readback);
		const error = gl.getError(); if (error !== gl.NO_ERROR) throw new Error(`Native geometry GL error ${String(error)}.`);
		return { natural, frame: { width: frame.width, height: frame.height, pixels: Array.from(frame.pixels) },
			preview: { width: canvas.width, height: canvas.height, pixels: Array.from(flipRows(readback, fixture.width, fixture.height)) },
			sourceUnchanged: original.every((value, offset) => value === source[offset]) };
	} finally { gl.deleteTexture(texture); compositor.dispose(); frame.pixels.fill(0); }
}

function flipRows(source: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(source.length), rowBytes = width * 4;
	for (let row = 0; row < height; row++) output.set(source.subarray(row * rowBytes, (row + 1) * rowBytes), (height - row - 1) * rowBytes);
	return output;
}
