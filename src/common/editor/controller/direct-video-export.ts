/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../ffmpeg-output-stream.ts';
import { getVideoExportFormat } from '../video-export.js';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface VideoFormatDescriptor {
	readonly audioCodec: string;
	readonly audioEncoder: string;
	readonly container: string;
	readonly extension: string;
	readonly id: 'mp4' | 'webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly pixelFormat: string;
	readonly videoCodec: string;
	readonly videoEncoder: string;
}

interface DirectVideoPlan extends Readonly<Record<string, unknown>> {
	readonly canvas?: unknown;
	readonly codecs?: unknown;
	readonly container?: unknown;
	readonly durationSeconds?: unknown;
	readonly extension?: unknown;
	readonly filterPlan?: unknown;
	readonly format?: unknown;
	readonly inputs?: unknown;
	readonly mimeType?: unknown;
	readonly outputFrameCount?: unknown;
	readonly range?: unknown;
	readonly version?: unknown;
}

interface PreparedVideoStream {
	readonly mode: 'stream';
	createWritable(byteLength: number, sizeMode: 'exact'): Promise<WritableStream<Uint8Array>>;
	bytesWritten(): number;
	commit(): Awaitable<Readonly<Record<string, unknown>>>;
	abort(reason?: unknown): Awaitable<unknown>;
}

interface DirectVideoFileService {
	readonly isDesktop?: unknown;
	readonly prepareSave?: (
		request: Readonly<Record<string, unknown>>,
	) => Awaitable<unknown>;
}

interface DirectVideoContract {
	readonly descriptor: VideoFormatDescriptor;
	readonly fileName: string;
	readonly fingerprint: string;
}

interface DirectVideoEncodedResult {
	readonly byteLength?: unknown;
	readonly chunkCount?: unknown;
	readonly extension?: unknown;
	readonly mimeType?: unknown;
	readonly output?: unknown;
}

export interface DirectVideoDestination extends FfmpegOutputSink<DirectVideoDestination> {
	bytesWritten(): number;
	emittedByteLength(): number;
	exactByteLength(): number | null;
	commit(): Promise<Readonly<Record<string, unknown>>>;
}

export type DirectVideoPreparation = Readonly<{
	cancelled: Readonly<Record<string, unknown>> | null;
	destination: DirectVideoDestination | null;
}>;

export type DirectVideoOutput = Readonly<{
	byteLength: number;
	directDestination: DirectVideoDestination;
	mimeType: 'video/mp4' | 'video/webm';
}>;

const preparedContracts = new WeakMap<DirectVideoDestination, DirectVideoContract>();

