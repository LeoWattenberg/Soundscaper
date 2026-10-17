/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ExactExecutionDependenciesFinishing } from './video-export-exact-dependencies-finishing.ts';
import type { ProductVideoExportStrategyEncodeRequest } from '../common/editor/controller/export/product-video-export-strategy.ts';
import type { FramescaperVideoExportVisualAssetStoreFinishing } from './video-export-visual-execution-finishing.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import { createFramescaperVideoExportExactExecutionFinishing } from './video-export-exact-execution-finishing.ts';
import { isFramescaperVideoVisualPlanFinishing } from './video-export-visual-plan-finishing.ts';
import { createVideoExactPictureExportFrameSource, type VideoKeyframeExportFrame } from '../common/editor/video-keyframe-export-frame-source.ts';
import { createVideoKeyframeOfflineEncoderRequest, preflightVideoKeyframeOfflineEncoder, type VideoKeyframeOfflineEncoderOptions } from '../common/editor/ui/video-keyframe-offline-video-export-encoder.ts';
import type { VideoKeyframeOfflineRgbaRenderer } from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
export async function createVisualExecution(
	profile: unknown,
	authority: Readonly<{ canonicalProject: Readonly<Record<string, unknown>> }>,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreFinishing | undefined,
	exactDependencies: ExactExecutionDependenciesFinishing,
) {
	if (!isFramescaperVideoVisualPlanFinishing(request.plan)) {
		throw new TypeError('Selected finishing picture-only execution requires its exact V13 output plan.');
	}
	const visualPlan = request.plan;
	if (!(request.videoBlobs instanceof Map) || request.videoBlobs.size !== 0) {
		throw new TypeError('Selected finishing picture-only execution refuses unplanned video inputs.');
	}
	const includesAudio = request.plan.inputs.some(({ kind }) => kind === 'staged-audio-mix');
	if (includesAudio !== (request.audioMix instanceof Blob)) {
		throw new TypeError('Selected finishing picture-only audio must exactly match its detached plan.');
	}
	const exact = await createFramescaperVideoExportExactExecutionFinishing({
		profile, project: authority.canonicalProject as unknown as FramescaperProjectFinishing,
		request, ...(assetStore === undefined ? {} : { store: assetStore }),
		...exactDependencies,
	});
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: request.plan.sampleRate,
		startFrame: request.plan.range.startFrame,
		endFrame: request.plan.range.endFrame,
		canvas: {
			width: request.plan.canvas.width, height: request.plan.canvas.height,
			frameRate: request.plan.canvas.frameRate, fit: request.plan.canvas.fit,
			backgroundColor: request.plan.canvas.backgroundColor,
		},
	});
	const renderer: VideoKeyframeOfflineRgbaRenderer = Object.freeze({
		width: visualPlan.canvas.width, height: visualPlan.canvas.height,
		byteLength: visualPlan.canvas.width * visualPlan.canvas.height * 4,
		async produce(frame: VideoKeyframeExportFrame, target: Uint8Array,
			options: Readonly<{ readonly signal: AbortSignal }>) {
			await exact.compositor({
				frame, layers: [], width: visualPlan.canvas.width, height: visualPlan.canvas.height,
				rgba: target as Uint8Array<ArrayBuffer>, signal: options.signal,
			});
		},
		async dispose() { await exact.dispose(); },
	});
	const encoderOptions: Readonly<Record<string, number>> = request.maximumOutputBytes === undefined
		? Object.freeze({}) : Object.freeze({ maximumOutputBytes: request.maximumOutputBytes as number });
	const options: VideoKeyframeOfflineEncoderOptions = Object.freeze({
		format: request.plan.format,
		rgbaOutput: exact.rgbaOutput,
		quality: request.plan.quality,
		...(request.webCodecs ? { webCodecs: request.webCodecs } : {}),
		...(request.audioMix instanceof Blob ? { audioMix: request.audioMix } : {}),
		encoderOptions,
		signal: request.signal, assertCurrent: request.assertCurrent, confirmFileSizeWarning: request.confirmFileSizeWarning,
	});
	await preflightVideoKeyframeOfflineEncoder(options, frameSource);
	return Object.freeze({ exact, encoderRequest: createVideoKeyframeOfflineEncoderRequest(
		options, frameSource, renderer,
	) });
}

