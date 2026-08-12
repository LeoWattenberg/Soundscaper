/* SPDX-License-Identifier: AGPL-3.0-only */

export const TRANSIENT_ANALYSIS_ALGORITHM = Object.freeze({
	id: 'soundscaper.pcm-transient-energy-flux',
	revision: 1,
});

export const TRANSIENT_ANALYSIS_LIMITS = Object.freeze({
	maximumChannels: 32,
	maximumWindowFrames: 1_048_576,
	maximumBaselineWindowHops: 4_096,
	maximumWorkingSetBytes: 256 * 1024 * 1024,
	maximumTransients: 1_000_000,
});

const FLOAT64_BYTES = Float64Array.BYTES_PER_ELEMENT;
const TRANSIENT_RECORD_USEFUL_BYTES = Float64Array.BYTES_PER_ELEMENT * 2;
const TRANSIENT_CANDIDATE_GENERATIONS = 2;

export type TransientAnalysisChannelPolicy = 'linked-peak' | 'mono-average';

export interface TransientAnalysisParameters {
	readonly windowFrames: number;
	readonly hopFrames: number;
	readonly baselineWindowHops: number;
	readonly sensitivity: number;
	readonly minimumSpacingFrames: number;
	readonly floorDbfs: number;
}

export const DEFAULT_TRANSIENT_ANALYSIS_PARAMETERS: Readonly<TransientAnalysisParameters> = Object.freeze({
	windowFrames: 1_024,
	hopFrames: 256,
	baselineWindowHops: 16,
	sensitivity: 1.5,
	minimumSpacingFrames: 2_048,
	floorDbfs: -72,
});

export interface TransientAnalysisSourceRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface PcmTransient {
	readonly sourceFrame: number;
	readonly strength: number;
}

export interface TransientAnalysisResult {
	readonly algorithmId: string;
	readonly algorithmRevision: number;
	readonly channelPolicy: TransientAnalysisChannelPolicy;
	readonly parameters: Readonly<TransientAnalysisParameters>;
	readonly sourceRange: Readonly<TransientAnalysisSourceRange>;
	readonly transients: readonly Readonly<PcmTransient>[];
}

export interface DetectPcmTransientsOptions {
	readonly sourceStartFrame?: number;
	readonly channelPolicy?: TransientAnalysisChannelPolicy;
	readonly parameters?: Partial<TransientAnalysisParameters>;
}

export interface TransientAnalysisAdmission {
	readonly frameCount: number;
	readonly windowCount: number;
	readonly maximumCandidateCount: number;
	readonly pcmBytes: number;
	readonly pcmCopyCount: number;
	readonly pcmResidentBytes: number;
	readonly decodedChunkBytes: number;
	readonly auxiliaryArrayBytes: number;
	readonly candidateBytes: number;
	readonly detectorWorkingSetBytes: number;
	readonly peakScratchBytes: number;
	readonly workingSetBytes: number;
}

export interface TransientAnalysisPcmAdmissionOptions {
	readonly channelCount?: number;
	readonly pcmCopyCount?: number;
	readonly sourceChunkFrames?: number;
	readonly sourceFrameCount?: number;
}

const PARAMETER_KEYS = Object.freeze([
	'windowFrames',
	'hopFrames',
	'baselineWindowHops',
	'sensitivity',
	'minimumSpacingFrames',
	'floorDbfs',
] as const);
const PARAMETER_KEY_SET = new Set<string>(PARAMETER_KEYS);

