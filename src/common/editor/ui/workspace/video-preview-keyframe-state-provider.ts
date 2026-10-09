/* SPDX-License-Identifier: AGPL-3.0-only */
import { cubeLutEffectPortV1For } from '../../controller/clip-video/cube-lut-effect-port-v1.ts';
import { createVideoKeyframeRenderStateProvider } from '../../video-keyframe-render-state-provider.ts';
import { createVideoKeyframeRenderStateProviderV2 } from '../../video-keyframe-render-state-provider-v2.ts';

/** Current Frame opts in through its privately bound product action port;
 * ordinary shared/fixture controllers retain the original strict provider. */
export function createVideoPreviewKeyframeStateProvider(owner: object) {
	return cubeLutEffectPortV1For(owner) ? createVideoKeyframeRenderStateProviderV2() : createVideoKeyframeRenderStateProvider();
}
