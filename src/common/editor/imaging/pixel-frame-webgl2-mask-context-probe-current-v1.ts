/* SPDX-License-Identifier: AGPL-3.0-only */
import { withMaskNativeCurrentV1 } from './pixel-frame-webgl2-mask-context-native-current-v1.ts';
import type { MaskNativeCurrentV1 } from './pixel-frame-webgl2-mask-context-native-current-v1.ts';
import type { MaskProgramsCurrentV1 } from './pixel-frame-webgl2-mask-context-programs-current-v1.ts';

export async function probeMaskContextCurrentV1(parent: Readonly<MaskNativeCurrentV1>, programs: Readonly<MaskProgramsCurrentV1>): Promise<void> {
	const gl = parent.gl;
	if (!gl.getExtension('EXT_color_buffer_float') || Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) < 4) parent.unavailable('mask-capability-unavailable');
	await withMaskNativeCurrentV1(gl, parent.check, parent.unavailable, async owner => {
		const bytes = new Uint8Array([0, 1, 255]), uints = owner.uints(3); uints.set([0, 1, 4_243_455]);
		const rgba = owner.floats(4), result = owner.floats(4), words = owner.uints(12); rgba.set([-0, 2, -1, -0]);
		const image = owner.texture('float', 1, 1, rgba), candidate = owner.texture('float', 1, 1, rgba), destination = owner.texture('float', 1, 1);
		const dummy = owner.texture('byte', 1, 1); owner.clear(dummy);
		const copy = Object.freeze({ kind: 13 as const, params0: [0, 0, 0, 0] as const, params1: [0, 0, 0, 0] as const,
			radius: 0, pathEdges: 0, evenOdd: false, inputName: undefined, supported: true });
		try {
			for (const format of ['byte', 'uint'] as const) {
				const input = owner.texture(format, 3, 1, format === 'byte' ? bytes : uints), output = owner.texture(format, 3, 1);
				programs.node(output, copy, image.texture, input.texture, dummy.texture, dummy.texture);
				await owner.wait(); owner.attach(output); gl.readPixels(0, 0, 3, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, words); owner.check();
				if ([0, 1, format === 'byte' ? 255 : 4_243_455].some((value, index) => words[index * 4] !== value)) owner.unavailable('mask-integer-copy-unavailable');
				gl.clearBufferuiv(gl.COLOR, 0, Uint32Array.of(127, 0, 0, 0)); gl.readPixels(0, 0, 3, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, words); owner.check();
				if ([0, 4, 8].some(index => words[index] !== 127)) owner.unavailable('mask-integer-clear-unavailable'); words.fill(0);
			}
			const endpoint = owner.texture('byte', 1, 1), endpoints = new Uint8Array(1);
			try {
				for (const amount of [0, 255]) {
					endpoints[0] = amount; gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, endpoint.texture);
					gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, endpoints);
					programs.blend(destination, image.texture, candidate.texture, endpoint.texture, { kind: 'generic' });
					await owner.wait(); owner.attach(destination); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, result); owner.check();
					if ([0, 1, 2, 3].some(index => !Object.is(result[index], rgba[index]))) owner.unavailable('mask-mixed-sampler-unavailable');
				}
			} finally { endpoints.fill(0); }
		} finally { bytes.fill(0); }
	});
}
