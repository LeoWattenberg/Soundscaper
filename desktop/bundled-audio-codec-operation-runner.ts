/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned staging and supervision for one-shot bundled-codec utility processes. */

import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import {
	BUNDLED_AUDIO_CODEC_IDS,
	type BundledAudioCodecHelperConfiguration,
	type BundledAudioCodecId,
} from './bundled-audio-codec-helper-process.js';
import { readBoundedRegularFile } from './bounded-regular-file.js';
import type {
	DesktopAudioCodecProviderExecutionResult,
} from './desktop-audio-codec-broker.js';
import {
	normalizeDesktopAudioCodecRequest,
	type DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.js';
import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
} from '../src/common/editor/desktop-codec-coordinator.js';
import type { DesktopCodecTarget } from '../src/common/editor/desktop-codec-provider-catalog.js';

export interface BundledAudioCodecChild {
	postMessage(message: unknown): void;
	onMessage(listener: (message: unknown) => void): () => void;
	onExit(listener: (code: number | null) => void): () => void;
	kill(): void;
}

export interface BundledAudioCodecOperationRunner {
	preflight(
		codec: BundledAudioCodecId,
		request: DesktopAudioCodecRequest,
		operation: DesktopCodecOperation,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): Promise<DesktopCodecPreflightResult>;
	execute(
		codec: BundledAudioCodecId,
		request: DesktopAudioCodecRequest,
		operation: DesktopCodecOperation,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): Promise<DesktopAudioCodecProviderExecutionResult>;
}

interface StagedFiles {
	readonly inputPath: string;
	readonly outputPath: string;
}

type JobPhase = 'preflight' | 'execute';
type HelperResult = Readonly<{
	readonly status: 'preflight';
	readonly disposition: DesktopCodecPreflightResult['disposition'];
	readonly reason: string | null;
}> | Readonly<{
	readonly status: 'executed';
	readonly outputBytes: number;
	readonly outputSha256: string;
	readonly decodedGeometry?: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly frameCount: number;
	}>;
}> | Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }>;

type SupervisionFailure =
	| 'cancelled' | 'helper-crashed' | 'helper-failed' | 'helper-protocol' | 'helper-timeout';
type SupervisionResult = Readonly<{ readonly status: 'complete'; readonly result: HelperResult }>
	| Readonly<{ readonly status: 'failed'; readonly reason: SupervisionFailure }>;

