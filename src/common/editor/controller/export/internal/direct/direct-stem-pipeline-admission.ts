/* SPDX-License-Identifier: AGPL-3.0-only */
import { captureDirectNativeStemArchiveContract } from './direct-native-stem-archive-plan.ts';

export const STEM_PIPELINE_ENCODED_ENTRY_LIMIT_BYTES = 32 * 1024 ** 2;
const ENCODING_SCRATCH_RESERVE_BYTES = 16 * 1024 ** 2;
export interface DirectStemPipelineAdmission { readonly heapBytes: number; readonly temporaryBytes: number; readonly entryBytes: number; readonly retryPcmBytes: number }

/** Reuse the existing render thresholds; reserve current+next encoded outputs and the next render/encoder workspace. */
export function admitDirectStemPipeline(planValue: unknown, sourceValue: unknown, optimizeFor: unknown): DirectStemPipelineAdmission | null {
	if (optimizeFor !== 'speed') return null;
	const contract = captureDirectNativeStemArchiveContract(planValue); const plan = record(planValue); const source = record(sourceValue);
	const render = record(plan?.render); const offline = record(render?.offlineRenderAdmission); const thresholds = record(render?.thresholds);
	const range = record(plan?.range);
	if (!contract || contract.outputs.length < 2 || contract.entryByteLength > STEM_PIPELINE_ENCODED_ENTRY_LIMIT_BYTES
		|| !plan || !source || render?.strategy !== 'offline' || render.fast !== true || offline?.admitted !== true
		|| plan.loudnessNormalization || plan.binaural || plan.masteringSequence || plan.adm
		// Resampling precedes channel mapping: encoded width cannot bound a wider source-rate renderer's target-rate arrays.
		|| plan.sampleRate !== source.sampleRate) return null;
	const numbers = [range?.durationFrames, plan.tailFrames, source.masterChannels, source.sampleRate, plan.outputBytesPerRender,
		render.livePcmBytes, offline.peakUsefulBinaryBytes, thresholds?.outputBytes, thresholds?.totalBytes];
	if (!numbers.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return null;
	const [frames, tail, channels, sourceRate, outputPcm, live, peak, outputLimit, totalLimit] = numbers as number[];
	if (!frames || !channels || !sourceRate || !outputPcm || !outputLimit || !totalLimit || outputPcm > outputLimit) return null;
	if (plan.outputFrames !== frames + tail! || typeof plan.channelCount !== 'number' || outputPcm !== plan.outputFrames * plan.channelCount * 4) return null;
	const retryPcmBytes = (frames + tail!) * channels * Float32Array.BYTES_PER_ELEMENT;
	// Output mapping/resampling, cropped/context PCM and buffered encoding can coexist. No second source/render graph is admitted.
	const heapBytes = live! + Math.max(peak!, retryPcmBytes * 2) + outputPcm * 2 + contract.entryByteLength * 2 + ENCODING_SCRATCH_RESERVE_BYTES;
	// Destination and origin scratch may share a volume; the capacity port does not subtract a pending archive reservation.
	const temporaryBytes = contract.archiveByteLength + contract.entryByteLength * 2 + retryPcmBytes;
	if (![retryPcmBytes, heapBytes, temporaryBytes].every(Number.isSafeInteger) || heapBytes > totalLimit) return null;
	return Object.freeze({ heapBytes, temporaryBytes, entryBytes: contract.entryByteLength, retryPcmBytes });
}
function record(value: unknown): Readonly<Record<string, unknown>> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null; }
