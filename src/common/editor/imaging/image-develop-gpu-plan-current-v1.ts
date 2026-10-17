/* SPDX-License-Identifier: AGPL-3.0-only */
import type { prepareLinearDevelopMetadataCurrentV1 } from './image-develop-linear-metadata-current-v1.ts';
import { CURRENT_LINEAR_WORKING_BYTES_V1 } from './image-develop-linear-metadata-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 } from './pixel-frame-webgl2-color-current-v1.ts';
import { planPixelFrameWebGl2LutsCurrentV1, isPixelFrameWebGl2LutCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import { planPixelFrameWebGl2PipelineCurrentV1 } from './pixel-frame-webgl2-pipeline-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 } from './pixel-frame-webgl2-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskContextCurrentV1 } from './pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskOverlayCurrentV1 } from './pixel-frame-webgl2-mask-overlay-plan-current-v1.ts';
import { prepareImageDevelopGpuMaskPhasePlanCurrentV1 } from './image-develop-gpu-mask-phase-plan-current-v1.ts';

type Metadata = ReturnType<typeof prepareLinearDevelopMetadataCurrentV1>;

/** Shared scalar admission for full rendering and proxy preference. LUT parse,
 * retained oracle/upload/texture, GPU execution and whole CPU fallback are
 * distinct phases. No body, pixel or native context is read here. */
export function prepareImageDevelopGpuPlanCurrentV1(metadata: Metadata, physicalBytes = metadata.sourcePlan.byteLength, overlay = false) {
	if (!Number.isSafeInteger(physicalBytes) || physicalBytes < metadata.sourcePlan.byteLength) throw new RangeError('GPU Develop requires bounded physical source bytes.');
	const maskPipeline = preparePixelFrameWebGl2MaskPlanCurrentV1(metadata), passes = maskPipeline.passes;
	const unmaskedPipeline = planPixelFrameWebGl2PipelineCurrentV1(metadata.descriptor, passes);
	if (unmaskedPipeline.maximumFrameBytes !== maskPipeline.maximumFrameBytes) throw new RangeError('GPU authored/pixel pipeline extents differ.');
	// The mask branch has one complete private phase authority. Original
	// unmasked callers retain the previous planner and pixel execution path.
	const masked = Boolean(metadata.repairs || metadata.masks.plan.bindings.length || metadata.masks.references.length || overlay || maskPipeline.selectedExecutionIndex !== undefined);
	const maskContext = masked ? preparePixelFrameWebGl2MaskContextCurrentV1(maskPipeline) : undefined;
	const maskOverlay = maskPipeline.selectedExecutionIndex === undefined ? undefined : preparePixelFrameWebGl2MaskOverlayCurrentV1(maskPipeline);
	const maskPhase = maskContext ? prepareImageDevelopGpuMaskPhasePlanCurrentV1(maskPipeline, maskContext, maskOverlay, physicalBytes) : undefined;
	const hasPlaneReference = Boolean(maskPhase?.repairPrefix) || unmaskedPipeline.hasPlaneReference || maskPipeline.executedCheckpoints.length > 0;
	const imageTextureCount = maskPhase?.imageTextureCount ?? maskPipeline.imageTextureCount;
	const pipeline = Object.freeze({ ...unmaskedPipeline, hasPlaneReference, imageTextureCount,
		textureBytes: maskPipeline.maximumFrameBytes * imageTextureCount,
		referenceBytes: hasPlaneReference ? maskPipeline.maximumFrameBytes * 2 : 0 });
	const workingPlanComplete = maskPhase?.workingPlanComplete ?? (maskPipeline.graphAdmissionComplete && metadata.masks.references.length === 0 && !overlay);
	const luts = planPixelFrameWebGl2LutsCurrentV1(passes.filter(isPixelFrameWebGl2LutCurrentV1));
	const uniformBytes = passes.some(pass => pass.kind > 2) ? PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 : 0;
	const floatBytes = metadata.descriptor.width * metadata.descriptor.height * 16;
	const outputPixels = metadata.finalDescriptor.width * metadata.finalDescriptor.height;
	const presentationBytes = outputPixels * 4 + Math.min(outputPixels, 4_194_304) * 4;
	const resourceBytes = luts.oracleBytes + luts.uploadBytes + luts.textureBytes;
	const gpuWorkingBytes = maskPhase?.peakWorkingBytes ?? (physicalBytes + floatBytes + pipeline.textureBytes + pipeline.readbackBytes
		+ pipeline.referenceBytes + presentationBytes + uniformBytes + resourceBytes);
	const peakWorkingBytes = maskPhase?.peakWorkingBytes ?? Math.max(gpuWorkingBytes,
		physicalBytes + metadata.peakWorkingBytes - metadata.sourcePlan.byteLength + floatBytes,
		physicalBytes + floatBytes + pipeline.readbackBytes + presentationBytes,
		physicalBytes + floatBytes + luts.capturePeakBytes,
		physicalBytes + floatBytes + luts.oracleBytes + luts.textureBytes + 1024);
	const unsupported = Boolean(!workingPlanComplete || (maskPhase !== undefined && !maskPhase.supported) || (overlay && maskPipeline.selectedExecutionIndex === undefined)
		|| metadata.stages.some(stage => stage.kind !== 'noop' && stage.kind !== 'color' && stage.kind !== 'lut' && stage.kind !== 'geometry'
			&& stage.kind !== 'lens-distortion' && stage.kind !== 'chromatic-aberration' && stage.kind !== 'defringe' && stage.kind !== 'optical-vignette' && stage.kind !== 'spatial'));
	return Object.freeze({ passes: pipeline.passes, pipeline, maskPipeline, workingPlanComplete, luts, uniformBytes, floatBytes, presentationBytes, resourceBytes,
		gpuWorkingBytes, peakWorkingBytes, maskContext, maskOverlay, maskPhase, unsupported,
		eligible: maskPhase ? maskPhase.eligible : workingPlanComplete && luts.eligible && peakWorkingBytes <= CURRENT_LINEAR_WORKING_BYTES_V1 });
}