const TARGETS = new Set<string>([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const CODECS = new Set<string>(BUNDLED_AUDIO_CODEC_IDS);
const SHA256 = /^[a-f0-9]{64}$/u;
const DEFAULT_DURATION_MS = 30_000;
const MAXIMUM_DURATION_MS = 5 * 60_000;
const DEFAULT_KILL_WAIT_MS = 1_000;
const MAXIMUM_KILL_WAIT_MS = 5_000;
const DEFAULT_ACTIVE_JOBS = 4;
const MAXIMUM_ACTIVE_JOBS = 4;
const DETAIL_BYTES = 2_048;
const FAILURE_REASONS = new Set<string>([
	'unavailable', 'cancelled', 'execution-failed', 'security-failed', 'process-failed', 'result-failed',
]);
const CONFIGURATION_FIELDS = Object.freeze([
	'contractVersion', 'target', 'codec', 'runtimeRoot', 'moduleBytes', 'moduleSha256',
	'wasmBytes', 'wasmSha256',
]);

const DETAILS = Object.freeze({
	busy: 'The isolated bundled codec helper capacity is busy.',
	cancelled: 'The isolated bundled codec job was cancelled.',
	cleanup: 'The isolated bundled codec scratch directory could not be removed.',
	'helper-crashed': 'The isolated bundled codec helper exited before a valid result.',
	'helper-failed': 'The isolated bundled codec failed after admission.',
	'helper-protocol': 'The isolated bundled codec helper violated its closed protocol.',
	'helper-timeout': 'The isolated bundled codec helper timed out.',
	identity: 'The isolated bundled codec payload identity changed.',
	'output-invalid': 'The isolated bundled codec output failed exact authentication.',
	scratch: 'The isolated bundled codec scratch files could not be prepared.',
	spawn: 'The isolated bundled codec helper could not be started.',
});

export function createBundledAudioCodecOperationRunner(options: Readonly<{
	readonly target: DesktopCodecTarget;
	readonly scratchRoot: string;
	readonly verifyPayload: (codec: BundledAudioCodecId) => Promise<BundledAudioCodecHelperConfiguration>;
	readonly spawn: (configuration: BundledAudioCodecHelperConfiguration) => BundledAudioCodecChild;
	readonly maximumDurationMs?: number;
	readonly killWaitMs?: number;
	readonly maximumActiveJobs?: number;
}>): BundledAudioCodecOperationRunner {
	validateOptions(options);
	const maximumDurationMs = integer(
		options.maximumDurationMs ?? DEFAULT_DURATION_MS, 1, MAXIMUM_DURATION_MS, 'maximum duration',
	);
	const killWaitMs = integer(
		options.killWaitMs ?? DEFAULT_KILL_WAIT_MS, 1, MAXIMUM_KILL_WAIT_MS, 'kill wait',
	);
	const maximumActiveJobs = integer(
		options.maximumActiveJobs ?? DEFAULT_ACTIVE_JOBS, 1, MAXIMUM_ACTIVE_JOBS, 'active job count',
	);
	let activeJobs = 0;

	async function run(
		phase: JobPhase,
		codecValue: BundledAudioCodecId,
		requestValue: DesktopAudioCodecRequest,
		operation: DesktopCodecOperation,
		executionOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
	): Promise<DesktopCodecPreflightResult | DesktopAudioCodecProviderExecutionResult> {
		const codec = codecId(codecValue);
		let request: DesktopAudioCodecRequest;
		try { request = normalizeDesktopAudioCodecRequest(requestValue); }
		catch { return failure(phase, 'security-failed', 'The isolated bundled codec request is invalid.'); }
		const signal = executionSignal(executionOptions?.signal);
		if (signal?.aborted) return failure(phase, 'cancelled', DETAILS.cancelled);
		if (activeJobs >= maximumActiveJobs) return failure(phase, 'unavailable', DETAILS.busy);
		activeJobs += 1;
		try {
			return await runActive({
				phase, codec, request, operation, signal, target: options.target,
				scratchRoot: options.scratchRoot, verifyPayload: options.verifyPayload,
				spawn: options.spawn, maximumDurationMs, killWaitMs,
			});
		} finally { activeJobs -= 1; }
	}

	return Object.freeze({
		async preflight(
			codec: BundledAudioCodecId,
			request: DesktopAudioCodecRequest,
			operation: DesktopCodecOperation,
			executionOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
		) {
			return await run('preflight', codec, request, operation, executionOptions) as DesktopCodecPreflightResult;
		},
		async execute(
			codec: BundledAudioCodecId,
			request: DesktopAudioCodecRequest,
			operation: DesktopCodecOperation,
			executionOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
		) {
			return (await run(
				'execute', codec, request, operation, executionOptions,
			)) as DesktopAudioCodecProviderExecutionResult;
		},
	});
}

async function runActive(options: Readonly<{
	phase: JobPhase;
	codec: BundledAudioCodecId;
	request: DesktopAudioCodecRequest;
	operation: DesktopCodecOperation;
	signal: AbortSignal | undefined;
	target: DesktopCodecTarget;
	scratchRoot: string;
	verifyPayload: (codec: BundledAudioCodecId) => Promise<BundledAudioCodecHelperConfiguration>;
	spawn: (configuration: BundledAudioCodecHelperConfiguration) => BundledAudioCodecChild;
	maximumDurationMs: number;
	killWaitMs: number;
}>): Promise<DesktopCodecPreflightResult | DesktopAudioCodecProviderExecutionResult> {
	let directory: string | null = null;
	let result: DesktopCodecPreflightResult | DesktopAudioCodecProviderExecutionResult;
	try {
		directory = await prepareScratch(options.scratchRoot);
		const files = Object.freeze({
			inputPath: join(directory, 'input.bin'), outputPath: join(directory, 'output.bin'),
		});
		await writeFile(files.inputPath, options.request.input, { flag: 'wx', mode: 0o600 });
		result = await runStaged({ ...options, files });
	} catch { result = failure(options.phase, 'execution-failed', DETAILS.scratch); }
	finally {
		if (directory !== null) {
			try { await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 }); }
			catch { result = failure(options.phase, 'execution-failed', DETAILS.cleanup); }
		}
	}
	return result!;
}