/** Normalize the complete deterministic detector recipe into a closed record. */
export function normalizeTransientAnalysisParameters(
	value: unknown = {},
): Readonly<TransientAnalysisParameters> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Transient analysis parameters must be an object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Transient analysis parameters must be a plain object.');
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !PARAMETER_KEY_SET.has(key)) {
			throw new RangeError(`Unknown transient analysis parameter: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Transient analysis parameter ${key} must be an enumerable data property.`);
		}
	}
	const candidate = value as Partial<TransientAnalysisParameters>;
	const windowFrames = boundedPositiveSafeInteger(
		candidate.windowFrames ?? DEFAULT_TRANSIENT_ANALYSIS_PARAMETERS.windowFrames,
		'windowFrames',
		TRANSIENT_ANALYSIS_LIMITS.maximumWindowFrames,
	);
	const hopFrames = boundedPositiveSafeInteger(
		candidate.hopFrames ?? DEFAULT_TRANSIENT_ANALYSIS_PARAMETERS.hopFrames,
		'hopFrames',
		windowFrames,
	);
	const baselineWindowHops = boundedPositiveSafeInteger(
		candidate.baselineWindowHops ?? DEFAULT_TRANSIENT_ANALYSIS_PARAMETERS.baselineWindowHops,
		'baselineWindowHops',
		TRANSIENT_ANALYSIS_LIMITS.maximumBaselineWindowHops,
	);
	const sensitivity = finiteInRange(
		candidate.sensitivity ?? DEFAULT_TRANSIENT_ANALYSIS_PARAMETERS.sensitivity,
		1,
		100,
		'sensitivity',
	);
	const minimumSpacingFrames = nonNegativeSafeInteger(
		candidate.minimumSpacingFrames ?? DEFAULT_TRANSIENT_ANALYSIS_PARAMETERS.minimumSpacingFrames,
		'minimumSpacingFrames',
	);
	const floorDbfs = finiteInRange(
		candidate.floorDbfs ?? DEFAULT_TRANSIENT_ANALYSIS_PARAMETERS.floorDbfs,
		-160,
		0,
		'floorDbfs',
	);
	return Object.freeze({
		windowFrames,
		hopFrames,
		baselineWindowHops,
		sensitivity: canonicalZero(sensitivity),
		minimumSpacingFrames,
		floorDbfs: canonicalZero(floorDbfs),
	});
}

export function normalizeTransientAnalysisChannelPolicy(
	value: unknown = 'linked-peak',
): TransientAnalysisChannelPolicy {
	if (value !== 'linked-peak' && value !== 'mono-average') {
		throw new TypeError('Transient analysis channel policy must be linked-peak or mono-average.');
	}
	return value;
}

/** Admit PCM ownership, exact detector arrays, and a conservative candidate payload together. */
export function planTransientAnalysisAdmission(
	frameCountValue: unknown,
	parametersValue: unknown = {},
	pcmValue: Readonly<TransientAnalysisPcmAdmissionOptions> = {},
): Readonly<TransientAnalysisAdmission> {
	const frameCount = nonNegativeSafeInteger(frameCountValue, 'Transient analysis frame count');
	const parameters = normalizeTransientAnalysisParameters(parametersValue);
	const channelCount = boundedNonNegativeSafeInteger(
		pcmValue.channelCount ?? 0,
		'Transient analysis PCM channel count',
		TRANSIENT_ANALYSIS_LIMITS.maximumChannels,
	);
	const pcmCopyCount = channelCount === 0 ? 0 : boundedPositiveSafeInteger(
		pcmValue.pcmCopyCount ?? 1,
		'Transient analysis PCM copy count',
		2,
	);
	const sourceChunkFrames = channelCount === 0 ? 0 : boundedNonNegativeSafeInteger(
		pcmValue.sourceChunkFrames ?? 0,
		'Transient analysis source chunk frames',
		Number.MAX_SAFE_INTEGER,
	);
	const sourceFrameCount = channelCount === 0 ? 0 : boundedNonNegativeSafeInteger(
		pcmValue.sourceFrameCount ?? frameCount,
		'Transient analysis source frame count',
		Number.MAX_SAFE_INTEGER,
	);
	const windowCount = Math.ceil(frameCount / parameters.hopFrames);
	const maximumCandidateCount = Math.min(
		windowCount,
		TRANSIENT_ANALYSIS_LIMITS.maximumTransients,
	);
	if (windowCount > TRANSIENT_ANALYSIS_LIMITS.maximumTransients) {
		throw new RangeError(
			`Transient analysis would inspect ${String(windowCount)} windows, exceeding the ${String(TRANSIENT_ANALYSIS_LIMITS.maximumTransients)}-window output bound.`,
		);
	}
	const pcmBytes = checkedProduct(
		checkedProduct(frameCount, channelCount),
		Float32Array.BYTES_PER_ELEMENT,
	);
	const pcmResidentBytes = checkedProduct(pcmBytes, pcmCopyCount);
	const decodedChunkBytes = checkedProduct(
		checkedProduct(Math.min(sourceFrameCount, sourceChunkFrames), channelCount),
		Float32Array.BYTES_PER_ELEMENT,
	);
	const auxiliaryArrayBytes = checkedProduct(windowCount, 3 * FLOAT64_BYTES);
	// result() freezes a second candidate generation while the detector's
	// mutable candidate list is still live.
	const candidateBytes = checkedProduct(
		maximumCandidateCount,
		TRANSIENT_RECORD_USEFUL_BYTES * TRANSIENT_CANDIDATE_GENERATIONS,
	);
	const detectorWorkingSetBytes = checkedAdd(auxiliaryArrayBytes, candidateBytes);
	const peakScratchBytes = Math.max(decodedChunkBytes, detectorWorkingSetBytes);
	const workingSetBytes = checkedAdd(pcmResidentBytes, peakScratchBytes);
	if (workingSetBytes > TRANSIENT_ANALYSIS_LIMITS.maximumWorkingSetBytes) {
		throw new RangeError(
			`Transient analysis needs ${String(workingSetBytes)} aggregate PCM and detector working-set bytes, exceeding the ${String(TRANSIENT_ANALYSIS_LIMITS.maximumWorkingSetBytes)}-byte bound.`,
		);
	}
	return Object.freeze({
		frameCount,
		windowCount,
		maximumCandidateCount,
		pcmBytes,
		pcmCopyCount,
		pcmResidentBytes,
		decodedChunkBytes,
		auxiliaryArrayBytes,
		candidateBytes,
		detectorWorkingSetBytes,
		peakScratchBytes,
		workingSetBytes,
	});
}

