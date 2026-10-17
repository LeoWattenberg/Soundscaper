/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyGlobalDevelopPreviewLookupV1 } from '../../video-global-develop-v1.ts';
import { bindVideoEffectLookupGpu, disposeVideoEffectLookupGpu } from './internal/video-effect-lookup-gpu.ts';

/** Share one authenticated nearest transfer texture with the other separable effect owners. */
export function bindVideoGlobalDevelopGpu(gl: WebGL2RenderingContext, location: WebGLUniformLocation | null, pass: unknown): void {
	bindVideoEffectLookupGpu(gl, location, pass, copyGlobalDevelopPreviewLookupV1);
}
export function disposeVideoGlobalDevelopGpu(gl: WebGL2RenderingContext): void { disposeVideoEffectLookupGpu(gl); }