async function runStaged(options: Readonly<{
	phase: JobPhase;
	codec: BundledAudioCodecId;
	request: DesktopAudioCodecRequest;
	operation: DesktopCodecOperation;
	signal: AbortSignal | undefined;
	target: DesktopCodecTarget;
	files: StagedFiles;
	verifyPayload: (codec: BundledAudioCodecId) => Promise<BundledAudioCodecHelperConfiguration>;
	spawn: (configuration: BundledAudioCodecHelperConfiguration) => BundledAudioCodecChild;
	maximumDurationMs: number;
	killWaitMs: number;
}>): Promise<DesktopCodecPreflightResult | DesktopAudioCodecProviderExecutionResult> {
	if (options.signal?.aborted) return failure(options.phase, 'cancelled', DETAILS.cancelled);
	let configuration: BundledAudioCodecHelperConfiguration;
	try {
		configuration = helperConfiguration(
			await options.verifyPayload(options.codec), options.target, options.codec,
		);
	} catch { return failure(options.phase, 'security-failed', DETAILS.identity); }
	if (options.signal?.aborted) return failure(options.phase, 'cancelled', DETAILS.cancelled);
	let child: BundledAudioCodecChild;
	try { child = inspectedChild(options.spawn(configuration)); }
	catch { return failure(options.phase, 'process-failed', DETAILS.spawn); }
	const supervised = await supervise({
		child, configuration, phase: options.phase, files: options.files,
		request: options.request, operation: options.operation, signal: options.signal,
		maximumDurationMs: options.maximumDurationMs, killWaitMs: options.killWaitMs,
	});
	if (supervised.status === 'failed') return supervisionFailure(options.phase, supervised.reason);
	const helper = supervised.result;
	if (options.phase === 'preflight') {
		if (helper.status !== 'preflight') return failure('preflight', 'security-failed', DETAILS['helper-protocol']);
		return helper.disposition === 'supported'
			? Object.freeze({ disposition: 'supported', reason: null })
			: Object.freeze({ disposition: helper.disposition, reason: helper.reason! });
	}
	if (helper.status === 'failed') return helper;
	if (helper.status !== 'executed') return failure('execute', 'security-failed', DETAILS['helper-protocol']);
	const output = await readBoundedRegularFile(options.files.outputPath, options.request.maximumOutputBytes);
	if (output.status !== 'available' || output.bytes.byteLength !== helper.outputBytes
		|| digest(output.bytes) !== helper.outputSha256) {
		return failure('execute', 'result-failed', DETAILS['output-invalid']);
	}
	if (options.request.operation === 'audio-decode' && helper.decodedGeometry === undefined
		|| options.request.operation === 'audio-encode' && helper.decodedGeometry !== undefined) {
		return failure('execute', 'result-failed', DETAILS['output-invalid']);
	}
	return Object.freeze({
		status: 'executed', output: output.bytes,
		...(helper.decodedGeometry === undefined ? {} : { decodedGeometry: helper.decodedGeometry }),
	});
}

