/* SPDX-License-Identifier: AGPL-3.0-only */
import type { prepareLinearDevelopMetadataCurrentV1 } from './image-develop-linear-metadata-current-v1.ts';
import { CURRENT_LINEAR_WORKING_BYTES_V1 } from './image-develop-linear-metadata-current-v1.ts';
import { preparePixelFrameWebGl2ColorsCurrentV1, PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 } from './pixel-frame-webgl2-color-current-v1.ts';
import { preparePixelFrameWebGl2LutCurrentV1, planPixelFrameWebGl2LutsCurrentV1, isPixelFrameWebGl2LutCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import type { PreparedPixelFrameWebGl2PassCurrentV1 } from './pixel-frame-webgl2-pass-current-v1.ts';

type Metadata = ReturnType<typeof prepareLinearDevelopMetadataCurrentV1>;

/** Shared scalar admission for full rendering and proxy preference. LUT parse,
 * retained oracle/upload/texture, GPU execution and whole CPU fallback are
 * distinct phases. No body, pixel or native context is read here. */
export function prepareImageDevelopGpuPlanCurrentV1(metadata: Metadata, physicalBytes = metadata.sourcePlan.byteLength, overlay = false) {
	if (!Number.isSafeInteger(physicalBytes) || physicalBytes < metadata.sourcePlan.byteLength) throw new RangeError('GPU Develop requires bounded physical source bytes.');
	const colors = preparePixelFrameWebGl2ColorsCurrentV1(metadata.stages.flatMap(stage => stage.kind === 'color' ? [stage.effect] : []));
	const byId = new Map(colors.map(pass => [pass.id, pass] as const)), passes: PreparedPixelFrameWebGl2PassCurrentV1[] = [];
	for (const stage of metadata.stages) {
		if (stage.kind === 'lut') passes.push(preparePixelFrameWebGl2LutCurrentV1({ id: stage.id, reference: stage.reference }));
		else if (stage.kind === 'color') { const pass = byId.get(stage.effect.id); if (pass) passes.push(pass); }
	}
	const luts = planPixelFrameWebGl2LutsCurrentV1(passes.filter(isPixelFrameWebGl2LutCurrentV1));
	const uniformBytes = passes.some(pass => pass.kind > 2) ? PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 : 0;
	const floatBytes = metadata.descriptor.width * metadata.descriptor.height * 16;
	const outputPixels = metadata.finalDescriptor.width * metadata.finalDescriptor.height;
	const presentationBytes = outputPixels * 4 + Math.min(outputPixels, 4_194_304) * 4;
	const resourceBytes = luts.oracleBytes + luts.uploadBytes + luts.textureBytes;
	const gpuWorkingBytes = physicalBytes + 4 * floatBytes + presentationBytes + uniformBytes + resourceBytes;
	const peakWorkingBytes = Math.max(gpuWorkingBytes,
		physicalBytes + metadata.peakWorkingBytes - metadata.sourcePlan.byteLength + floatBytes,
		physicalBytes + floatBytes + luts.capturePeakBytes,
		physicalBytes + floatBytes + luts.oracleBytes + luts.textureBytes + 1024);
	const unsupported = Boolean(metadata.repairs || metadata.masks.plan.bindings.length || metadata.masks.references.length || overlay
		|| metadata.stages.some(stage => stage.kind !== 'noop' && stage.kind !== 'color' && stage.kind !== 'lut'));
	return Object.freeze({ passes: Object.freeze(passes), luts, uniformBytes, floatBytes, presentationBytes, resourceBytes,
		gpuWorkingBytes, peakWorkingBytes, unsupported, eligible: luts.eligible && peakWorkingBytes <= CURRENT_LINEAR_WORKING_BYTES_V1 });
}
