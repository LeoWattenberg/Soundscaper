/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../ffmpeg-output-stream.ts';

const MP3_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'MP3 audio',
	accept: Object.freeze({ 'audio/mpeg': Object.freeze(['.mp3']) }),
})]);
const MP3_BIT_RATES = new Set([128, 192, 256, 320]);
const REALTIME_REASONS = new Set(['output-memory', 'total-memory', 'offline-render-output-memory']);

type Awaitable<Value> = PromiseLike<Value> | Value;

interface DirectMp3OutputPlan {
	readonly fileName?: unknown;
	readonly includeMaster?: unknown;
	readonly kind?: unknown;
	readonly respectMuteSolo?: unknown;
	readonly trackId?: unknown;
}

interface DirectMp3Encoding {
	readonly backend?: unknown;
	readonly bitDepth?: unknown;
	readonly bitRate?: unknown;
	readonly channelCount?: unknown;
	readonly channelMapping?: unknown;
	readonly dither?: unknown;
	readonly extension?: unknown;
	readonly floatingPoint?: unknown;
	readonly format?: unknown;
	readonly inputChannelCount?: unknown;
	readonly metadata?: unknown;
	readonly mimeType?: unknown;
	readonly sampleFormat?: unknown;
	readonly sampleRate?: unknown;
}