function supervise(options: Readonly<{
	child: BundledAudioCodecChild;
	configuration: BundledAudioCodecHelperConfiguration;
	phase: JobPhase;
	files: StagedFiles;
	request: DesktopAudioCodecRequest;
	operation: DesktopCodecOperation;
	signal: AbortSignal | undefined;
	maximumDurationMs: number;
	killWaitMs: number;
}>): Promise<SupervisionResult> {
	return new Promise((resolve) => {
		let phase: 'ready' | 'running' | 'terminal' = 'ready';
		let terminal: HelperResult | null = null;
		let stopping: SupervisionFailure | null = null;
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | null = null;
		const durationTimer = setTimeout(() => stop('helper-timeout'), options.maximumDurationMs);
		const removeMessage = options.child.onMessage(onMessage);
		const removeExit = options.child.onExit(onExit);
		const onAbort = (): void => stop('cancelled');
		options.signal?.addEventListener('abort', onAbort, { once: true });
		if (options.signal?.aborted) onAbort();

		function onMessage(value: unknown): void {
			if (settled || stopping !== null) return;
			try {
				if (phase === 'ready') {
					inspectReady(value, options.configuration);
					phase = 'running';
					options.child.postMessage(helperJob(options));
					return;
				}
				if (phase !== 'running') throw new TypeError('Duplicate helper result.');
				terminal = inspectTerminal(value, options.phase);
				phase = 'terminal';
			} catch (error) {
				stop(error instanceof HelperJobError ? 'helper-failed' : 'helper-protocol');
			}
		}

		function onExit(code: number | null): void {
			if (settled) return;
			if (stopping !== null) { finish({ status: 'failed', reason: stopping }); return; }
			if (phase === 'terminal' && terminal !== null && code === 0) {
				finish({ status: 'complete', result: terminal });
				return;
			}
			finish({ status: 'failed', reason: 'helper-crashed' });
		}

		function stop(reason: SupervisionFailure): void {
			if (settled || stopping !== null) return;
			stopping = reason;
			try { options.child.kill(); }
			catch { finish({ status: 'failed', reason }); return; }
			killTimer = setTimeout(() => finish({ status: 'failed', reason }), options.killWaitMs);
		}

		function finish(result: SupervisionResult): void {
			if (settled) return;
			settled = true;
			clearTimeout(durationTimer);
			if (killTimer !== null) clearTimeout(killTimer);
			options.signal?.removeEventListener('abort', onAbort);
			removeMessage();
			removeExit();
			resolve(Object.freeze(result));
		}
	});
}

function helperJob(options: Readonly<{
	phase: JobPhase;
	files: StagedFiles;
	request: DesktopAudioCodecRequest;
	operation: DesktopCodecOperation;
}>): unknown {
	const request = options.request;
	return Object.freeze({
		contractVersion: 1, type: 'job', phase: options.phase,
		operation: Object.freeze({
			direction: options.operation.direction, mediaKind: options.operation.mediaKind,
			container: options.operation.container, codec: options.operation.codec,
			profile: options.operation.profile, sampleFormat: options.operation.sampleFormat,
			pixelFormat: options.operation.pixelFormat, sampleRate: options.operation.sampleRate,
			channelCount: options.operation.channelCount, width: options.operation.width,
			height: options.operation.height,
		}),
		request: Object.freeze({
			contractVersion: 1, operation: request.operation, format: request.format,
			inputPath: options.files.inputPath, outputPath: options.files.outputPath,
			inputBytes: request.input.byteLength, inputSha256: digest(request.input),
			maximumOutputBytes: request.maximumOutputBytes, sampleRate: request.sampleRate,
			channelCount: request.channelCount, settings: Object.freeze({ ...request.settings }),
		}),
	});
}

function inspectReady(value: unknown, configuration: BundledAudioCodecHelperConfiguration): void {
	const record = exactRecord(value, ['contractVersion', 'type', 'target', 'codec'], 'helper ready');
	if (record.contractVersion !== 1 || record.type !== 'ready'
		|| record.target !== configuration.target || record.codec !== configuration.codec) {
		throw new TypeError('The bundled audio codec helper ready message is invalid.');
	}
}

function inspectTerminal(value: unknown, phase: JobPhase): HelperResult {
	const type = dataProperty(value, 'type', 'helper terminal message');
	if (type === 'error') {
		const error = exactRecord(value, ['contractVersion', 'type', 'code'], 'helper error');
		if (error.contractVersion !== 1 || error.code !== 'job-failed') {
			throw new TypeError('The bundled audio codec helper error is invalid.');
		}
		throw new HelperJobError();
	}
	const envelope = exactRecord(value, ['contractVersion', 'type', 'result'], 'helper result');
	if (envelope.contractVersion !== 1 || envelope.type !== 'result') {
		throw new TypeError('The bundled audio codec helper result is invalid.');
	}
	return phase === 'preflight'
		? inspectPreflight(envelope.result) : inspectExecution(envelope.result);
}

