/* SPDX-License-Identifier: AGPL-3.0-only */

import { getMediaExportFormat, normalizeMediaExportSettings } from '../media-export.js';
import { FAST_RENDER_THRESHOLDS } from '../export.js';
import {
	MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES,
	OfflineRenderOutputMemoryLimitError,
	planOfflineRenderOutputAdmission,
	type OfflineRenderOutputGeometry,
} from '../engine/offline-render-admission.ts';
import { directAudioRenderStrategy, type DirectAudioRenderStrategy } from './direct-audio-render-plan.ts';

const DIRECT_COMPRESSED_FORMAT_IDS = new Set<DirectCompressedFormat>([
	'mp3', 'flac', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
]);
const REALTIME_REASONS = new Set(['output-memory', 'total-memory', 'offline-render-output-memory']);
const STANDARD_MAPPING_MODES = new Set(['preserve', 'mono', 'stereo']);
const COMPRESSED_PLAN_FIELDS = Object.freeze([
	'mode', 'format', 'mimeType', 'sampleRate', 'channelCount', 'channelMapping',
	'encoding', 'dither', 'ditherMode', 'metadata', 'range', 'tailFrames',
	'outputFrames', 'outputBytesPerRender', 'outputFileBytesPerRender',
	'requiredTemporaryBytes', 'render', 'outputs', 'archive',
]);
const REALTIME_RENDER_FIELDS = Object.freeze([
	'strategy', 'fast', 'outputBytes', 'livePcmBytes', 'totalBytes', 'thresholds', 'reason',
]);
const OFFLINE_ADMISSION_FIELDS = Object.freeze([
	'admitted', 'strategy', 'reason', 'geometry', 'preRollFrames', 'graphLatencyFrames',
	'peakUsefulBinaryBytes', 'maximumUsefulBinaryBytes', 'outputAdmission',
]);
const OFFLINE_GEOMETRY_FIELDS = Object.freeze([
	'channelCount', 'sampleRate', 'contextFrames', 'captureOffsetFrames', 'requestedFrames',
]);

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

export interface CanonicalRealtimeCompressedPlanCapture {
	readonly core: CanonicalCompressedPlanCore;
	readonly plan: DirectCompressedPlan;
}

export interface DirectCompressedContract extends DirectCompressedDescriptor {
	readonly fileName: string;
	readonly fileTypes: readonly Readonly<Record<string, unknown>>[];
	readonly fingerprint: string;
	readonly pickerMimeType: string;
	readonly renderStrategy: DirectAudioRenderStrategy;
	readonly stagingByteLength: number;
}

/** Fingerprint a closed plain-data snapshot without invoking serialization hooks. */
export function fingerprintCanonicalCompressedSnapshot(value: unknown): string | null {
	try { return jsonValue(value); } catch { return null; }
}

/** Capture route-independent canonical format, encoding, and PCM render geometry. */
export function captureCanonicalCompressedPlanCore(
	plan: DirectCompressedPlan,
): CanonicalCompressedPlanCore | null {
	try {
		const snapshot = capturePlanSnapshot(plan);
		if (!snapshot) return null;
		return captureCanonicalCore(snapshot);
	} catch {
		return null;
	}
}

/** Own one canonical realtime plan snapshot for downstream route admission. */
export function captureCanonicalRealtimeCompressedPlan(
	plan: DirectCompressedPlan,
): CanonicalRealtimeCompressedPlanCapture | null {
	try {
		const snapshot = capturePlanSnapshot(plan);
		const core = snapshot ? captureCanonicalCore(snapshot) : null;
		if (!snapshot || !core || !isRecord(snapshot.render)
			|| !canonicalRender(snapshot.render, 'realtime-stream', snapshot)) return null;
		return Object.freeze({ core, plan: snapshot });
	} catch {
		return null;
	}
}