/** Prepare browser handles immediately, while desktop selection remains deferred until sink open. */
export async function prepareDirectVideoDestination(
	fileService: DirectVideoFileService,
	plan: DirectVideoPlan,
	fileName: string,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectVideoPreparation> {
	const contract = captureContract(plan, fileName);
	if (!contract || typeof fileService.prepareSave !== 'function') return emptyPreparation();
	const prepare = () => fileService.prepareSave!(saveRequest(
		contract,
		requestedSettings || {},
		signal,
	));
	if (fileService.isDesktop === true) {
		return await preparedDestination(plan, contract, null, prepare);
	}
	const prepared = await prepare();
	if (!prepared || typeof prepared !== 'object') {
		throw new TypeError('The prepared video destination is invalid.');
	}
	const mode = (prepared as Readonly<{ mode?: unknown }>).mode;
	if (mode === 'cancelled') {
		return Object.freeze({
			cancelled: prepared as Readonly<Record<string, unknown>>,
			destination: null,
		});
	}
	if (mode === 'blob') return emptyPreparation();
	if (mode !== 'stream') throw new TypeError('The prepared video destination has an unsupported mode.');
	return await preparedDestination(plan, contract, prepared as PreparedVideoStream, null);
}

/** Validate the FFmpeg stat/range result against the exact prepared destination and plan. */
export function validateDirectVideoOutput(
	value: DirectVideoEncodedResult,
	destination: DirectVideoDestination,
	plan: DirectVideoPlan,
	fileName: string,
): DirectVideoOutput {
	const contract = assertPreparedPlan(destination, plan, fileName);
	if (!value || typeof value !== 'object'
		|| value.output !== destination
		|| value.extension !== `.${contract.descriptor.extension}`
		|| value.mimeType !== contract.descriptor.mimeType) {
		throw new Error('FFmpeg returned an invalid direct video result.');
	}
	const byteLength = safeByteLength(value.byteLength, 'FFmpeg video result');
	if (!Number.isSafeInteger(value.chunkCount)
		|| Number(value.chunkCount) < 0
		|| (byteLength === 0
			? value.chunkCount !== 0
			: Number(value.chunkCount) < 1 || Number(value.chunkCount) > byteLength)
		|| destination.exactByteLength() !== byteLength
		|| destination.emittedByteLength() !== byteLength
		|| destination.bytesWritten() !== byteLength) {
		throw new Error('FFmpeg direct video byte counts do not match its prepared target.');
	}
	return Object.freeze({
		byteLength,
		directDestination: destination,
		mimeType: contract.descriptor.mimeType,
	});
}

/** Commit one sealed output only after plan, stat, emitted, and prepared counts agree. */
export async function commitDirectVideoDestination(
	destination: DirectVideoDestination,
	plan: DirectVideoPlan,
	fileName: string,
	emittedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	assertPreparedPlan(destination, plan, fileName);
	const exactByteLength = destination.exactByteLength();
	if (emittedByteLength !== exactByteLength
		|| destination.emittedByteLength() !== exactByteLength
		|| destination.bytesWritten() !== exactByteLength) {
		throw new Error('The direct video byte count does not match its exact FFmpeg stat.');
	}
	assertReadyToCommit();
	assertPreparedPlan(destination, plan, fileName);
	const published = await destination.commit();
	if (published.size !== exactByteLength) {
		throw new Error('The committed video byte count does not match its exact FFmpeg stat.');
	}
	return published;
}

/** Recover a late desktop chooser cancellation without reporting it as an encoding failure. */
export function directVideoCancellation(
	error: unknown,
): Readonly<Record<string, unknown>> | null {
	return error instanceof DirectVideoTargetCancelled ? error.result : null;
}

async function preparedDestination(
	plan: DirectVideoPlan,
	contract: DirectVideoContract,
	prepared: PreparedVideoStream | null,
	prepare: (() => Awaitable<unknown>) | null,
): Promise<DirectVideoPreparation> {
	const destination = directVideoDestination(plan, contract, prepared, prepare);
	preparedContracts.set(destination, contract);
	try {
		assertPreparedPlan(destination, plan, contract.fileName);
	} catch (error) {
		try {
			await destination.abort(error);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Direct video preparation and destination cleanup both failed.',
			);
		}
		throw error;
	}
	return Object.freeze({ cancelled: null, destination });
}

