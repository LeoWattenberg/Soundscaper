/* SPDX-License-Identifier: AGPL-3.0-only */

import { getMediaExportFormat, normalizeMediaExportSettings } from '../media-export.js';

const DIRECT_COMPRESSED_FORMAT_IDS = new Set<DirectCompressedFormat>(['mp3']);
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

export interface DirectCompressedContract extends DirectCompressedDescriptor {
	readonly fileName: string;
	readonly fileTypes: readonly Readonly<Record<string, unknown>>[];
	readonly fingerprint: string;
	readonly pickerMimeType: string;
	readonly stagingByteLength: number;
}

export function captureDirectCompressedContract(
	plan: DirectCompressedPlan,
): DirectCompressedContract | null {
	try {
		const descriptor = canonicalDescriptor(plan?.format);
		if (!descriptor || !exactDirectCompressedPlan(plan, descriptor)) return null;
		const extension = `.${descriptor.extension}`;
		const pickerMimeType = descriptor.mimeType.split(';', 1)[0]!.trim();
		return Object.freeze({
			...descriptor,
			fileName: (plan.outputs as readonly DirectCompressedOutputPlan[])[0]!.fileName as string,
			fileTypes: Object.freeze([Object.freeze({
				description: `${descriptor.label} audio`,
				accept: Object.freeze({ [pickerMimeType]: Object.freeze([extension]) }),
			})]),
			fingerprint: planFingerprint(plan),
			pickerMimeType,
			stagingByteLength: plan.outputBytesPerRender as number,
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
	const encoding = plan?.encoding;
	const outputs = plan?.outputs;
	const range = plan?.range;
	const render = plan?.render;
	const sampleRate = plan?.sampleRate;
	const channelCount = plan?.channelCount;
	const outputFrames = plan?.outputFrames;
	if (plan?.mode !== 'mix' || plan.format !== descriptor.id || plan.mimeType !== descriptor.mimeType
		|| plan.archive !== null || plan.outputFileBytesPerRender !== null
		|| !safeIntegerInRange(sampleRate, 8_000, 384_000)
		|| !safeIntegerInRange(channelCount, 1, descriptor.maximumChannels)
		|| !safeIntegerInRange(outputFrames, 1, Number.MAX_SAFE_INTEGER)
		|| plan.outputBytesPerRender !== multiplySafe(outputFrames as number, channelCount as number, 4)
		|| plan.requiredTemporaryBytes !== plan.outputBytesPerRender
		|| !isRecord(range) || !canonicalRange(range)
		|| !safeIntegerInRange(plan.tailFrames, 0, Number.MAX_SAFE_INTEGER)
		|| !isRecord(render) || render.strategy !== 'realtime-stream' || render.fast !== false
		|| !REALTIME_REASONS.has(String(render.reason))
		|| !Array.isArray(outputs) || outputs.length !== 1 || !canonicalOutput(outputs[0], descriptor.extension)
		|| !isRecord(plan.metadata) || !isRecord(plan.channelMapping)
		|| !isRecord(encoding) || !canonicalEncoding(encoding, plan, descriptor)) return false;
	return planFingerprint(plan).length > 0;
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
	return safeIntegerInRange(range.startFrame, 0, Number.MAX_SAFE_INTEGER)
		&& safeIntegerInRange(range.endFrame, 0, Number.MAX_SAFE_INTEGER)
		&& safeIntegerInRange(range.durationFrames, 1, Number.MAX_SAFE_INTEGER)
		&& Number(range.endFrame) > Number(range.startFrame)
		&& range.durationFrames === Number(range.endFrame) - Number(range.startFrame);
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function jsonValue(value: unknown): string {
	const result = JSON.stringify(value);
	if (typeof result !== 'string') throw new TypeError('Direct compressed-audio plan data is not serializable.');
	return result;
}
