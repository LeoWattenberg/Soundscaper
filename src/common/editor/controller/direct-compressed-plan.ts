/* SPDX-License-Identifier: AGPL-3.0-only */

import { getMediaExportFormat, normalizeMediaExportSettings } from '../media-export.js';
import { FAST_RENDER_THRESHOLDS } from '../export.js';
import { directAudioRenderStrategy, type DirectAudioRenderStrategy } from './direct-audio-render-plan.ts';

const DIRECT_COMPRESSED_FORMAT_IDS = new Set<DirectCompressedFormat>([
	'mp3', 'flac', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
]);
const REALTIME_REASONS = new Set(['output-memory', 'total-memory', 'offline-render-output-memory']);
const STANDARD_MAPPING_MODES = new Set(['preserve', 'mono', 'stereo']);

export type DirectCompressedFormat =
	| 'mp3'
	| 'flac'
	| 'ogg-vorbis'
	| 'opus'
	| 'wavpack'
	| 'mp2'
	| 'aac-m4a';

interface DirectCompressedOutputPlan {
	readonly fileName?: unknown;
	readonly includeMaster?: unknown;
	readonly kind?: unknown;
	readonly respectMuteSolo?: unknown;
	readonly trackId?: unknown;
}

export interface DirectCompressedPlan {
	readonly archive?: unknown;
	readonly channelCount?: unknown;
	readonly channelMapping?: unknown;
	readonly dither?: unknown;
	readonly ditherMode?: unknown;
	readonly encoding?: Readonly<Record<string, unknown>>;
	readonly format?: unknown;
	readonly metadata?: unknown;
	readonly mimeType?: unknown;
	readonly mode?: unknown;
	readonly outputBytesPerRender?: unknown;
	readonly outputFileBytesPerRender?: unknown;
	readonly outputFrames?: unknown;
	readonly outputs?: unknown;
	readonly range?: Readonly<Record<string, unknown>>;
	readonly render?: Readonly<Record<string, unknown>>;
	readonly requiredTemporaryBytes?: unknown;
	readonly sampleRate?: unknown;
	readonly tailFrames?: unknown;
}

interface DirectCompressedDescriptor {
	readonly backend: 'ffmpeg';
	readonly extension: string;
	readonly id: DirectCompressedFormat;
	readonly label: string;
	readonly maximumChannels: number;
	readonly mimeType: string;
}

export interface CanonicalCompressedPlanCore extends DirectCompressedDescriptor {
	readonly channelCount: number;
	readonly fingerprint: string;
	readonly inputChannelCount: number;
	readonly outputBytesPerRender: number;
	readonly outputFrames: number;
	readonly sampleRate: number;
}

export interface DirectCompressedContract extends DirectCompressedDescriptor {
	readonly fileName: string;
	readonly fileTypes: readonly Readonly<Record<string, unknown>>[];
	readonly fingerprint: string;
	readonly pickerMimeType: string;
	readonly renderStrategy: DirectAudioRenderStrategy;
	readonly stagingByteLength: number;
}

/** Capture route-independent canonical format, encoding, and PCM render geometry. */
export function captureCanonicalCompressedPlanCore(
	plan: DirectCompressedPlan,
): CanonicalCompressedPlanCore | null {
	try {
		const descriptor = canonicalDescriptor(plan?.format);
		if (!descriptor || !exactCanonicalCompressedPlanCore(plan, descriptor)) return null;
		return Object.freeze({
			...descriptor,
			channelCount: plan.channelCount as number,
			fingerprint: coreFingerprint(plan),
			inputChannelCount: Number(plan.encoding!.inputChannelCount),
			outputBytesPerRender: plan.outputBytesPerRender as number,
			outputFrames: plan.outputFrames as number,
			sampleRate: plan.sampleRate as number,
		});
	} catch {
		return null;
	}
}

export function captureDirectCompressedContract(
	plan: DirectCompressedPlan,
): DirectCompressedContract | null {
	try {
		const core = captureCanonicalCompressedPlanCore(plan);
		if (!core || !exactDirectCompressedPlan(plan, core)) return null;
		const renderStrategy = directAudioRenderStrategy(plan);
		if (!renderStrategy) return null;
		const extension = `.${core.extension}`;
		const pickerMimeType = core.mimeType.split(';', 1)[0]!.trim();
		return Object.freeze({
			backend: core.backend,
			extension: core.extension,
			id: core.id,
			label: core.label,
			maximumChannels: core.maximumChannels,
			mimeType: core.mimeType,
			fileName: (plan.outputs as readonly DirectCompressedOutputPlan[])[0]!.fileName as string,
			fileTypes: Object.freeze([Object.freeze({
				description: `${core.label} audio`,
				accept: Object.freeze({ [pickerMimeType]: Object.freeze([extension]) }),
			})]),
			fingerprint: planFingerprint(plan),
			pickerMimeType,
			renderStrategy,
			stagingByteLength: compressedStagingByteLength(plan, renderStrategy),
		});
	} catch {
		return null;
	}
}

