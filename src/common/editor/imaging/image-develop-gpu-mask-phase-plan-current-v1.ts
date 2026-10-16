/* SPDX-License-Identifier: AGPL-3.0-only */
/* Complete scalar admission; native source and scope authority remain separate. */
import { readPixelFrameWebGl2MaskCheckpointPlanCurrentV1 } from './pixel-frame-webgl2-mask-plan-current-v1.ts';
import { readPixelFrameWebGl2MaskContextCurrentV1 } from './pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { readPixelFrameWebGl2MaskOverlayCurrentV1 } from './pixel-frame-webgl2-mask-overlay-plan-current-v1.ts';
import { pixelFrameWebGl2MaskReceiptWorkingBytesCurrentV1 } from './pixel-frame-webgl2-mask-checkpoint-current-v1.ts';
import { planPixelFrameWebGl2PipelineCurrentV1 } from './pixel-frame-webgl2-pipeline-current-v1.ts';
import { planPixelFrameWebGl2LutsCurrentV1, isPixelFrameWebGl2LutCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 } from './pixel-frame-webgl2-color-current-v1.ts';

const COMPONENT = 64 * 1024 * 1024, TOTAL = 768 * 1024 * 1024;
const HAS = Set.prototype.has;
export interface ImageDevelopGpuMaskPhaseCurrentV1 {
	readonly name: string;
	readonly executionIndex: number | undefined;
	readonly maskBytes: number;
	readonly totalBytes: number;
}
interface Prepared {
	readonly checkpointPlan: unknown;
	readonly workingPlanComplete: true;
	readonly contextPlan: unknown;
	readonly overlayPlan: unknown;
	readonly phases: readonly Readonly<ImageDevelopGpuMaskPhaseCurrentV1>[];
	readonly physicalSourceBytes: number;
	readonly floatCaptureBytes: number;
	readonly imageTextureBytes: number;
	readonly referenceBytes: number;
	readonly readbackBytes: number;
	readonly retainedBrushBytes: number;
	readonly brushAuthBytes: number;
	readonly retainedStorageKeys: readonly string[];
	readonly receiptBytes: number;
	readonly contextStateBytes: number;
	readonly retainedOverlayBytes: number;
	readonly lutCaptureBytes: number;
	readonly lutOracleBytes: number;
	readonly lutUploadBytes: number;
	readonly lutTextureBytes: number;
	readonly legacyMaskAdmissionBytes: number;
	readonly maximumMaskComponentBytes: number;
	readonly directCpuPeakBytes: number;
	readonly attemptedFallbackPeakBytes: number;
	readonly peakWorkingBytes: number;
	readonly directCpuEligible: boolean;
	readonly supported: boolean;
	readonly eligible: boolean;
}
const PLANS = new WeakMap<object, Readonly<Prepared>>();
function sum(...values: readonly number[]): number {
	let result = 0;
	for (const value of values) {
		if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(result + value)) throw new RangeError('GPU phase requires bounded nonnegative physical fees.');
		result += value;
	} return result;
}

/** Fixed ownership schedule:
 * capture → whole-brush-auth → whole-LUT-auth → probe/GPU checkpoints → final
 * readback → two-plane CPU proof → retire resource/proof scopes → consumer.
 * Each withCoverage and selected project scope retires before replay. */
