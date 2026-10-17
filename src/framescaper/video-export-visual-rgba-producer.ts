/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoKeyframeOfflineRgbaCompositor, VideoKeyframeOfflineRgbaPostprocessor } from '../common/editor/video-keyframe-offline-rgba-contract.ts';
import type { VideoKeyframeOfflineRgbaRenderer } from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;

/** The exact picture owner retains disposal; its encoder joins this entire producer. */
export function createFramescaperVisualRgbaProducer(
	width: number,
	height: number,
	compose: VideoKeyframeOfflineRgbaCompositor,
	postprocess?: VideoKeyframeOfflineRgbaPostprocessor,
): VideoKeyframeOfflineRgbaRenderer['produce'] {
	return async (frame, target, { signal }) => {
		CHECK.call(signal);
		const rgba = target as Uint8Array<ArrayBuffer>;
		await compose({ frame, layers: [], width, height, rgba, signal });
		CHECK.call(signal);
		await postprocess?.(Object.freeze({ frame, width, height, rgba, signal }));
		CHECK.call(signal);
	};
}