function canonicalDescriptor(value: unknown): DirectCompressedDescriptor | null {
	if (typeof value !== 'string' || !DIRECT_COMPRESSED_FORMAT_IDS.has(value as DirectCompressedFormat)) return null;
	const descriptor = getMediaExportFormat(value) as Readonly<Record<string, unknown>>;
	if (descriptor.id !== value || descriptor.backend !== 'ffmpeg'
		|| typeof descriptor.extension !== 'string' || !descriptor.extension
		|| typeof descriptor.mimeType !== 'string' || !descriptor.mimeType
		|| typeof descriptor.label !== 'string' || !descriptor.label
		|| !safeIntegerInRange(descriptor.maximumChannels, 1, 32)) return null;
	return descriptor as unknown as DirectCompressedDescriptor;
}

function exactDirectCompressedPlan(
	plan: DirectCompressedPlan,
	descriptor: DirectCompressedDescriptor,
): boolean {
	const outputs = plan?.outputs;
	const render = plan?.render;
	const renderStrategy = directAudioRenderStrategy(plan);
	if (plan?.mode !== 'mix'
		|| plan.archive !== null
		|| plan.requiredTemporaryBytes !== plan.outputBytesPerRender
		|| !isRecord(render) || !canonicalRender(render, renderStrategy)
		|| !Array.isArray(outputs) || outputs.length !== 1 || !canonicalOutput(outputs[0], descriptor.extension)) return false;
	return planFingerprint(plan).length > 0;
}

function exactCanonicalCompressedPlanCore(
	plan: DirectCompressedPlan,
	descriptor: DirectCompressedDescriptor,
): boolean {
	const encoding = plan?.encoding;
	const range = plan?.range;
	const render = plan?.render;
	const sampleRate = plan?.sampleRate;
	const channelCount = plan?.channelCount;
	const outputFrames = plan?.outputFrames;
	return plan.format === descriptor.id && plan.mimeType === descriptor.mimeType
		&& plan.outputFileBytesPerRender === null
		&& safeIntegerInRange(sampleRate, 8_000, 384_000)
		&& safeIntegerInRange(channelCount, 1, descriptor.maximumChannels)
		&& safeIntegerInRange(outputFrames, 1, Number.MAX_SAFE_INTEGER)
		&& plan.outputBytesPerRender === multiplySafe(outputFrames as number, channelCount as number, 4)
		&& isRecord(range) && canonicalRange(range)
		&& safeIntegerInRange(plan.tailFrames, 0, Number.MAX_SAFE_INTEGER)
		&& isRecord(render) && canonicalRenderGeometry(render, plan.outputBytesPerRender as number)
		&& isRecord(plan.metadata) && isRecord(plan.channelMapping)
		&& isRecord(encoding) && canonicalEncoding(encoding, plan, descriptor)
		&& coreFingerprint(plan).length > 0;
}

function canonicalRender(
	render: Readonly<Record<string, unknown>>,
	strategy: DirectAudioRenderStrategy | null,
): boolean {
	if (strategy === 'offline') return true;
	return strategy === 'realtime-stream'
		&& render.strategy === 'realtime-stream'
		&& render.fast === false
		&& REALTIME_REASONS.has(String(render.reason));
}

function canonicalRenderGeometry(
	render: Readonly<Record<string, unknown>>,
	outputBytesPerRender: number,
): boolean {
	const actualThresholds = render.thresholds;
	if (render.outputBytes !== outputBytesPerRender
		|| !safeIntegerInRange(render.livePcmBytes, 0, Number.MAX_SAFE_INTEGER)
		|| !safeIntegerInRange(render.totalBytes, 1, Number.MAX_SAFE_INTEGER)
		|| render.totalBytes !== addSafe(outputBytesPerRender, Number(render.livePcmBytes))
		|| !isRecord(actualThresholds)) return false;
	const canonicalThresholds = Object.values(FAST_RENDER_THRESHOLDS) as readonly Readonly<{
		outputBytes: number;
		totalBytes: number;
	}>[];
	return canonicalThresholds.some((thresholds) => (
		thresholds.outputBytes === actualThresholds.outputBytes
		&& thresholds.totalBytes === actualThresholds.totalBytes
		&& sameKeys(actualThresholds, ['outputBytes', 'totalBytes'])
	));
}

function compressedStagingByteLength(
	plan: DirectCompressedPlan,
	strategy: DirectAudioRenderStrategy,
): number {
	if (strategy === 'realtime-stream') return plan.outputBytesPerRender as number;
	const encoding = plan.encoding!;
	const bytesPerSample = plan.format === 'flac' ? Number(encoding.bitDepth) / 8 : 4;
	return multiplySafe(
		plan.outputFrames as number,
		Number(encoding.inputChannelCount),
		bytesPerSample,
	);
}