/**
 * Detect attacks from deterministic forward-window energy flux. Candidate
 * windows are refined to the earliest strongest source sample, then a stable
 * minimum-spacing pass keeps the stronger neighboring attack.
 */
export function detectPcmTransients(
	channels: readonly Float32Array[],
	options: Readonly<DetectPcmTransientsOptions> = {},
): Readonly<TransientAnalysisResult> {
	const frameCount = validatePcmChannels(channels);
	const sourceStartFrame = nonNegativeSafeInteger(options.sourceStartFrame ?? 0, 'sourceStartFrame');
	const sourceEndFrame = safeAdd(sourceStartFrame, frameCount, 'Transient analysis source range');
	const channelPolicy = normalizeTransientAnalysisChannelPolicy(options.channelPolicy);
	const parameters = normalizeTransientAnalysisParameters(options.parameters);
	const sourceRange = Object.freeze({ startFrame: sourceStartFrame, endFrame: sourceEndFrame });
	if (frameCount === 0) return result(channelPolicy, parameters, sourceRange, []);

	const { windowCount } = planTransientAnalysisAdmission(frameCount, parameters, {
		channelCount: channels.length,
	});
	const levels = new Float64Array(windowCount);
	const peakFrames = new Float64Array(windowCount);
	for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
		const start = windowIndex * parameters.hopFrames;
		const end = Math.min(frameCount, start + parameters.windowFrames);
		let squareSum = 0;
		let peak = -1;
		let peakFrame = start;
		for (let frame = start; frame < end; frame += 1) {
			const amplitude = aggregateAmplitude(channels, frame, channelPolicy);
			squareSum += amplitude * amplitude;
			if (amplitude > peak) {
				peak = amplitude;
				peakFrame = frame;
			}
		}
		levels[windowIndex] = end > start ? Math.sqrt(squareSum / (end - start)) : 0;
		peakFrames[windowIndex] = peakFrame;
	}

	const novelty = new Float64Array(windowCount);
	novelty[0] = levels[0]!;
	for (let index = 1; index < windowCount; index += 1) {
		novelty[index] = Math.max(0, levels[index]! - levels[index - 1]!);
	}
	const floorAmplitude = 10 ** (parameters.floorDbfs / 20);
	const candidates: PcmTransient[] = [];
	let baselineSum = 0;
	for (let index = 0; index < windowCount; index += 1) {
		const expired = index - parameters.baselineWindowHops - 1;
		if (expired >= 0) baselineSum -= novelty[expired]!;
		const baselineCount = Math.min(index, parameters.baselineWindowHops);
		const threshold = Math.max(
			floorAmplitude,
			baselineCount > 0 ? baselineSum / baselineCount * parameters.sensitivity : 0,
		);
		const current = novelty[index]!;
		const previous = novelty[index - 1] ?? 0;
		const next = novelty[index + 1] ?? 0;
		if (current >= threshold && current > 0 && current >= previous && current > next) {
			const sourceFrame = safeAdd(
				sourceStartFrame,
				peakFrames[index]!,
				'Transient source frame',
			);
			const strength = quantizedStrength(current / Math.max(levels[index]!, floorAmplitude));
			admitSpacedCandidate(candidates, { sourceFrame, strength }, parameters.minimumSpacingFrames);
		}
		baselineSum += current;
	}
	return result(channelPolicy, parameters, sourceRange, candidates);
}

