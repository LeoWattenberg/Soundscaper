/* SPDX-License-Identifier: AGPL-3.0-only */
import type { prepareLinearDevelopMetadataCurrentV1 } from './image-develop-linear-metadata-current-v1.ts';
import { CURRENT_LINEAR_WORKING_BYTES_V1 } from './image-develop-linear-metadata-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 } from './pixel-frame-webgl2-color-current-v1.ts';
import { planPixelFrameWebGl2LutsCurrentV1, isPixelFrameWebGl2LutCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import { planPixelFrameWebGl2PipelineCurrentV1 } from './pixel-frame-webgl2-pipeline-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 } from './pixel-frame-webgl2-mask-plan-current-v1.ts';

type Metadata = ReturnType<typeof prepareLinearDevelopMetadataCurrentV1>;

/** Shared scalar admission for full rendering and proxy preference. LUT parse,
 * retained oracle/upload/texture, GPU execution and whole CPU fallback are
 * distinct phases. No body, pixel or native context is read here. */
export function prepareImageDevelopGpuPlanCurrentV1(metadata: Metadata, physicalBytes = metadata.sourcePlan.byteLength, overlay = false) {
	if (!Number.isSafeInteger(physicalBytes) || physicalBytes < metadata.sourcePlan.byteLength) throw new RangeError('GPU Develop requires bounded physical source bytes.');
	const maskPipeline = preparePixelFrameWebGl2MaskPlanCurrentV1(metadata), passes = maskPipeline.passes;
	const unmaskedPipeline = planPixelFrameWebGl2PipelineCurrentV1(metadata.descriptor, passes);
	if (unmaskedPipeline.maximumFrameBytes !== maskPipeline.maximumFrameBytes) throw new RangeError('GPU authored/pixel pipeline extents differ.');
	const hasPlaneReference = unmaskedPipeline.hasPlaneReference || maskPipeline.executedCheckpoints.length > 0;
	const pipeline = Object.freeze({ ...unmaskedPipeline, hasPlaneReference, imageTextureCount: maskPipeline.imageTextureCount,
		textureBytes: maskPipeline.maximumFrameBytes * maskPipeline.imageTextureCount,
		referenceBytes: hasPlaneReference ? maskPipeline.maximumFrameBytes * 2 : 0 });
	// Known image/reference fees only: pending graph/brush/overlay costs are
	// not zero and this partial plan must never admit a GPU mask dispatch.
	const workingPlanComplete = maskPipeline.graphAdmissionComplete && metadata.masks.references.length === 0 && !overlay;
	const luts = planPixelFrameWebGl2LutsCurrentV1(passes.filter(isPixelFrameWebGl2LutCurrentV1));
	const uniformBytes = passes.some(pass => pass.kind > 2) ? PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 : 0;
	const floatBytes = metadata.descriptor.width * metadata.descriptor.height * 16;
	const outputPixels = metadata.finalDescriptor.width * metadata.finalDescriptor.height;
	const presentationBytes = outputPixels * 4 + Math.min(outputPixels, 4_194_304) * 4;
	const resourceBytes = luts.oracleBytes + luts.uploadBytes + luts.textureBytes;
	const gpuWorkingBytes = physicalBytes + floatBytes + pipeline.textureBytes + pipeline.readbackBytes
		+ pipeline.referenceBytes + presentationBytes + uniformBytes + resourceBytes;
	const peakWorkingBytes = Math.max(gpuWorkingBytes,
		physicalBytes + metadata.peakWorkingBytes - metadata.sourcePlan.byteLength + floatBytes,
		physicalBytes + floatBytes + pipeline.readbackBytes + presentationBytes,
		physicalBytes + floatBytes + luts.capturePeakBytes,
		physicalBytes + floatBytes + luts.oracleBytes + luts.textureBytes + 1024);
	const unsupported = Boolean(!workingPlanComplete || metadata.repairs || metadata.masks.plan.bindings.length || metadata.masks.references.length || overlay
		|| metadata.stages.some(stage => stage.kind !== 'noop' && stage.kind !== 'color' && stage.kind !== 'lut' && stage.kind !== 'geometry'
			&& stage.kind !== 'lens-distortion' && stage.kind !== 'chromatic-aberration' && stage.kind !== 'defringe' && stage.kind !== 'optical-vignette' && stage.kind !== 'spatial'));
	return Object.freeze({ passes: pipeline.passes, pipeline, maskPipeline, workingPlanComplete, luts, uniformBytes, floatBytes, presentationBytes, resourceBytes,
		gpuWorkingBytes, peakWorkingBytes, unsupported, eligible: workingPlanComplete && luts.eligible && peakWorkingBytes <= CURRENT_LINEAR_WORKING_BYTES_V1 });
}