interface DirectMp3Plan {
	readonly archive?: unknown;
	readonly channelCount?: unknown;
	readonly channelMapping?: unknown;
	readonly dither?: unknown;
	readonly ditherMode?: unknown;
	readonly encoding?: DirectMp3Encoding;
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

interface DirectMp3FileService {
	readonly prepareSave?: (
		request: Readonly<Record<string, unknown>>,
	) => PromiseLike<unknown> | unknown;
}

interface PreparedMp3Stream {
	readonly mode: 'stream';
	createWritable(byteLength: number, sizeMode: 'exact'): Promise<WritableStream<Uint8Array>>;
	bytesWritten(): number;
	commit(): Awaitable<Readonly<Record<string, unknown>>>;
	abort(reason?: unknown): Awaitable<unknown>;
}

interface DirectMp3Contract {
	readonly fileName: string;
	readonly fingerprint: string;
	readonly stagingByteLength: number;
}

interface DirectMp3FfmpegResult {
	readonly byteLength?: unknown;
	readonly chunkCount?: unknown;
	readonly extension?: unknown;
	readonly mimeType?: unknown;
	readonly output?: unknown;
}

interface DirectMp3Ffmpeg {
	encodeFileToSink(
		file: Blob,
		format: 'mp3',
		sink: FfmpegOutputSink<DirectMp3Destination>,
		settings: Readonly<Record<string, unknown>>,
	): PromiseLike<DirectMp3FfmpegResult>;
}

export interface DirectMp3Destination extends FfmpegOutputSink<DirectMp3Destination> {
	bytesWritten(): number;
	exactByteLength(): number | null;
	commit(): Promise<Readonly<Record<string, unknown>>>;
}

export type DirectMp3Preparation = Readonly<{
	cancelled: Readonly<Record<string, unknown>> | null;
	destination: DirectMp3Destination | null;
}>;

export interface DirectMp3EncodeOptions {
	readonly abortStagedFile?: (reason?: unknown) => Awaitable<void>;
	readonly assertCurrent: () => void;
	readonly cleanupStagedFile: () => Awaitable<void>;
	readonly destination: DirectMp3Destination;
	readonly encodingSettings: Readonly<Record<string, unknown>>;
	readonly ffmpeg: DirectMp3Ffmpeg;
	readonly plan: DirectMp3Plan;
	readonly signal: AbortSignal;
	readonly stagedFile: Blob;
}

export type DirectMp3EncodedOutput = Readonly<{
	byteLength: number;
	directDestination: DirectMp3Destination;
	mimeType: 'audio/mpeg';
}>;

const preparedContracts = new WeakMap<DirectMp3Destination, DirectMp3Contract>();

/** Select an MP3 target without opening its exact-size writer before FFmpeg stats the output. */
export async function prepareDirectMp3Destination(
	fileService: DirectMp3FileService,
	plan: DirectMp3Plan,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectMp3Preparation> {
	const contract = captureContract(plan);
	if (!contract || typeof fileService.prepareSave !== 'function') return emptyPreparation();
	const settings = requestedSettings || {};
	const prepared = await fileService.prepareSave({
		purpose: 'audio',
		suggestedName: contract.fileName,
		mimeType: 'audio/mpeg',
		target: settings.saveTarget,
		types: MP3_FILE_TYPES,
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
	if (!prepared || typeof prepared !== 'object') {
		throw new TypeError('The prepared MP3 destination is invalid.');
	}
	const mode = (prepared as Readonly<{ mode?: unknown }>).mode;
	if (mode === 'cancelled') {
		return Object.freeze({
			cancelled: prepared as Readonly<Record<string, unknown>>,
			destination: null,
		});
	}
	if (mode === 'blob') return emptyPreparation();
	if (mode !== 'stream') throw new TypeError('The prepared MP3 destination has an unsupported mode.');
	const stream = prepared as PreparedMp3Stream;
	assertPreparedStream(stream);
	const destination = directMp3Destination(stream, plan, contract);
	preparedContracts.set(destination, contract);
	try {
		assertPreparedPlan(destination, plan);
	} catch (error) {
		throw await abortWithPrimary(destination, error);
	}
	return Object.freeze({ cancelled: null, destination });
}

/** The direct route retains only the staged realtime WAV, never an encoded MP3 Blob. */
export function directMp3StagingTemporaryBytes(plan: DirectMp3Plan): number | null {
	return captureContract(plan)?.stagingByteLength ?? null;
}

/** Transcode one staged WAV through bounded FFmpeg ranges into the prepared target. */
export async function encodeDirectMp3StagedFile(
	options: DirectMp3EncodeOptions,
): Promise<DirectMp3EncodedOutput> {
	let result: DirectMp3EncodedOutput | null = null;
	let primary: unknown;
	let failed = false;
	try {
		assertActive(options);
		if (!(options.stagedFile instanceof Blob)) throw new TypeError('Direct MP3 export requires a staged WAV Blob.');
		if (!options.ffmpeg || typeof options.ffmpeg.encodeFileToSink !== 'function') {
			throw new TypeError('Direct MP3 export requires FFmpeg output streaming.');
		}
		const encoded = await options.ffmpeg.encodeFileToSink(
			options.stagedFile,
			'mp3',
			options.destination,
			{
				...options.encodingSettings,
				signal: options.signal,
				assertCurrent: () => { assertActive(options); },
			},
		);
		assertActive(options);
		result = validateEncodedResult(encoded, options.destination);
	} catch (error) {
		primary = error;
		failed = true;
	}
	try {
		await options.cleanupStagedFile();
	} catch (cleanupError) {
		let stagedError: unknown = cleanupError;
		try {
			await options.abortStagedFile?.(cleanupError);
		} catch (abortError) {
			stagedError = combineErrors(cleanupError, abortError, 'Direct MP3 staged-WAV abort also failed.');
		}
		primary = failed
			? combineErrors(primary, stagedError, 'Direct MP3 staged-WAV cleanup also failed.')
			: normalizeError(stagedError);
		failed = true;
	}
	if (!failed) {
		try {
			assertActive(options);
		} catch (error) {
			primary = error;
			failed = true;
		}
	}
	if (failed) throw await abortWithPrimary(options.destination, primary);
	return result!;
}

/** Publish only a sealed target whose statted, emitted, prepared, and committed sizes agree. */
export async function commitDirectMp3Destination(
	destination: DirectMp3Destination,
	plan: DirectMp3Plan,
	emittedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	assertPreparedPlan(destination, plan);
	const exactByteLength = destination.exactByteLength();
	if (emittedByteLength !== exactByteLength) {
		throw new Error('The streamed MP3 emitted byte count does not match its exact FFmpeg stat.');
	}
	if (destination.bytesWritten() !== exactByteLength) {
		throw new Error('The streamed MP3 prepared byte count does not match its exact FFmpeg stat.');
	}
	assertReadyToCommit();
	assertPreparedPlan(destination, plan);
	const published = await destination.commit();
	if (published.size !== exactByteLength) {
		throw new Error('The committed MP3 byte count does not match its exact FFmpeg stat.');
	}
	return published;
}

function directMp3Destination(
	prepared: PreparedMp3Stream,
	plan: DirectMp3Plan,
	contract: DirectMp3Contract,
): DirectMp3Destination {
	let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
	let exactByteLength: number | null = null;
	let emittedByteLength = 0;
	let opening = false;
	let closed = false;
	let committed = false;
	let abortPromise: Promise<void> | null = null;
	const destination: DirectMp3Destination = Object.freeze({
		async open(value: number): Promise<void> {
			assertSamePlan(contract, plan);
			if (opening || writer || closed || committed || abortPromise) {
				throw new Error('The direct MP3 destination cannot be opened.');
			}
			exactByteLength = safeByteLength(value, 'FFmpeg MP3 stat');
			opening = true;
			const writable = await prepared.createWritable(exactByteLength, 'exact');
			if (!writable || typeof writable.getWriter !== 'function') {
				throw new TypeError('The prepared MP3 destination is not writable.');
			}
			writer = writable.getWriter();
			opening = false;
			assertSamePlan(contract, plan);
		},
		async write(chunk: Uint8Array): Promise<void> {
			assertSamePlan(contract, plan);
			if (!(chunk instanceof Uint8Array)) throw new TypeError('Direct MP3 output chunks must be Uint8Array bytes.');
			if (!writer || exactByteLength === null || closed || committed || abortPromise) {
				throw new Error('The direct MP3 destination is not writable.');
			}
			if (chunk.byteLength > exactByteLength - emittedByteLength) {
				throw new RangeError('Direct MP3 output exceeds its exact FFmpeg stat.');
			}
			await writer.write(chunk);
			emittedByteLength += chunk.byteLength;
			assertSamePlan(contract, plan);
		},
		async close(): Promise<DirectMp3Destination> {
			assertSamePlan(contract, plan);
			if (!writer || exactByteLength === null || closed || committed || abortPromise) {
				throw new Error('The direct MP3 destination cannot be closed.');
			}
			assertExactCounts(prepared, emittedByteLength, exactByteLength);
			await writer.close();
			closed = true;
			assertExactCounts(prepared, emittedByteLength, exactByteLength);
			assertSamePlan(contract, plan);
			return destination;
		},
		abort(reason?: unknown): Promise<void> {
			if (committed) return Promise.resolve();
			abortPromise ??= Promise.resolve(prepared.abort(reason)).then(() => undefined);
			return abortPromise;
		},
		bytesWritten(): number { return prepared.bytesWritten(); },
		exactByteLength(): number | null { return exactByteLength; },
		async commit(): Promise<Readonly<Record<string, unknown>>> {
			if (!closed || committed || abortPromise || exactByteLength === null) {
				throw new Error('The direct MP3 destination is not ready to commit.');
			}
			assertExactCounts(prepared, emittedByteLength, exactByteLength);
			const published = await prepared.commit();
			committed = true;
			return published;
		},
	});
	return destination;
}

function captureContract(plan: DirectMp3Plan): DirectMp3Contract | null {
	try {
		if (!exactDirectMp3Plan(plan)) return null;
		return Object.freeze({
			fileName: (plan.outputs as readonly DirectMp3OutputPlan[])[0]!.fileName as string,
			fingerprint: planFingerprint(plan),
			stagingByteLength: plan.outputBytesPerRender as number,
		});
	} catch {
		return null;
	}
}

function exactDirectMp3Plan(plan: DirectMp3Plan): boolean {
	const encoding = plan?.encoding;
	const outputs = plan?.outputs;
	const range = plan?.range;
	const render = plan?.render;
	const sampleRate = plan?.sampleRate;
	const channelCount = plan?.channelCount;
	const outputFrames = plan?.outputFrames;
	if (plan?.mode !== 'mix' || plan.format !== 'mp3' || plan.mimeType !== 'audio/mpeg'
		|| plan.archive !== null || plan.outputFileBytesPerRender !== null
		|| !safeIntegerInRange(sampleRate, 8_000, 384_000)
		|| !safeIntegerInRange(channelCount, 1, 2)
		|| !safeIntegerInRange(outputFrames, 1, Number.MAX_SAFE_INTEGER)
		|| plan.outputBytesPerRender !== multiplySafe(outputFrames as number, channelCount as number, 4)
		|| plan.requiredTemporaryBytes !== plan.outputBytesPerRender
		|| !isRecord(range) || !canonicalRange(range)
		|| !safeIntegerInRange(plan.tailFrames, 0, Number.MAX_SAFE_INTEGER)
		|| !isRecord(render) || render.strategy !== 'realtime-stream' || render.fast !== false
		|| !REALTIME_REASONS.has(String(render.reason))
		|| !Array.isArray(outputs) || outputs.length !== 1 || !canonicalOutput(outputs[0])
		|| !isRecord(plan.metadata) || !isRecord(plan.channelMapping)
		|| !isRecord(encoding) || !canonicalEncoding(encoding, plan)) return false;
	return planFingerprint(plan).length > 0;
}

function canonicalOutput(output: unknown): boolean {
	if (!isRecord(output)) return false;
	const fileName = output.fileName;
	return output.kind === 'mix' && output.trackId === null
		&& output.includeMaster === true && output.respectMuteSolo === true
		&& typeof fileName === 'string' && fileName.length > 4
		&& fileName.toLowerCase().endsWith('.mp3')
		&& !fileName.includes('\0') && !fileName.includes('/') && !fileName.includes('\\');
}

function canonicalRange(range: Readonly<Record<string, unknown>>): boolean {
	return safeIntegerInRange(range.startFrame, 0, Number.MAX_SAFE_INTEGER)
		&& safeIntegerInRange(range.endFrame, 0, Number.MAX_SAFE_INTEGER)
		&& safeIntegerInRange(range.durationFrames, 1, Number.MAX_SAFE_INTEGER)
		&& Number(range.endFrame) > Number(range.startFrame)
		&& range.durationFrames === Number(range.endFrame) - Number(range.startFrame);
}

function canonicalEncoding(encoding: DirectMp3Encoding, plan: DirectMp3Plan): boolean {
	return encoding.format === 'mp3' && encoding.backend === 'ffmpeg'
		&& encoding.extension === 'mp3' && encoding.mimeType === 'audio/mpeg'
		&& encoding.sampleRate === plan.sampleRate && encoding.channelCount === plan.channelCount
		&& safeIntegerInRange(encoding.inputChannelCount, 1, 32)
		&& encoding.sampleFormat === null && encoding.bitDepth === null && encoding.floatingPoint === false
		&& MP3_BIT_RATES.has(Number(encoding.bitRate))
		&& encoding.dither === plan.ditherMode
		&& plan.dither === (plan.ditherMode !== 'none')
		&& ['none', 'triangular', 'triangular-highpass'].includes(String(plan.ditherMode))
		&& isRecord(encoding.metadata) && isRecord(encoding.channelMapping)
		&& jsonValue(encoding.metadata) === jsonValue(plan.metadata)
		&& jsonValue(encoding.channelMapping) === jsonValue(plan.channelMapping);
}

function planFingerprint(plan: DirectMp3Plan): string {
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

function assertPreparedPlan(destination: DirectMp3Destination, plan: DirectMp3Plan): DirectMp3Contract {
	const expected = preparedContracts.get(destination);
	const current = captureContract(plan);
	if (!expected || !current || expected.fingerprint !== current.fingerprint) {
		throw new Error('The direct MP3 export plan changed after its destination was selected.');
	}
	return expected;
}

function assertSamePlan(contract: DirectMp3Contract, plan: DirectMp3Plan): void {
	const current = captureContract(plan);
	if (!current || current.fingerprint !== contract.fingerprint) {
		throw new Error('The direct MP3 export plan changed after its destination was selected.');
	}
}

function assertActive(options: DirectMp3EncodeOptions): void {
	if (options.signal.aborted) throw options.signal.reason ?? abortError();
	options.assertCurrent();
	assertPreparedPlan(options.destination, options.plan);
}

function validateEncodedResult(
	value: DirectMp3FfmpegResult,
	destination: DirectMp3Destination,
): DirectMp3EncodedOutput {
	if (!value || typeof value !== 'object' || value.output !== destination
		|| value.extension !== '.mp3' || value.mimeType !== 'audio/mpeg') {
		throw new Error('FFmpeg returned an invalid direct MP3 result.');
	}
	const byteLength = safeByteLength(value.byteLength, 'FFmpeg MP3 result');
	if (!Number.isSafeInteger(value.chunkCount) || Number(value.chunkCount) < 0
		|| (byteLength === 0 ? value.chunkCount !== 0 : Number(value.chunkCount) < 1 || Number(value.chunkCount) > byteLength)
		|| destination.exactByteLength() !== byteLength
		|| destination.bytesWritten() !== byteLength) {
		throw new Error('FFmpeg direct MP3 result byte counts do not match its prepared target.');
	}
	return Object.freeze({ byteLength, directDestination: destination, mimeType: 'audio/mpeg' });
}

function assertExactCounts(prepared: PreparedMp3Stream, emitted: number, exact: number): void {
	if (emitted !== exact) throw new Error('Direct MP3 emitted byte count does not match its exact FFmpeg stat.');
	if (prepared.bytesWritten() !== exact) throw new Error('Direct MP3 prepared byte count does not match its exact FFmpeg stat.');
}

function assertPreparedStream(value: PreparedMp3Stream): void {
	for (const method of ['createWritable', 'bytesWritten', 'commit', 'abort'] as const) {
		if (typeof value[method] !== 'function') throw new TypeError(`The prepared MP3 destination lacks ${method}.`);
	}
}

function safeByteLength(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} byte length must be a non-negative safe integer.`);
	}
	return Number(value);
}

function safeIntegerInRange(value: unknown, minimum: number, maximum: number): boolean {
	return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function multiplySafe(...values: readonly number[]): number {
	let result = 1;
	for (const value of values) {
		if (!Number.isSafeInteger(value) || value < 0 || (value && result > Math.floor(Number.MAX_SAFE_INTEGER / value))) {
			throw new RangeError('Direct MP3 staging geometry exceeds JavaScript safe integers.');
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
	if (typeof result !== 'string') throw new TypeError('Direct MP3 plan data is not serializable.');
	return result;
}

async function abortWithPrimary(destination: DirectMp3Destination, primary: unknown): Promise<Error> {
	try {
		await destination.abort(primary);
		return normalizeError(primary);
	} catch (cleanupError) {
		return combineErrors(primary, cleanupError, 'Direct MP3 destination cleanup also failed.');
	}
}

function combineErrors(primary: unknown, cleanup: unknown, message: string): AggregateError {
	const primaryError = normalizeError(primary);
	return new AggregateError([primaryError, normalizeError(cleanup)], `${primaryError.message} ${message}`);
}

function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The MP3 export was aborted.', 'AbortError')
		: Object.assign(new Error('The MP3 export was aborted.'), { name: 'AbortError' });
}

function emptyPreparation(): DirectMp3Preparation {
	return Object.freeze({ cancelled: null, destination: null });
}