function inspectPreflight(value: unknown): HelperResult {
	const record = exactRecord(
		value, ['contractVersion', 'status', 'disposition', 'reason'], 'helper preflight result',
	);
	if (record.contractVersion !== 1 || record.status !== 'preflight') {
		throw new TypeError('The bundled audio codec helper preflight is invalid.');
	}
	if (record.disposition === 'supported' && record.reason === null) return Object.freeze({
		status: 'preflight', disposition: 'supported', reason: null,
	});
	if ((record.disposition === 'unsupported' || record.disposition === 'unavailable'
		|| record.disposition === 'rejected') && validDetail(record.reason)) return Object.freeze({
		status: 'preflight', disposition: record.disposition, reason: record.reason,
	});
	throw new TypeError('The bundled audio codec helper preflight is invalid.');
}

function inspectExecution(value: unknown): HelperResult {
	const status = dataProperty(value, 'status', 'helper execution result');
	if (status === 'failed') {
		const record = exactRecord(
			value, ['contractVersion', 'status', 'reason', 'detail'], 'helper execution failure',
		);
		if (record.contractVersion !== 1 || typeof record.reason !== 'string'
			|| !FAILURE_REASONS.has(record.reason) || !validDetail(record.detail)) {
			throw new TypeError('The bundled audio codec helper execution failure is invalid.');
		}
		return Object.freeze({
			status: 'failed', reason: record.reason as Extract<
				DesktopAudioCodecProviderExecutionResult, { status: 'failed' }
			>['reason'], detail: record.detail,
		});
	}
	const record = value && typeof value === 'object'
		&& Object.hasOwn(value, 'decodedGeometry')
		? exactRecord(value, [
			'contractVersion', 'status', 'outputBytes', 'outputSha256', 'decodedGeometry',
		], 'helper decoded result')
		: exactRecord(value, [
			'contractVersion', 'status', 'outputBytes', 'outputSha256',
		], 'helper encoded result');
	if (record.contractVersion !== 1 || record.status !== 'executed'
		|| typeof record.outputSha256 !== 'string' || !SHA256.test(record.outputSha256)) {
		throw new TypeError('The bundled audio codec helper execution result is invalid.');
	}
	return Object.freeze({
		status: 'executed',
		outputBytes: integer(record.outputBytes, 1, 128 * 1024 * 1024, 'output byte length'),
		outputSha256: record.outputSha256,
		...(Object.hasOwn(record, 'decodedGeometry')
			? { decodedGeometry: decodedGeometry(record.decodedGeometry, Number(record.outputBytes)) } : {}),
	});
}

function decodedGeometry(value: unknown, outputBytes: number) {
	const record = exactRecord(value, ['sampleRate', 'channelCount', 'frameCount'], 'decoded geometry');
	const sampleRate = integer(record.sampleRate, 8_000, 192_000, 'decoded sample rate');
	const channelCount = integer(record.channelCount, 1, 8, 'decoded channel count');
	const frameCount = integer(record.frameCount, 1, Number.MAX_SAFE_INTEGER, 'decoded frame count');
	if (frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT !== outputBytes) {
		throw new TypeError('The bundled audio codec helper geometry is invalid.');
	}
	return Object.freeze({ sampleRate, channelCount, frameCount });
}

function supervisionFailure(phase: JobPhase, reason: SupervisionFailure) {
	if (reason === 'cancelled') return failure(phase, 'cancelled', DETAILS.cancelled);
	if (reason === 'helper-protocol') return failure(phase, 'security-failed', DETAILS[reason]);
	if (reason === 'helper-failed') return failure(phase, 'execution-failed', DETAILS[reason]);
	return failure(phase, 'process-failed', DETAILS[reason]);
}

function failure(
	phase: JobPhase,
	reason: Extract<DesktopAudioCodecProviderExecutionResult, { status: 'failed' }>['reason'],
	detail: string,
): DesktopCodecPreflightResult | DesktopAudioCodecProviderExecutionResult {
	if (phase === 'preflight') return reason === 'unavailable'
		? Object.freeze({ disposition: 'unavailable', reason: detail })
		: Object.freeze({ disposition: 'rejected', reason: detail });
	return Object.freeze({ status: 'failed', reason, detail });
}