function directVideoDestination(
	plan: DirectVideoPlan,
	contract: DirectVideoContract,
	initialPrepared: PreparedVideoStream | null,
	prepare: (() => Awaitable<unknown>) | null,
): DirectVideoDestination {
	let prepared = initialPrepared;
	let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
	let exactByteLength: number | null = null;
	let emittedByteLength = 0;
	let opening = false;
	let closed = false;
	let committed = false;
	let abortPromise: Promise<void> | null = null;
	const destination: DirectVideoDestination = Object.freeze({
		async open(value: number): Promise<void> {
			assertSamePlan(contract, plan);
			if (opening || writer || closed || committed || abortPromise) {
				throw new Error('The direct video destination cannot be opened.');
			}
			exactByteLength = safeByteLength(value, 'FFmpeg video stat');
			opening = true;
			try {
				if (!prepared) prepared = await prepareLateVideoTarget(prepare);
				assertPreparedStream(prepared);
				const writable = await prepared.createWritable(exactByteLength, 'exact');
				if (!writable || typeof writable.getWriter !== 'function') {
					throw new TypeError('The prepared video destination is not writable.');
				}
				writer = writable.getWriter();
				assertSamePlan(contract, plan);
			} finally {
				opening = false;
			}
		},
		async write(chunk: Uint8Array): Promise<void> {
			assertSamePlan(contract, plan);
			if (!(chunk instanceof Uint8Array)) {
				throw new TypeError('Direct video output chunks must be Uint8Array bytes.');
			}
			if (!writer || exactByteLength === null || closed || committed || abortPromise) {
				throw new Error('The direct video destination is not writable.');
			}
			if (chunk.byteLength > exactByteLength - emittedByteLength) {
				throw new RangeError('Direct video output exceeds its exact FFmpeg stat.');
			}
			await writer.write(chunk);
			emittedByteLength += chunk.byteLength;
			assertSamePlan(contract, plan);
		},
		async close(): Promise<DirectVideoDestination> {
			assertSamePlan(contract, plan);
			if (!writer || !prepared || exactByteLength === null || closed || committed || abortPromise) {
				throw new Error('The direct video destination cannot be closed.');
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
			if (abortPromise) return abortPromise.catch(() => undefined);
			const abortTarget = prepared;
			abortPromise = abortTarget
				? Promise.resolve().then(() => abortTarget.abort(reason)).then(() => undefined)
				: Promise.resolve();
			return abortPromise;
		},
		bytesWritten(): number { return prepared?.bytesWritten() ?? 0; },
		emittedByteLength(): number { return emittedByteLength; },
		exactByteLength(): number | null { return exactByteLength; },
		async commit(): Promise<Readonly<Record<string, unknown>>> {
			if (!prepared || !closed || committed || abortPromise || exactByteLength === null) {
				throw new Error('The direct video destination is not ready to commit.');
			}
			assertExactCounts(prepared, emittedByteLength, exactByteLength);
			const published = await prepared.commit();
			committed = true;
			return published;
		},
	});
	return destination;
}

async function prepareLateVideoTarget(
	prepare: (() => Awaitable<unknown>) | null,
): Promise<PreparedVideoStream> {
	if (!prepare) throw new Error('The direct video destination has no prepared target.');
	const selected = await prepare();
	if (!selected || typeof selected !== 'object') {
		throw new TypeError('The prepared video destination is invalid.');
	}
	const mode = (selected as Readonly<{ mode?: unknown }>).mode;
	if (mode === 'cancelled') {
		throw new DirectVideoTargetCancelled(selected as Readonly<Record<string, unknown>>);
	}
	if (mode !== 'stream') {
		throw new TypeError('Desktop direct video preparation did not return a stream target.');
	}
	return selected as PreparedVideoStream;
}

function captureContract(
	plan: DirectVideoPlan,
	fileName: string,
): DirectVideoContract | null {
	try {
		if (!isRecord(plan) || plan.version !== 4 || !Array.isArray(plan.inputs)) return null;
		const descriptor = getVideoExportFormat(String(plan.format || '')) as VideoFormatDescriptor;
		if ((descriptor.id !== 'mp4' && descriptor.id !== 'webm')
			|| plan.format !== descriptor.id
			|| plan.container !== descriptor.container
			|| plan.extension !== descriptor.extension
			|| plan.mimeType !== descriptor.mimeType
			|| !canonicalVideoGeometry(plan, descriptor)
			|| !canonicalVideoInputs(plan, descriptor)
			|| !canonicalFileName(fileName, descriptor.extension)) return null;
		const fingerprint = JSON.stringify(plan);
		if (typeof fingerprint !== 'string' || !fingerprint) return null;
		return Object.freeze({ descriptor, fileName, fingerprint });
	} catch {
		return null;
	}
}

function canonicalVideoGeometry(
	plan: DirectVideoPlan,
	descriptor: VideoFormatDescriptor,
): boolean {
	const canvas = isRecord(plan.canvas) ? plan.canvas : null;
	const codecs = isRecord(plan.codecs) ? plan.codecs : null;
	const range = isRecord(plan.range) ? plan.range : null;
	if (!canvas || !codecs || !range
		|| !positiveEvenInteger(canvas.width) || !positiveEvenInteger(canvas.height)
		|| !positiveNumber(canvas.frameRate)
		|| canvas.pixelFormat !== descriptor.pixelFormat
		|| codecs.pixelFormat !== descriptor.pixelFormat
		|| codecs.video !== descriptor.videoCodec
		|| codecs.videoEncoder !== descriptor.videoEncoder
		|| !positiveNumber(plan.durationSeconds)
		|| !positiveSafeInteger(plan.outputFrameCount)
		|| !nonNegativeSafeInteger(range.startFrame)
		|| !positiveSafeInteger(range.endFrame)
		|| !positiveSafeInteger(range.durationFrames)
		|| Number(range.endFrame) - Number(range.startFrame) !== range.durationFrames) return false;
	return true;
}

function canonicalVideoInputs(
	plan: DirectVideoPlan,
	descriptor: VideoFormatDescriptor,
): boolean {
	const inputs = plan.inputs as readonly unknown[];
	const codecs = plan.codecs as Readonly<Record<string, unknown>>;
	let audioInputs = 0;
	let videoInputs = 0;
	const videoSourceIds = new Set<string>();
	for (const [index, input] of inputs.entries()) {
		if (!isRecord(input) || input.inputIndex !== index) return false;
		if (input.kind === 'staged-audio-mix') audioInputs += 1;
		else if (input.kind === 'video-source') {
			if (typeof input.sourceId !== 'string' || !input.sourceId
				|| input.sourceId.includes('\0') || videoSourceIds.has(input.sourceId)) return false;
			videoSourceIds.add(input.sourceId);
			videoInputs += 1;
		} else return false;
	}
	const finalInput = inputs.at(-1);
	if (videoInputs === 0 || audioInputs > 1
		|| (audioInputs === 1 && (!isRecord(finalInput) || finalInput.kind !== 'staged-audio-mix'))) return false;
	const filterPlan = isRecord(plan.filterPlan) ? plan.filterPlan : null;
	const filterAudio = filterPlan && isRecord(filterPlan.audio) ? filterPlan.audio : null;
	return audioInputs === 1
		? codecs.audio === descriptor.audioCodec
			&& codecs.audioEncoder === descriptor.audioEncoder
			&& filterAudio?.strategy === 'staged-mix'
		: codecs.audio === null
			&& codecs.audioEncoder === null
			&& filterAudio?.strategy === 'none';
}

function saveRequest(
	contract: DirectVideoContract,
	settings: Readonly<Record<string, unknown>>,
	signal: AbortSignal,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		purpose: 'video',
		suggestedName: contract.fileName,
		mimeType: contract.descriptor.mimeType,
		target: settings.saveTarget,
		types: videoFileTypes(contract.descriptor),
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
}

function videoFileTypes(descriptor: VideoFormatDescriptor): readonly Readonly<Record<string, unknown>>[] {
	return Object.freeze([Object.freeze({
		description: descriptor.id === 'mp4' ? 'MP4 video' : 'WebM video',
		accept: Object.freeze({
			[descriptor.mimeType]: Object.freeze([`.${descriptor.extension}`]),
		}),
	})]);
}

function assertPreparedPlan(
	destination: DirectVideoDestination,
	plan: DirectVideoPlan,
	fileName: string,
): DirectVideoContract {
	const expected = preparedContracts.get(destination);
	const current = captureContract(plan, fileName);
	if (!expected || !current || !sameContract(expected, current)) {
		throw new Error('The direct video export plan changed after its destination was selected.');
	}
	return expected;
}

function assertSamePlan(contract: DirectVideoContract, plan: DirectVideoPlan): void {
	const current = captureContract(plan, contract.fileName);
	if (!current || !sameContract(contract, current)) {
		throw new Error('The direct video export plan changed after its destination was selected.');
	}
}

function sameContract(left: DirectVideoContract, right: DirectVideoContract): boolean {
	return left.fileName === right.fileName
		&& left.fingerprint === right.fingerprint
		&& left.descriptor.id === right.descriptor.id
		&& left.descriptor.mimeType === right.descriptor.mimeType
		&& left.descriptor.extension === right.descriptor.extension;
}

function assertPreparedStream(value: PreparedVideoStream): void {
	for (const method of ['createWritable', 'bytesWritten', 'commit', 'abort'] as const) {
		if (typeof value[method] !== 'function') {
			throw new TypeError(`The prepared video destination lacks ${method}.`);
		}
	}
}

function assertExactCounts(prepared: PreparedVideoStream, emitted: number, exact: number): void {
	if (emitted !== exact) throw new Error('Direct video emitted byte count does not match its exact FFmpeg stat.');
	if (prepared.bytesWritten() !== exact) {
		throw new Error('Direct video prepared byte count does not match its exact FFmpeg stat.');
	}
}

function canonicalFileName(fileName: string, extension: string): boolean {
	return typeof fileName === 'string'
		&& fileName.length > extension.length + 1
		&& fileName.toLowerCase().endsWith(`.${extension}`)
		&& !fileName.includes('\0')
		&& !fileName.includes('/')
		&& !fileName.includes('\\');
}

function safeByteLength(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} byte length must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveEvenInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) >= 2 && Number(value) % 2 === 0;
}

function positiveSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveNumber(value: unknown): boolean {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function emptyPreparation(): DirectVideoPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}

class DirectVideoTargetCancelled extends Error {
	readonly result: Readonly<Record<string, unknown>>;

	constructor(result: Readonly<Record<string, unknown>>) {
		super('The video save target selection was cancelled.');
		this.name = 'DirectVideoTargetCancelled';
		this.result = result;
	}
}
