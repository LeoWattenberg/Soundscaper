/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../ffmpeg-output-stream.ts';
import {
	captureDirectCompressedContract as captureContract,
	type DirectCompressedContract,
	type DirectCompressedFormat,
	type DirectCompressedPlan,
} from './direct-compressed-plan.ts';

export type { DirectCompressedFormat, DirectCompressedPlan } from './direct-compressed-plan.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface DirectCompressedFileService {
	readonly prepareSave?: (
		request: Readonly<Record<string, unknown>>,
	) => PromiseLike<unknown> | unknown;
}

interface PreparedCompressedStream {
	readonly mode: 'stream';
	createWritable(byteLength: number, sizeMode: 'exact'): Promise<WritableStream<Uint8Array>>;
	bytesWritten(): number;
	commit(): Awaitable<Readonly<Record<string, unknown>>>;
	abort(reason?: unknown): Awaitable<unknown>;
}

interface DirectCompressedFfmpegResult {
	readonly byteLength?: unknown;
	readonly chunkCount?: unknown;
	readonly extension?: unknown;
	readonly mimeType?: unknown;
	readonly output?: unknown;
}

interface DirectCompressedFfmpeg {
	readonly encodeFileToSink?: (
		file: Blob,
		format: DirectCompressedFormat,
		sink: FfmpegOutputSink<DirectCompressedDestination>,
		settings: Readonly<Record<string, unknown>>,
	) => PromiseLike<DirectCompressedFfmpegResult>;
}

export interface DirectCompressedDestination extends FfmpegOutputSink<DirectCompressedDestination> {
	bytesWritten(): number;
	exactByteLength(): number | null;
	commit(): Promise<Readonly<Record<string, unknown>>>;
}

export type DirectCompressedPreparation = Readonly<{
	cancelled: Readonly<Record<string, unknown>> | null;
	destination: DirectCompressedDestination | null;
}>;

export interface DirectCompressedEncodeOptions {
	readonly abortStagedFile?: (reason?: unknown) => Awaitable<void>;
	readonly assertCurrent: () => void;
	readonly cleanupStagedFile: () => Awaitable<void>;
	readonly destination: DirectCompressedDestination;
	readonly encodingSettings: Readonly<Record<string, unknown>>;
	readonly ffmpeg: DirectCompressedFfmpeg;
	readonly plan: DirectCompressedPlan;
	readonly signal: AbortSignal;
	readonly stagedFile: Blob;
}

export type DirectCompressedEncodedOutput = Readonly<{
	byteLength: number;
	directDestination: DirectCompressedDestination;
	mimeType: string;
}>;

const preparedContracts = new WeakMap<DirectCompressedDestination, DirectCompressedContract>();