function captureCanonicalCore(
	plan: DirectCompressedPlan,
): CanonicalCompressedPlanCore | null {
	try {
		const descriptor = canonicalDescriptor(plan.format);
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
		const snapshot = capturePlanSnapshot(plan);
		if (!snapshot) return null;
		const core = captureCanonicalCore(snapshot);
		if (!core || !exactDirectCompressedPlan(snapshot, core)) return null;
		const renderStrategy = directAudioRenderStrategy(snapshot);
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
			fileName: (snapshot.outputs as readonly DirectCompressedOutputPlan[])[0]!.fileName as string,
			fileTypes: Object.freeze([Object.freeze({
				description: `${core.label} audio`,
				accept: Object.freeze({ [pickerMimeType]: Object.freeze([extension]) }),
			})]),
			fingerprint: planFingerprint(snapshot),
			pickerMimeType,
			renderStrategy,
			stagingByteLength: compressedStagingByteLength(snapshot, renderStrategy),
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

function capturePlanSnapshot(plan: DirectCompressedPlan): DirectCompressedPlan | null {
	if (!isPlainRecord(plan) || !safeRecordEnvelope(plan)) return null;
	const snapshot = Object.create(null) as Record<string, unknown>;
	for (const field of COMPRESSED_PLAN_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(plan, field);
		if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
		Object.defineProperty(snapshot, field, {
			value: cloneCanonicalValue(descriptor.value),
			enumerable: true,
			writable: false,
			configurable: false,
		});
	}
	return Object.freeze(snapshot) as DirectCompressedPlan;
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
		|| !isRecord(render) || !canonicalRender(render, renderStrategy, plan)
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
	plan: DirectCompressedPlan,
): boolean {
	if (strategy === 'offline') return true;
	if (strategy !== 'realtime-stream'
		|| render.strategy !== 'realtime-stream'
		|| render.fast !== false
		|| !REALTIME_REASONS.has(String(render.reason))) return false;
	const thresholds = render.thresholds as Readonly<Record<string, unknown>>;
	if (render.reason === 'output-memory') {
		return !Object.hasOwn(render, 'offlineRenderAdmission')
			&& Number(render.outputBytes) > Number(thresholds.outputBytes);
	}
	if (render.reason === 'total-memory') {
		return !Object.hasOwn(render, 'offlineRenderAdmission')
			&& Number(render.outputBytes) <= Number(thresholds.outputBytes)
			&& Number(render.totalBytes) > Number(thresholds.totalBytes);
	}
	return Number(render.outputBytes) <= Number(thresholds.outputBytes)
		&& Number(render.totalBytes) <= Number(thresholds.totalBytes)
		&& canonicalRealtimeOfflineRefusal(render.offlineRenderAdmission, plan);
}

function canonicalRenderGeometry(
	render: Readonly<Record<string, unknown>>,
	outputBytesPerRender: number,
): boolean {
	const actualThresholds = render.thresholds;
	const renderFields = Object.hasOwn(render, 'offlineRenderAdmission')
		? [...REALTIME_RENDER_FIELDS, 'offlineRenderAdmission']
		: REALTIME_RENDER_FIELDS;
	if (!sameKeys(render, renderFields)
		|| render.outputBytes !== outputBytesPerRender
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

function canonicalRealtimeOfflineRefusal(
	value: unknown,
	plan: DirectCompressedPlan,
): boolean {
	const admission = isRecord(value) ? value : null;
	const geometry = admission && isRecord(admission.geometry) ? admission.geometry : null;
	const range = plan.range!;
	const encoding = plan.encoding!;
	if (!admission || !geometry
		|| !sameKeys(admission, OFFLINE_ADMISSION_FIELDS)
		|| !sameKeys(geometry, OFFLINE_GEOMETRY_FIELDS)
		|| admission.admitted !== false
		|| admission.strategy !== 'realtime-stream'
		|| admission.reason !== 'offline-render-output-memory'
		|| admission.outputAdmission !== null
		|| admission.maximumUsefulBinaryBytes !== MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES
		|| !safeIntegerInRange(admission.preRollFrames, 0, Number.MAX_SAFE_INTEGER)
		|| !safeIntegerInRange(admission.graphLatencyFrames, 0, Number.MAX_SAFE_INTEGER)
		|| !safeIntegerInRange(admission.peakUsefulBinaryBytes, 1, Number.MAX_SAFE_INTEGER)
		|| Number(admission.peakUsefulBinaryBytes) <= Number(admission.maximumUsefulBinaryBytes)
		|| !safeIntegerInRange(geometry.channelCount, 1, 32)
		|| !safeIntegerInRange(geometry.sampleRate, 1, Number.MAX_SAFE_INTEGER)
		|| !safeIntegerInRange(geometry.contextFrames, 1, Number.MAX_SAFE_INTEGER)
		|| !safeIntegerInRange(geometry.captureOffsetFrames, 0, Number.MAX_SAFE_INTEGER)
		|| !safeIntegerInRange(geometry.requestedFrames, 1, Number.MAX_SAFE_INTEGER)
		|| geometry.channelCount !== encoding.inputChannelCount) return false;
	try {
		const requestedFrames = addSafe(Number(range.durationFrames), Number(plan.tailFrames));
		const captureOffsetFrames = addSafe(
			Number(admission.preRollFrames), Number(admission.graphLatencyFrames),
		);
		if (geometry.requestedFrames !== requestedFrames
			|| geometry.captureOffsetFrames !== captureOffsetFrames
			|| geometry.contextFrames !== addSafe(captureOffsetFrames, requestedFrames)
			|| admission.preRollFrames !== exactPreRollFrames(
				Number(range.startFrame), Number(geometry.sampleRate),
			)
			|| plan.outputFrames !== addSafe(
				ceilScaledFrames(Number(range.durationFrames), Number(plan.sampleRate), Number(geometry.sampleRate)),
				ceilScaledFrames(Number(plan.tailFrames), Number(plan.sampleRate), Number(geometry.sampleRate)),
			)) return false;
		planOfflineRenderOutputAdmission(
			geometry as unknown as OfflineRenderOutputGeometry,
			{ maximumUsefulBinaryBytes: Number(admission.maximumUsefulBinaryBytes) },
		);
		return false;
	} catch (error) {
		return error instanceof OfflineRenderOutputMemoryLimitError
			&& error.peakUsefulBinaryBytes === admission.peakUsefulBinaryBytes
			&& error.maximumUsefulBinaryBytes === admission.maximumUsefulBinaryBytes;
	}
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
	return sameKeys(output, ['kind', 'fileName', 'trackId', 'includeMaster', 'respectMuteSolo'])
		&& output.kind === 'mix' && output.trackId === null
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

function ceilScaledFrames(frames: number, outputRate: number, inputRate: number): number {
	if (!safeIntegerInRange(frames, 0, Number.MAX_SAFE_INTEGER)
		|| !safeIntegerInRange(outputRate, 1, Number.MAX_SAFE_INTEGER)
		|| !safeIntegerInRange(inputRate, 1, Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Direct compressed-audio rate conversion geometry is invalid.');
	}
	const result = (BigInt(frames) * BigInt(outputRate) + BigInt(inputRate) - 1n) / BigInt(inputRate);
	if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Direct compressed-audio rate conversion exceeds JavaScript safe integers.');
	}
	return Number(result);
}

function exactPreRollFrames(rangeStartFrame: number, sampleRate: number): number {
	if (!safeIntegerInRange(rangeStartFrame, 0, Number.MAX_SAFE_INTEGER)
		|| !safeIntegerInRange(sampleRate, 1, Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Direct compressed-audio pre-roll geometry is invalid.');
	}
	const maximum = BigInt(sampleRate) * 10n;
	return Number(BigInt(rangeStartFrame) < maximum ? BigInt(rangeStartFrame) : maximum);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	if (!isRecord(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function safeRecordEnvelope(value: Readonly<Record<string, unknown>>): boolean {
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') return false;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
		if (key === 'toJSON' && typeof descriptor.value === 'function') return false;
	}
	return true;
}

function sameKeys(value: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean {
	const keys = Reflect.ownKeys(value).sort((left, right) => String(left).localeCompare(String(right)));
	return keys.length === fields.length && [...fields].sort().every((field, index) => field === keys[index]);
}

function jsonValue(value: unknown): string {
	return serializeCanonicalValue(cloneCanonicalValue(value));
}

type CanonicalValue = null | boolean | number | string | CanonicalArray | CanonicalRecord;
interface CanonicalArray extends ReadonlyArray<CanonicalValue> {
	readonly __canonicalArrayBrand?: never;
}
interface CanonicalRecord { readonly [key: string]: CanonicalValue }

function cloneCanonicalValue(value: unknown, ancestors = new WeakSet<object>()): CanonicalValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('Direct compressed-audio plan numbers must be finite.');
		return value;
	}
	if (!value || typeof value !== 'object') {
		throw new TypeError('Direct compressed-audio plan data must contain only plain JSON values.');
	}
	if (ancestors.has(value)) throw new TypeError('Direct compressed-audio plan data cannot contain cycles.');
	ancestors.add(value);
	try {
		if (Array.isArray(value)) return cloneCanonicalArray(value, ancestors);
		if (!isPlainRecord(value) || !safeRecordEnvelope(value)) {
			throw new TypeError('Direct compressed-audio plan records must be plain data objects.');
		}
		const result = Object.create(null) as Record<string, CanonicalValue>;
		for (const key of Object.keys(value).sort()) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
			Object.defineProperty(result, key, {
				value: cloneCanonicalValue(descriptor.value, ancestors),
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return Object.freeze(result);
	} finally {
		ancestors.delete(value);
	}
}

function cloneCanonicalArray(value: unknown[], ancestors: WeakSet<object>): CanonicalArray {
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Direct compressed-audio plan arrays must use the built-in array prototype.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== value.length + 1 || !keys.includes('length')) {
		throw new TypeError('Direct compressed-audio plan arrays must be dense and cannot have extra fields.');
	}
	const result: CanonicalValue[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
			throw new TypeError('Direct compressed-audio plan arrays must contain own data entries.');
		}
		result.push(cloneCanonicalValue(descriptor.value, ancestors));
	}
	return Object.freeze(result);
}

function serializeCanonicalValue(value: CanonicalValue): string {
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
	if (Array.isArray(value)) return `[${value.map(serializeCanonicalValue).join(',')}]`;
	const record = value as CanonicalRecord;
	return `{${Object.keys(record).sort().map((key) => (
		`${JSON.stringify(key)}:${serializeCanonicalValue(record[key]!)}`
	)).join(',')}}`;
}