function canonicalOutput(output: unknown, extension: string): boolean {
	if (!isRecord(output)) return false;
	const fileName = output.fileName;
	const suffix = `.${extension}`;
	return output.kind === 'mix' && output.trackId === null
		&& output.includeMaster === true && output.respectMuteSolo === true
		&& typeof fileName === 'string' && fileName.length > suffix.length
		&& fileName.toLowerCase().endsWith(suffix)
		&& !fileName.includes('\0') && !fileName.includes('/') && !fileName.includes('\\');
}

function canonicalRange(range: Readonly<Record<string, unknown>>): boolean {
	return sameKeys(range, ['startFrame', 'endFrame', 'durationFrames'])
		&& safeIntegerInRange(range.startFrame, 0, Number.MAX_SAFE_INTEGER)
		&& safeIntegerInRange(range.endFrame, 0, Number.MAX_SAFE_INTEGER)
		&& safeIntegerInRange(range.durationFrames, 1, Number.MAX_SAFE_INTEGER)
		&& Number(range.endFrame) > Number(range.startFrame)
		&& range.durationFrames === Number(range.endFrame) - Number(range.startFrame);
}

function coreFingerprint(plan: DirectCompressedPlan): string {
	const render = plan.render!;
	return jsonValue({
		format: plan.format, mimeType: plan.mimeType,
		sampleRate: plan.sampleRate, channelCount: plan.channelCount,
		outputFrames: plan.outputFrames, outputBytesPerRender: plan.outputBytesPerRender,
		outputFileBytesPerRender: plan.outputFileBytesPerRender,
		dither: plan.dither, ditherMode: plan.ditherMode,
		metadata: plan.metadata, channelMapping: plan.channelMapping, encoding: plan.encoding,
		range: plan.range, tailFrames: plan.tailFrames,
		render: {
			outputBytes: render.outputBytes,
			livePcmBytes: render.livePcmBytes,
			totalBytes: render.totalBytes,
			thresholds: render.thresholds,
		},
	});
}

function canonicalEncoding(
	encoding: Readonly<Record<string, unknown>>,
	plan: DirectCompressedPlan,
	descriptor: DirectCompressedDescriptor,
): boolean {
	if (!isRecord(encoding.channelMapping)) return false;
	const mode = encoding.channelMapping.mode;
	const channelMapping = typeof mode === 'string' && STANDARD_MAPPING_MODES.has(mode)
		? mode
		: encoding.channelMapping;
	let normalized: unknown;
	try {
		normalized = normalizeMediaExportSettings(descriptor.id, { ...encoding, channelMapping });
	} catch {
		return false;
	}
	return jsonValue(normalized) === jsonValue(encoding)
		&& encoding.sampleRate === plan.sampleRate && encoding.channelCount === plan.channelCount
		&& encoding.dither === plan.ditherMode
		&& plan.dither === (plan.ditherMode !== 'none')
		&& ['none', 'triangular', 'triangular-highpass'].includes(String(plan.ditherMode))
		&& isRecord(encoding.metadata)
		&& jsonValue(encoding.metadata) === jsonValue(plan.metadata)
		&& jsonValue(encoding.channelMapping) === jsonValue(plan.channelMapping);
}

function planFingerprint(plan: DirectCompressedPlan): string {
	return jsonValue({
		mode: plan.mode, format: plan.format, mimeType: plan.mimeType,
		sampleRate: plan.sampleRate, channelCount: plan.channelCount,
		outputFrames: plan.outputFrames, outputBytesPerRender: plan.outputBytesPerRender,
		outputFileBytesPerRender: plan.outputFileBytesPerRender,
		requiredTemporaryBytes: plan.requiredTemporaryBytes,
		dither: plan.dither, ditherMode: plan.ditherMode,
		metadata: plan.metadata, channelMapping: plan.channelMapping, encoding: plan.encoding,
		render: plan.render, range: plan.range, tailFrames: plan.tailFrames,
		outputs: plan.outputs, archive: plan.archive,
	});
}

function safeIntegerInRange(value: unknown, minimum: number, maximum: number): boolean {
	return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function multiplySafe(...values: readonly number[]): number {
	let result = 1;
	for (const value of values) {
		if (!Number.isSafeInteger(value) || value < 0 || (value && result > Math.floor(Number.MAX_SAFE_INTEGER / value))) {
			throw new RangeError('Direct compressed-audio staging geometry exceeds JavaScript safe integers.');
		}
		result *= value;
	}
	return result;
}

function addSafe(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0
		|| left > Number.MAX_SAFE_INTEGER - right) {
		throw new RangeError('Direct compressed-audio render geometry exceeds JavaScript safe integers.');
	}
	return left + right;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sameKeys(value: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean {
	const keys = Object.keys(value).sort();
	return keys.length === fields.length && [...fields].sort().every((field, index) => field === keys[index]);
}

function jsonValue(value: unknown): string {
	const result = JSON.stringify(value);
	if (typeof result !== 'string') throw new TypeError('Direct compressed-audio plan data is not serializable.');
	return result;
}