function validatePcmChannels(channels: readonly Float32Array[]): number {
	if (!Array.isArray(channels) || channels.length < 1
		|| channels.length > TRANSIENT_ANALYSIS_LIMITS.maximumChannels) {
		throw new RangeError(
			`Transient analysis requires 1 to ${String(TRANSIENT_ANALYSIS_LIMITS.maximumChannels)} PCM channels.`,
		);
	}
	const frameCount = channels[0] instanceof Float32Array ? channels[0].length : -1;
	if (frameCount < 0 || channels.some((channel) => (
		!(channel instanceof Float32Array) || channel.length !== frameCount
	))) {
		throw new RangeError('Transient analysis PCM channels must be equally sized Float32Array values.');
	}
	for (const channel of channels) {
		for (const sample of channel) {
			if (!Number.isFinite(sample)) throw new RangeError('Transient analysis requires finite PCM samples.');
		}
	}
	return frameCount;
}

function aggregateAmplitude(
	channels: readonly Float32Array[],
	frame: number,
	policy: TransientAnalysisChannelPolicy,
): number {
	if (policy === 'linked-peak') {
		let peak = 0;
		for (const channel of channels) peak = Math.max(peak, Math.abs(channel[frame]!));
		return peak;
	}
	let sum = 0;
	for (const channel of channels) sum += channel[frame]!;
	return Math.abs(sum / channels.length);
}

function admitSpacedCandidate(
	candidates: PcmTransient[],
	candidate: PcmTransient,
	minimumSpacingFrames: number,
): void {
	const previous = candidates.at(-1);
	if (!previous || (candidate.sourceFrame > previous.sourceFrame
		&& candidate.sourceFrame - previous.sourceFrame >= minimumSpacingFrames)) {
		candidates.push(candidate);
		return;
	}
	if (candidate.strength > previous.strength) candidates[candidates.length - 1] = candidate;
}

function result(
	channelPolicy: TransientAnalysisChannelPolicy,
	parameters: Readonly<TransientAnalysisParameters>,
	sourceRange: Readonly<TransientAnalysisSourceRange>,
	transients: readonly PcmTransient[],
): Readonly<TransientAnalysisResult> {
	return Object.freeze({
		algorithmId: TRANSIENT_ANALYSIS_ALGORITHM.id,
		algorithmRevision: TRANSIENT_ANALYSIS_ALGORITHM.revision,
		channelPolicy,
		parameters,
		sourceRange,
		transients: Object.freeze(transients.map((transient) => Object.freeze({ ...transient }))),
	});
}

function quantizedStrength(value: number): number {
	const quantized = Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
	return Math.max(0.000001, quantized);
}

function boundedPositiveSafeInteger(value: unknown, field: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${field} must be a positive safe integer no greater than ${String(maximum)}.`);
	}
	return Number(value);
}

function boundedNonNegativeSafeInteger(value: unknown, field: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
		throw new RangeError(`${field} must be a non-negative safe integer no greater than ${String(maximum)}.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} must be a non-negative safe integer.`);
	}
	return canonicalZero(Number(value));
}

function finiteInRange(value: unknown, minimum: number, maximum: number, field: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${field} must be finite from ${String(minimum)} through ${String(maximum)}.`);
	}
	return value;
}

function safeAdd(left: number, right: number, field: string): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)
		|| right > Number.MAX_SAFE_INTEGER - left) {
		throw new RangeError(`${field} exceeds the supported safe integer range.`);
	}
	return left + right;
}

function checkedProduct(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)
		|| left < 0 || right < 0 || (left !== 0 && right > Number.MAX_SAFE_INTEGER / left)) {
		throw new RangeError('Transient analysis working-set multiplication exceeds the safe integer range.');
	}
	return left * right;
}

function checkedAdd(left: number, right: number): number {
	if (right > Number.MAX_SAFE_INTEGER - left) {
		throw new RangeError('Transient analysis working-set addition exceeds the safe integer range.');
	}
	return left + right;
}

function canonicalZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