export function prepareImageDevelopGpuMaskPhasePlanCurrentV1(checkpointValue: unknown, contextValue: unknown,
	overlayValue?: unknown, physicalBytes?: number): Readonly<Prepared> {
	const checkpoints = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(checkpointValue);
	const context = readPixelFrameWebGl2MaskContextCurrentV1(contextValue), metadata = checkpoints.metadata;
	if (context.checkpointPlan !== checkpoints) throw new TypeError('GPU phase context must own the same checkpoint schedule.');
	const selected = checkpoints.selectedExecutionIndex;
	const overlay = overlayValue === undefined ? undefined : readPixelFrameWebGl2MaskOverlayCurrentV1(overlayValue);
	if ((selected !== undefined) !== (overlay !== undefined) || overlay && (overlay.checkpointPlan !== checkpointValue || overlay.checkpoint !== checkpoints.executedCheckpoints[selected!])) {
		throw new TypeError('GPU phase overlay must own the exact selected checkpoint/suffix.');
	}
	if (context.entries.length !== checkpoints.executedCheckpoints.length) throw new TypeError('GPU phase omitted graph admission.');
	for (const [index, entry] of context.entries.entries()) if (entry.checkpoint !== checkpoints.executedCheckpoints[index]) throw new TypeError('GPU phase reordered a checkpoint graph.');
	const logicalBytes = metadata.sourcePlan.byteLength, physical = physicalBytes ?? logicalBytes;
	if (!Number.isSafeInteger(physical) || physical < logicalBytes) throw new RangeError('GPU phase requires the actual full physical source backing.');
	const floatCapture = metadata.descriptor.width * metadata.descriptor.height * 16, maximumFrame = checkpoints.maximumFrameBytes;
	const imageTextures = maximumFrame * checkpoints.imageTextureCount, readback = metadata.finalDescriptor.width * metadata.finalDescriptor.height * 16;
	const pipeline = planPixelFrameWebGl2PipelineCurrentV1(metadata.descriptor, checkpoints.passes);
	const reference = context.entries.length || pipeline.hasPlaneReference ? maximumFrame * 2 : 0;
	const luts = planPixelFrameWebGl2LutsCurrentV1(checkpoints.passes.filter(isPixelFrameWebGl2LutCurrentV1));
	const uniforms = checkpoints.passes.some(pass => pass.kind > 2) ? PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 : 0;
	const receipt = context.entries.length ? pixelFrameWebGl2MaskReceiptWorkingBytesCurrentV1(checkpointValue) : 0;
	const retainedOverlay = overlay?.retainedHostBytes ?? 0;
	let retainedBrush = 0, largestBrushBody = 0;
	const keys: string[] = [];
	for (const reference of metadata.masks.references) {
		largestBrushBody = Math.max(largestBrushBody, reference.byteLength);
		if (Reflect.apply(HAS, metadata.masks.retainedStorageKeys, [reference.storageKey])) { retainedBrush += reference.width * reference.height; keys.push(reference.storageKey); }
	}
	const brushAuth = sum(retainedBrush, largestBrushBody * 4, metadata.masks.references.length ? 64 : 0);
	// Private high/lower owners must use this captured key list for the actual
	// scope; do not reread a public Set after an await or silently change H.
	const retainedStorageKeys = Object.freeze(keys);
	const nativeBase = sum(physical, floatCapture, imageTextures, luts.oracleBytes, luts.uploadBytes, luts.textureBytes, uniforms);
	const acceptedBase = sum(physical, floatCapture, imageTextures, readback, luts.uploadBytes, luts.textureBytes, uniforms);
	const phases: Readonly<ImageDevelopGpuMaskPhaseCurrentV1>[] = [];
	const phase = (name: string, imageBytes: number, maskBytes: number, executionIndex?: number) => {
		phases.push(Object.freeze({ name, executionIndex, maskBytes, totalBytes: sum(imageBytes, maskBytes) }));
	};
	// B allocates its final host plane at scope entry, not lazily at project.
	phase('source-capture', sum(physical, floatCapture), retainedOverlay);
	phase('brush-authentication', sum(physical, floatCapture), sum(brushAuth, retainedOverlay));
	phase('lut-authentication', sum(physical, floatCapture, luts.capturePeakBytes), sum(retainedBrush, retainedOverlay));
	// Programs/opaque driver objects are not typed image allocations. Probe
	// payloads retain the existing1KiB reserve plus A's separate4KiB probe.
	phase('native-probes', sum(nativeBase, 1024), sum(retainedBrush, retainedOverlay, context.stateBytes, context.probeBytes, receipt));
	for (const entry of context.entries) {
		const c = entry.checkpoint, index = c.executionIndex!;
		phase('gpu-coverage-and-blend', nativeBase, sum(retainedBrush, retainedOverlay, entry.graph.graphGpuBytes, context.nativeReadbackBytes, context.stateBytes,
			receipt), index);
		if (c.selected) phase('gpu-selected-byte-projection', nativeBase,
			sum(retainedBrush, entry.graph.graphGpuBytes, context.nativeReadbackBytes, context.stateBytes, receipt, overlay!.gpuPeakBytes), index);
	}
	// The fixed host integration closes A's mask context/program/state scope
	// here, before readback/reference. Only parent image GL and B host remain.
	const proofBase = sum(nativeBase, readback, reference);
	phase('final-float-readback', sum(nativeBase, readback), sum(retainedBrush, receipt, retainedOverlay));
	phase('cpu-native-replay', proofBase, sum(retainedBrush, receipt, retainedOverlay));
	for (const entry of context.entries) {
		const c = entry.checkpoint;
		phase('cpu-coverage-proof', proofBase, sum(retainedBrush, receipt, retainedOverlay, c.binding.workingBytes), c.executionIndex!);
		if (c.selected) phase('cpu-selected-byte-proof', proofBase,
			sum(retainedBrush, receipt, retainedOverlay, c.binding.workingBytes, overlay!.cpuProjectionBytes), c.executionIndex!);
	}
	// Existing fullRGBA8 +bounded fitted-presentation allowance is retained;
	// the full histogram conversion and fitted display run sequentially.
	const outputPixels = metadata.finalDescriptor.width * metadata.finalDescriptor.height;
	const presentation = outputPixels * 4 + Math.min(outputPixels, 4_194_304) * 4;
	phase('accepted-presentation', sum(acceptedBase, presentation), sum(retainedOverlay, retainedOverlay * 4, retainedOverlay ? 4096 : 0));
	const directCpuPeak = sum(physical, metadata.peakWorkingBytes - logicalBytes);
	const attemptedFallbackPeak = sum(directCpuPeak, floatCapture);
	phase('direct-cpu-before-attempt', directCpuPeak, 0);
	phase('fully-retired-gpu-to-cpu-fallback', attemptedFallbackPeak, 0);
	const maximumMask = Math.max(checkpoints.knownMaskComponentBytes, ...phases.map(value => value.maskBytes));
	const peak = Math.max(...phases.map(value => value.totalBytes));
	// graph/context .eligible are incomplete legacy CPU+GPU sums. Their
	// .supported + full oldCPU admission + this complete phase ledger replace
	// that SUM only once Root wires the private authority through every owner.
	const nativeSource = metadata.sourcePlan.descriptor.sampleFormat === 'unorm16' || metadata.sourcePlan.descriptor.sampleFormat === 'float32';
	const supported = nativeSource && !metadata.repairs && context.entries.every(entry => entry.graph.supported) && (overlay?.supported ?? true);
	const plan = Object.freeze({ checkpointPlan: checkpointValue, workingPlanComplete: true as const, contextPlan: contextValue, overlayPlan: overlayValue, phases: Object.freeze(phases),
		physicalSourceBytes: physical, floatCaptureBytes: floatCapture, imageTextureBytes: imageTextures, referenceBytes: reference,
		readbackBytes: readback, retainedBrushBytes: retainedBrush, brushAuthBytes: brushAuth, retainedStorageKeys,
		receiptBytes: receipt, contextStateBytes: context.stateBytes, retainedOverlayBytes: retainedOverlay, lutCaptureBytes: luts.capturePeakBytes,
		lutOracleBytes: luts.oracleBytes, lutUploadBytes: luts.uploadBytes, lutTextureBytes: luts.textureBytes,
		legacyMaskAdmissionBytes: checkpoints.knownMaskComponentBytes, maximumMaskComponentBytes: maximumMask,
		directCpuPeakBytes: directCpuPeak, attemptedFallbackPeakBytes: attemptedFallbackPeak, peakWorkingBytes: peak,
		directCpuEligible: directCpuPeak <= TOTAL, supported, eligible: supported && luts.eligible && maximumMask <= COMPONENT && peak <= TOTAL });
	PLANS.set(plan, plan); return plan;
}
export function readImageDevelopGpuMaskPhasePlanCurrentV1(value: unknown): Readonly<Prepared> {
	const plan = typeof value === 'object' && value !== null ? PLANS.get(value) : undefined;
	if (!plan) throw new TypeError('GPU phase requires its enrolled complete scalar ledger.'); return plan;
}
