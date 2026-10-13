/* SPDX-License-Identifier: AGPL-3.0-only */
import { requireMotionHostWebGl } from './helpers/motionscaper-host-webgl.ts';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { motionCompositionLinkFrameToRgba8 } from '../../src/common/editor/motion-link-picture-source.ts';
import { createMotionSurface } from '../../src/common/editor/motion-surface.ts';

test('linked sRGB straight-alpha carrier reaches WebGL as exact RGBA8 without a canvas readback', async ({ page }: { page: Page }) => {
	await requireMotionHostWebGl(page);
	const surface = createMotionSurface(4, 1); surface.pixels.set([0.125, 0.25, 0.5, 0.5, 0.0005, 0.001, 0.002, 0.004, 0, 0, 0, 0, 0.18, 0.01, 1, 1]);
	const picture = motionCompositionLinkFrameToRgba8({ identity: { projectId: 'linked', compositionId: 'main', revisionDigest: 'a'.repeat(64) }, time: { num: 1, den: 30 }, surface: { ...surface, consumedOperationIds: [] } });
	const expected = [...picture.pixels];
	const actual = await page.evaluate((pixels) => {
		const carrier = new ImageData(new Uint8ClampedArray(pixels), 4, 1, { colorSpace: 'srgb' });
		const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 1;
		const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false }); if (!gl) throw new Error('WebGL2 is required for the linked picture boundary qualification.');
		const texture = gl.createTexture(), framebuffer = gl.createFramebuffer(); if (!texture || !framebuffer) throw new Error('WebGL resources are missing.');
		try {
			gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, carrier);
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
			if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Linked picture framebuffer is incomplete.');
			const first = new Uint8Array(16); gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, first);
			carrier.data.set([5, 7, 9, 11], 0); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, carrier);
			const second = new Uint8Array(16); gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, second);
			if (gl.getError() !== gl.NO_ERROR) throw new Error('Linked picture upload or readback failed.');
			return { first: [...first], second: [...second] };
		} finally { gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
	}, expected);
	expect(actual.first).toEqual(expected); expect(actual.second).toEqual([5, 7, 9, 11, ...expected.slice(4)]);
});
