/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyCurvesPreviewLookupV1 } from '../../video-curves-v1.ts';
import { bindVideoEffectLookupGpu, disposeVideoEffectLookupGpu } from './internal/video-effect-lookup-gpu.ts';

export function bindVideoCurvesGpu(gl: WebGL2RenderingContext, location: WebGLUniformLocation | null, pass: unknown): void {
	bindVideoEffectLookupGpu(gl, location, pass, copyCurvesPreviewLookupV1);
}
export function disposeVideoCurvesGpu(gl: WebGL2RenderingContext): void { disposeVideoEffectLookupGpu(gl); }
