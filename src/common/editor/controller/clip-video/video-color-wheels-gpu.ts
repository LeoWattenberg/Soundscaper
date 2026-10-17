/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertColorWheelsPreviewPassV1, copyColorWheelsPreviewLookupV1 } from '../../video-color-wheels-v1.ts';
import { bindVideoEffectLookupGpu, disposeVideoEffectLookupGpu } from './internal/video-effect-lookup-gpu.ts';

export function bindVideoColorWheelsGpu(gl: WebGL2RenderingContext, location: WebGLUniformLocation | null, pass: unknown): void {
	assertColorWheelsPreviewPassV1(pass);
	bindVideoEffectLookupGpu(gl, location, pass, copyColorWheelsPreviewLookupV1);
}
export function disposeVideoColorWheelsGpu(gl: WebGL2RenderingContext): void { disposeVideoEffectLookupGpu(gl); }