async function prepareScratch(root: string): Promise<string> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(join(root, 'bundled-audio-codec-'));
	try { await chmod(directory, 0o700); return directory; }
	catch (error) {
		await rm(directory, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
}

function helperConfiguration(
	value: unknown,
	target: DesktopCodecTarget,
	codec: BundledAudioCodecId,
): BundledAudioCodecHelperConfiguration {
	const record = exactRecord(value, CONFIGURATION_FIELDS, 'helper configuration');
	if (record.contractVersion !== 1 || record.target !== target || record.codec !== codec
		|| typeof record.runtimeRoot !== 'string' || !isAbsolute(record.runtimeRoot)
		|| record.runtimeRoot.includes('\0') || typeof record.moduleSha256 !== 'string'
		|| !SHA256.test(record.moduleSha256) || typeof record.wasmSha256 !== 'string'
		|| !SHA256.test(record.wasmSha256)) throw new TypeError('The helper configuration is invalid.');
	return Object.freeze({
		contractVersion: 1, target, codec, runtimeRoot: record.runtimeRoot,
		moduleBytes: integer(record.moduleBytes, 1, 2 * 1024 * 1024, 'module byte length'),
		moduleSha256: record.moduleSha256,
		wasmBytes: integer(record.wasmBytes, 8, 2 * 1024 * 1024, 'wasm byte length'),
		wasmSha256: record.wasmSha256,
	});
}

function validateOptions(options: Readonly<{
	target: DesktopCodecTarget;
	scratchRoot: string;
	verifyPayload: unknown;
	spawn: unknown;
	maximumDurationMs?: number;
	killWaitMs?: number;
	maximumActiveJobs?: number;
}>): void {
	if (!options || typeof options !== 'object' || typeof options.target !== 'string'
		|| !TARGETS.has(options.target) || typeof options.scratchRoot !== 'string'
		|| !isAbsolute(options.scratchRoot) || options.scratchRoot.includes('\0')
		|| typeof options.verifyPayload !== 'function' || typeof options.spawn !== 'function') {
		throw new TypeError('The bundled audio codec operation runner options are invalid.');
	}
}

function inspectedChild(value: unknown): BundledAudioCodecChild {
	if (!value || typeof value !== 'object' || typeof (value as BundledAudioCodecChild).postMessage !== 'function'
		|| typeof (value as BundledAudioCodecChild).onMessage !== 'function'
		|| typeof (value as BundledAudioCodecChild).onExit !== 'function'
		|| typeof (value as BundledAudioCodecChild).kill !== 'function') {
		throw new TypeError('The bundled audio codec child is invalid.');
	}
	return value as BundledAudioCodecChild;
}

function codecId(value: unknown): BundledAudioCodecId {
	if (typeof value !== 'string' || !CODECS.has(value)) {
		throw new TypeError('The bundled audio codec ID is invalid.');
	}
	return value as BundledAudioCodecId;
}

function executionSignal(value: unknown): AbortSignal | undefined {
	if (value !== undefined && !(value instanceof AbortSignal)) {
		throw new TypeError('The bundled audio codec abort signal is invalid.');
	}
	return value;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is invalid.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| keys.some((key) => !Object.hasOwn(descriptors[key as keyof typeof descriptors]!, 'value'))) {
		throw new TypeError(`${label} has an inexact shape.`);
	}
	return value as Record<string, unknown>;
}

function dataProperty(value: unknown, name: string, label: string): unknown {
	if (!value || typeof value !== 'object') throw new TypeError(`${label} is invalid.`);
	const descriptor = Object.getOwnPropertyDescriptor(value, name);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} is invalid.`);
	return descriptor.value;
}

function validDetail(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 1 && Buffer.byteLength(value) <= DETAIL_BYTES;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The bundled audio codec ${label} is invalid.`);
	}
	return Number(value);
}

function digest(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

class HelperJobError extends Error {}
