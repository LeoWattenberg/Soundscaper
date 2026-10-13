/* SPDX-License-Identifier: AGPL-3.0-only */
import type { VideoRgbaOutput } from '../common/editor/video-planar-pixels.ts';
import type { ProductVideoExportStrategy, ProductVideoExportStrategyEncodeRequest } from '../common/editor/controller/export/product-video-export-strategy.ts';
import type { VideoKeyframeVideoEncoderRequest } from '../common/editor/video-keyframe-video-encoder.ts';
export type FramescaperVideoRgbaOutput = VideoRgbaOutput;
export type FramescaperVideoFrameConsumer = (request: VideoKeyframeVideoEncoderRequest, output?: FramescaperVideoRgbaOutput) => Promise<void>;
type Consume = (request: ProductVideoExportStrategyEncodeRequest, consumer: FramescaperVideoFrameConsumer) => Promise<void>;
const CONSUMERS = new WeakMap<object, Consume>();
/** An owned raw-frame route carries the same projection and finishing authority as encoded delivery. */
export function bindFramescaperVideoFrameConsumer(strategy: ProductVideoExportStrategy, consume: Consume): ProductVideoExportStrategy {
	if (CONSUMERS.has(strategy)) throw new Error('This Frame picture strategy already owns its frame consumer.');
	CONSUMERS.set(strategy, consume); return strategy;
}
/** Completion means picture sources and compositor resources have been released, before native publication. */
export function consumeFramescaperVideoFrames(strategy: ProductVideoExportStrategy, request: ProductVideoExportStrategyEncodeRequest, consumer: FramescaperVideoFrameConsumer): Promise<void> {
	const consume = CONSUMERS.get(strategy); if (!consume || typeof consumer !== 'function') throw new Error('This Frame export strategy has no authenticated raw-frame consumer.');
	return consume(request, consumer);
}