/** Select a canonical compressed target without opening its writer before FFmpeg stats the output. */
export async function prepareDirectCompressedDestination(
	fileService: DirectCompressedFileService,
	plan: DirectCompressedPlan,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectCompressedPreparation> {
	const contract = captureContract(plan);
	if (!contract || typeof fileService.prepareSave !== 'function') return emptyPreparation();
	const settings = requestedSettings || {};
	const prepared = await fileService.prepareSave({
		purpose: 'audio',
		suggestedName: contract.fileName,
		mimeType: contract.mimeType,
		target: settings.saveTarget,
		types: contract.fileTypes,
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
	if (!prepared || typeof prepared !== 'object') {
		throw new TypeError(`The prepared ${contract.label} destination is invalid.`);
	}
	const mode = (prepared as Readonly<{ mode?: unknown }>).mode;
	if (mode === 'cancelled') {
		return Object.freeze({
			cancelled: prepared as Readonly<Record<string, unknown>>,
			destination: null,
		});
	}
	if (mode === 'blob') return emptyPreparation();
	if (mode !== 'stream') {
		throw new TypeError(`The prepared ${contract.label} destination has an unsupported mode.`);
	}
	const stream = prepared as PreparedCompressedStream;
	assertPreparedStream(stream, contract.label);
	const destination = directCompressedDestination(stream, plan, contract);
	preparedContracts.set(destination, contract);
	try {
		assertPreparedPlan(destination, plan);
	} catch (error) {
		throw await abortWithPrimary(destination, error);
	}
	return Object.freeze({ cancelled: null, destination });
}

/** The direct route retains only the staged WAV, never a renderer-side encoded output Blob. */
export function directCompressedStagingTemporaryBytes(plan: DirectCompressedPlan): number | null {
	return captureContract(plan)?.stagingByteLength ?? null;
}

/** Transcode one staged WAV through bounded FFmpeg ranges into the prepared target. */
export async function encodeDirectCompressedStagedFile(
	options: DirectCompressedEncodeOptions,
): Promise<DirectCompressedEncodedOutput> {
	let result: DirectCompressedEncodedOutput | null = null;
	let primary: unknown;
	let failed = false;
	let label = 'compressed audio';
	try {
		const contract = assertActive(options);
		label = contract.label;
		if (!(options.stagedFile instanceof Blob)) {
			throw new TypeError(`Direct ${label} export requires a staged WAV Blob.`);
		}
		if (!options.ffmpeg || typeof options.ffmpeg.encodeFileToSink !== 'function') {
			throw new TypeError(`Direct ${label} export requires FFmpeg output streaming.`);
		}
		const encoded = await options.ffmpeg.encodeFileToSink(
			options.stagedFile,
			contract.id,
			options.destination,
			{
				...options.encodingSettings,
				signal: options.signal,
				assertCurrent: () => { assertActive(options); },
			},
		);
		const current = assertActive(options);
		result = validateEncodedResult(encoded, options.destination, current);
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
			stagedError = combineErrors(cleanupError, abortError, `Direct ${label} staged-WAV abort also failed.`);
		}
		primary = failed
			? combineErrors(primary, stagedError, `Direct ${label} staged-WAV cleanup also failed.`)
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
export async function commitDirectCompressedDestination(
	destination: DirectCompressedDestination,
	plan: DirectCompressedPlan,
	emittedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	let contract = assertPreparedPlan(destination, plan);
	const exactByteLength = destination.exactByteLength();
	if (emittedByteLength !== exactByteLength) {
		throw new Error(`The streamed ${contract.label} emitted byte count does not match its exact FFmpeg stat.`);
	}
	if (destination.bytesWritten() !== exactByteLength) {
		throw new Error(`The streamed ${contract.label} prepared byte count does not match its exact FFmpeg stat.`);
	}
	assertReadyToCommit();
	contract = assertPreparedPlan(destination, plan);
	const published = await destination.commit();
	if (published.size !== exactByteLength) {
		throw new Error(`The committed ${contract.label} byte count does not match its exact FFmpeg stat.`);
	}
	return published;
}

function directCompressedDestination(
	prepared: PreparedCompressedStream,
	plan: DirectCompressedPlan,
	contract: DirectCompressedContract,
): DirectCompressedDestination {
	let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
	let exactByteLength: number | null = null;
	let emittedByteLength = 0;
	let opening = false;
	let closed = false;
	let committed = false;
	let abortPromise: Promise<void> | null = null;
	const destination: DirectCompressedDestination = Object.freeze({
		async open(value: number): Promise<void> {
			assertSamePlan(contract, plan);
			if (opening || writer || closed || committed || abortPromise) {
				throw new Error(`The direct ${contract.label} destination cannot be opened.`);
			}
			exactByteLength = safeByteLength(value, `FFmpeg ${contract.label} stat`);
			opening = true;
			const writable = await prepared.createWritable(exactByteLength, 'exact');
			if (!writable || typeof writable.getWriter !== 'function') {
				throw new TypeError(`The prepared ${contract.label} destination is not writable.`);
			}
			writer = writable.getWriter();
			opening = false;
			assertSamePlan(contract, plan);
		},
		async write(chunk: Uint8Array): Promise<void> {
			assertSamePlan(contract, plan);
			if (!(chunk instanceof Uint8Array)) {
				throw new TypeError(`Direct ${contract.label} output chunks must be Uint8Array bytes.`);
			}
			if (!writer || exactByteLength === null || closed || committed || abortPromise) {
				throw new Error(`The direct ${contract.label} destination is not writable.`);
			}
			if (chunk.byteLength > exactByteLength - emittedByteLength) {
				throw new RangeError(`Direct ${contract.label} output exceeds its exact FFmpeg stat.`);
			}
			await writer.write(chunk);
			emittedByteLength += chunk.byteLength;
			assertSamePlan(contract, plan);
		},
		async close(): Promise<DirectCompressedDestination> {
			assertSamePlan(contract, plan);
			if (!writer || exactByteLength === null || closed || committed || abortPromise) {
				throw new Error(`The direct ${contract.label} destination cannot be closed.`);
			}
			assertExactCounts(prepared, emittedByteLength, exactByteLength, contract.label);
			await writer.close();
			closed = true;
			assertExactCounts(prepared, emittedByteLength, exactByteLength, contract.label);
			assertSamePlan(contract, plan);
			return destination;
		},
		abort(reason?: unknown): Promise<void> {
			if (committed) return Promise.resolve();
			abortPromise ??= Promise.resolve().then(() => prepared.abort(reason)).then(() => undefined);
			return abortPromise;
		},
		bytesWritten(): number { return prepared.bytesWritten(); },
		exactByteLength(): number | null { return exactByteLength; },
		async commit(): Promise<Readonly<Record<string, unknown>>> {
			if (!closed || committed || abortPromise || exactByteLength === null) {
				throw new Error(`The direct ${contract.label} destination is not ready to commit.`);
			}
			assertExactCounts(prepared, emittedByteLength, exactByteLength, contract.label);
			const published = await prepared.commit();
			committed = true;
			return published;
		},
	});
	return destination;
}

function assertPreparedPlan(
	destination: DirectCompressedDestination,
	plan: DirectCompressedPlan,
): DirectCompressedContract {
	const expected = preparedContracts.get(destination);
	const current = captureContract(plan);
	if (!expected || !current || expected.fingerprint !== current.fingerprint) {
		throw new Error(`The direct ${expected?.label || 'compressed audio'} export plan changed after its destination was selected.`);
	}
	return expected;
}

function assertSamePlan(contract: DirectCompressedContract, plan: DirectCompressedPlan): void {
	const current = captureContract(plan);
	if (!current || current.fingerprint !== contract.fingerprint) {
		throw new Error(`The direct ${contract.label} export plan changed after its destination was selected.`);
	}
}

function assertActive(options: DirectCompressedEncodeOptions): DirectCompressedContract {
	if (options.signal.aborted) throw options.signal.reason ?? abortError();
	options.assertCurrent();
	return assertPreparedPlan(options.destination, options.plan);
}

function validateEncodedResult(
	value: DirectCompressedFfmpegResult,
	destination: DirectCompressedDestination,
	contract: DirectCompressedContract,
): DirectCompressedEncodedOutput {
	if (!value || typeof value !== 'object' || value.output !== destination
		|| value.extension !== `.${contract.extension}` || value.mimeType !== contract.mimeType) {
		throw new Error(`FFmpeg returned an invalid direct ${contract.label} result.`);
	}
	const byteLength = safeByteLength(value.byteLength, `FFmpeg ${contract.label} result`);
	if (!Number.isSafeInteger(value.chunkCount) || Number(value.chunkCount) < 0
		|| (byteLength === 0 ? value.chunkCount !== 0 : Number(value.chunkCount) < 1 || Number(value.chunkCount) > byteLength)
		|| destination.exactByteLength() !== byteLength
		|| destination.bytesWritten() !== byteLength) {
		throw new Error(`FFmpeg direct ${contract.label} result byte counts do not match its prepared target.`);
	}
	return Object.freeze({ byteLength, directDestination: destination, mimeType: contract.mimeType });
}

function assertExactCounts(
	prepared: PreparedCompressedStream,
	emitted: number,
	exact: number,
	label: string,
): void {
	if (emitted !== exact) throw new Error(`Direct ${label} emitted byte count does not match its exact FFmpeg stat.`);
	if (prepared.bytesWritten() !== exact) {
		throw new Error(`Direct ${label} prepared byte count does not match its exact FFmpeg stat.`);
	}
}

function assertPreparedStream(value: PreparedCompressedStream, label: string): void {
	for (const method of ['createWritable', 'bytesWritten', 'commit', 'abort'] as const) {
		if (typeof value[method] !== 'function') {
			throw new TypeError(`The prepared ${label} destination lacks ${method}.`);
		}
	}
}

function safeByteLength(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} byte length must be a non-negative safe integer.`);
	}
	return Number(value);
}

async function abortWithPrimary(destination: DirectCompressedDestination, primary: unknown): Promise<Error> {
	const label = preparedContracts.get(destination)?.label || 'compressed audio';
	try {
		await destination.abort(primary);
		return normalizeError(primary);
	} catch (cleanupError) {
		return combineErrors(primary, cleanupError, `Direct ${label} destination cleanup also failed.`);
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
		? new DOMException('The compressed-audio export was aborted.', 'AbortError')
		: Object.assign(new Error('The compressed-audio export was aborted.'), { name: 'AbortError' });
}

function emptyPreparation(): DirectCompressedPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
