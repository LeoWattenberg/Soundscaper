/* SPDX-License-Identifier: AGPL-3.0-only */
import { PIXEL_FRAME_WEBGL2_MASK_NODE_FRAGMENT_CURRENT_V1 as NODE } from './pixel-frame-webgl2-mask-node-glsl-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_MASK_FEATHER_HORIZONTAL_CURRENT_V1 as HORIZONTAL, PIXEL_FRAME_WEBGL2_MASK_FEATHER_VERTICAL_CURRENT_V1 as VERTICAL } from './pixel-frame-webgl2-mask-feather-glsl-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_MASK_PATH_INITIAL_CURRENT_V1 as INITIAL, PIXEL_FRAME_WEBGL2_MASK_PATH_SUM_CURRENT_V1 as SUM, PIXEL_FRAME_WEBGL2_MASK_PATH_RESOLVE_CURRENT_V1 as RESOLVE } from './pixel-frame-webgl2-mask-path-glsl-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_MASK_BLEND_FRAGMENT_CURRENT_V1 as BLEND, preparePixelFrameWebGl2MaskBlendUniformsCurrentV1 } from './pixel-frame-webgl2-mask-blend-glsl-current-v1.ts';
import type { PixelFrameWebGl2MaskNodeUniformsCurrentV1 } from './pixel-frame-webgl2-mask-node-current-v1.ts';
import type { MaskNativeCurrentV1, MaskTextureCurrentV1 } from './pixel-frame-webgl2-mask-context-native-current-v1.ts';

export function createMaskProgramsCurrentV1(owner: Readonly<MaskNativeCurrentV1>) {
	const gl = owner.gl, node = owner.program(NODE), horizontal = owner.program(HORIZONTAL), vertical = owner.program(VERTICAL);
	const initial = owner.program(INITIAL), sum = owner.program(SUM), resolve = owner.program(RESOLVE), blend = owner.program(BLEND);
	const location = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);
	const sample = (program: WebGLProgram, name: string, unit: number, texture: WebGLTexture) => {
		gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(location(program, name), unit);
	};
	const extent = (program: WebGLProgram, width: number, height: number) => gl.uniform2i(location(program, 'uExtent'), width, height);
	return Object.freeze({
		node(target: MaskTextureCurrentV1, uniforms: Readonly<PixelFrameWebGl2MaskNodeUniformsCurrentV1>, incoming: WebGLTexture,
			a: WebGLTexture, b: WebGLTexture, brush: WebGLTexture, brushWidth = 1, brushHeight = 1) {
			if (uniforms.kind >= 14) throw new TypeError('Nonlocal graph node requires its own program.');
			owner.draw(node, target, () => {
				sample(node, 'uImage', 0, incoming); sample(node, 'uCoverage0', 1, a); sample(node, 'uCoverage1', 2, b); sample(node, 'uBrush', 3, brush);
				extent(node, target.width, target.height); gl.uniform2i(location(node, 'uBrushExtent'), brushWidth, brushHeight);
				gl.uniform1i(location(node, 'uNodeKind'), uniforms.kind); gl.uniform4f(location(node, 'uParams0'), ...uniforms.params0); gl.uniform4f(location(node, 'uParams1'), ...uniforms.params1);
			});
		},
		feather(target: MaskTextureCurrentV1, source: WebGLTexture, radius: number, stage: 'horizontal' | 'vertical') {
			if (!Number.isInteger(radius) || radius < 1 || radius > 64) throw new RangeError('Mask feather requires prepared radius1..64.');
			const program = stage === 'horizontal' ? horizontal : vertical;
			owner.draw(program, target, () => { sample(program, 'uCoverage', 0, source); extent(program, target.width, target.height); gl.uniform1i(location(program, 'uRadius'), radius); });
		},
		path(target: MaskTextureCurrentV1, edges: WebGLTexture, previous: WebGLTexture | undefined, count: number) {
			if (!Number.isInteger(count) || count < 1 || count > 256) throw new RangeError('Mask path chunk exceeds its prepared bank.');
			const program = previous === undefined ? initial : sum;
			owner.draw(program, target, () => { sample(program, 'uEdges', 0, edges); if (previous !== undefined) sample(program, 'uPrevious', 1, previous);
				extent(program, target.width, target.height); gl.uniform1i(location(program, 'uEdgeCount'), count); });
		},
		resolve(target: MaskTextureCurrentV1, winding: WebGLTexture, evenOdd: boolean) {
			owner.draw(resolve, target, () => { sample(resolve, 'uWinding', 0, winding); gl.uniform1i(location(resolve, 'uEvenOdd'), evenOdd ? 1 : 0); });
		},
		blend(target: MaskTextureCurrentV1, incoming: WebGLTexture, candidate: WebGLTexture, coverage: WebGLTexture, policy: unknown) {
			if (target.texture === incoming || target.texture === candidate || target.texture === coverage) throw new TypeError('Masked blend cannot sample its destination.');
			const uniforms = preparePixelFrameWebGl2MaskBlendUniformsCurrentV1(policy);
			owner.draw(blend, target, () => { sample(blend, 'uIncoming', 0, incoming); sample(blend, 'uCandidate', 1, candidate); sample(blend, 'uCoverage', 2, coverage);
				gl.uniform1i(location(blend, 'uBlendPolicy'), uniforms.policy); gl.uniform1i(location(blend, 'uCopyRed'), uniforms.copyRed); gl.uniform1i(location(blend, 'uCopyBlue'), uniforms.copyBlue); });
		},
	});
}
export type MaskProgramsCurrentV1 = ReturnType<typeof createMaskProgramsCurrentV1>;
