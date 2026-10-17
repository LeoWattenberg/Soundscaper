/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductVideoExportStrategyEncodeRequest } from '../common/editor/controller/export/product-video-export-strategy.ts';
import { createVideoExactPictureExportFrameSource } from '../common/editor/video-keyframe-export-frame-source.ts';
import { createVideoKeyframeOfflineEncoderRequest, preflightVideoKeyframeOfflineEncoder,
	type VideoKeyframeOfflineEncoderOptions } from '../common/editor/ui/video-keyframe-offline-video-export-encoder.ts';
import type { VideoKeyframeOfflineRgbaRenderer } from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import type { FramescaperVideoExportExactExecutionCore } from './video-export-exact-execution-core.ts';
import type { FramescaperVideoVisualPlanFinishing } from './video-export-visual-plan-finishing.ts';
import { createFramescaperVisualRgbaProducer } from './video-export-visual-rgba-producer.ts';
import { captureVideoWebCodecsRgbaColorSpace } from '../common/editor/video-webcodecs-producer.ts';

/** Detach the caller's decision before supplemental resources or native readers can await. */
export function captureFramescaperEncodeWebCodecsRequest(request: ProductVideoExportStrategyEncodeRequest): ProductVideoExportStrategyEncodeRequest {
	const decision = request.webCodecs;
	if (!decision) return request;
	captureVideoWebCodecsRgbaColorSpace(decision);
	return { ...request, webCodecs: Object.freeze({ ...decision }) };
}

/** The exact finishing execution, rather than an active UI sequence, owns the declared RGBA transfer. */
export function framescaperOutputWebCodecsDecision(
	decision: NonNullable<ProductVideoExportStrategyEncodeRequest['webCodecs']>, outputColorSpace: 'srgb' | 'rec709',
): NonNullable<ProductVideoExportStrategyEncodeRequest['webCodecs']> {
	const stated = captureVideoWebCodecsRgbaColorSpace(decision);
	if (stated !== undefined && stated !== outputColorSpace) throw new Error('WebCodecs RGBA profile contradicts the exact finishing output.');
	return Object.freeze({ ...decision, rgbaColorSpace: outputColorSpace });
}

/** Retain the original picture producer/disposal and exact encoder option assembly. */
export async function createFramescaperPictureEncoderRequest(
	request: ProductVideoExportStrategyEncodeRequest, plan: FramescaperVideoVisualPlanFinishing,
	exact: FramescaperVideoExportExactExecutionCore<13 | 16>,
) {
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: plan.sampleRate,
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
		canvas: {
			width: plan.canvas.width, height: plan.canvas.height,
			frameRate: plan.canvas.frameRate, fit: plan.canvas.fit,
			backgroundColor: plan.canvas.backgroundColor,
		},
	});
	const renderer: VideoKeyframeOfflineRgbaRenderer = Object.freeze({
		width: plan.canvas.width, height: plan.canvas.height,
		byteLength: plan.canvas.width * plan.canvas.height * 4,
		produce: createFramescaperVisualRgbaProducer(
			plan.canvas.width, plan.canvas.height, exact.compositor, request.rgbaPostprocessor,
		),
		async dispose() { await exact.dispose(); },
	});
	const encoderOptions: Readonly<Record<string, number>> = request.maximumOutputBytes === undefined
		? Object.freeze({}) : Object.freeze({ maximumOutputBytes: request.maximumOutputBytes as number });
	const options: VideoKeyframeOfflineEncoderOptions = Object.freeze({
		format: plan.format,
		quality: plan.quality,
		...(request.webCodecs ? { webCodecs: framescaperOutputWebCodecsDecision(request.webCodecs, exact.outputColorSpace) } : {}),
		...(request.audioMix instanceof Blob ? { audioMix: request.audioMix } : {}),
		encoderOptions,
		signal: request.signal, assertCurrent: request.assertCurrent, confirmFileSizeWarning: request.confirmFileSizeWarning,
	});
	await preflightVideoKeyframeOfflineEncoder(options, frameSource);
	return createVideoKeyframeOfflineEncoderRequest(options, frameSource, renderer);
}
