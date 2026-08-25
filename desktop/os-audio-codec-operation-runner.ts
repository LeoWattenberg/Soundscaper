/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned staging and one-shot utility-process supervision for reviewed OS audio codecs. */

import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { readBoundedRegularFile } from './bounded-regular-file.ts';
import {
	normalizeDesktopAudioCodecRequest,
	type DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.ts';
import {
	inspectOperatingSystemAudioSource,
	inspectOperatingSystemMp3SourceProfile,
} from './os-audio-codec-source-inspection.ts';

export type OperatingSystemAudioCodecTarget = 'mac-arm64' | 'win-x64' | 'win-arm64';

export interface OperatingSystemAudioCodecChildConfiguration {
	readonly contractVersion: 1;
	readonly target: OperatingSystemAudioCodecTarget;
	readonly addonPath: string;
	readonly addonSha256: string;
}

export interface OperatingSystemAudioCodecAddonDescriptor {
	readonly target: OperatingSystemAudioCodecTarget;
	readonly path: string;
	readonly sha256: string;
}

export interface OperatingSystemAudioCodecChild {
	postMessage(message: unknown): void;
	onMessage(listener: (message: unknown) => void): () => void;
	onExit(listener: (code: number | null) => void): () => void;
	kill(): void;
}

export type OperatingSystemAudioCodecUnavailableReason =
	| 'api-unavailable'
	| 'busy'
	| 'cancelled'
	| 'cleanup-failed'
	| 'helper-crashed'
	| 'helper-failed'
	| 'helper-protocol'
	| 'helper-timeout'
	| 'output-invalid'
	| 'payload-unavailable'
	| 'request-rejected'
	| 'scratch-failed'
	| 'spawn-failed'
	| 'tuple-unsupported';

export type OperatingSystemAudioCodecOperationResult = Readonly<{
	readonly status: 'executed';
	readonly output: Uint8Array;
	readonly decodedGeometry: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly frameCount: number;
	}>;
}> | Readonly<{
	readonly status: 'executed';
	readonly output: Uint8Array;
}> | Readonly<{
	readonly status: 'unavailable';
	readonly reason: OperatingSystemAudioCodecUnavailableReason;
	readonly detail: string;
}>;

export interface OperatingSystemAudioCodecOperationRunnerOptions {
	/** Fixed main-owned parent; operation callers never choose filesystem paths. */
	readonly scratchRoot: string;
	/** Re-opens and authenticates the exact target addon immediately before every spawn. */
	readonly verifyAddon: () => Promise<OperatingSystemAudioCodecAddonDescriptor>;
	readonly spawn: (
		configuration: OperatingSystemAudioCodecChildConfiguration,
	) => OperatingSystemAudioCodecChild;
	readonly maximumDurationMs?: number;
	readonly killWaitMs?: number;
}

export interface OperatingSystemAudioCodecOperationRunner {
	execute(
		request: DesktopAudioCodecRequest,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): Promise<OperatingSystemAudioCodecOperationResult>;
}

interface StagedFiles {
	readonly inputPath: string;
	readonly outputPath: string;
}

type HelperResult = Readonly<{
	readonly status: 'decoded';
	readonly outputBytes: number;
	readonly outputSha256: string;
	readonly decodedGeometry: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly frameCount: number;
	}>;
}> | Readonly<{
	readonly status: 'encoded';
	readonly outputBytes: number;
	readonly outputSha256: string;
	readonly encodedTuple: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly frameCount: number;
		readonly bitrateKbps: number;
	}>;
}> | Extract<OperatingSystemAudioCodecOperationResult, { readonly status: 'unavailable' }>;

type ReviewedAudioDecodeRequest = Extract<
	DesktopAudioCodecRequest,
	{ readonly operation: 'audio-decode' }
> & Readonly<{ readonly format: 'mp3' | 'aac-m4a' }>;

type ReviewedAudioEncodeRequest = Extract<
	DesktopAudioCodecRequest,
	{ readonly operation: 'audio-encode' }
> & Readonly<{ readonly format: 'aac-m4a' | 'mp3' }>;

type ReviewedAudioCodecRequest = ReviewedAudioDecodeRequest | ReviewedAudioEncodeRequest;

const SHA256 = /^[a-f0-9]{64}$/u;
const TARGETS = new Set<string>(['mac-arm64', 'win-x64', 'win-arm64']);
const DEFAULT_DURATION_MS = 30_000;
const MAXIMUM_DURATION_MS = 5 * 60_000;
const DEFAULT_KILL_WAIT_MS = 1_000;
const MAXIMUM_KILL_WAIT_MS = 5_000;

const DETAILS: Readonly<Record<OperatingSystemAudioCodecUnavailableReason, string>> = Object.freeze({
	'api-unavailable': 'The target operating-system audio codec API is unavailable.',
	busy: 'Another OS audio codec operation is already active.',
	cancelled: 'The OS audio codec operation was cancelled.',
	'cleanup-failed': 'The OS audio codec scratch directory could not be removed.',
	'helper-crashed': 'The OS audio codec helper exited before a valid result.',
	'helper-failed': 'The native OS audio codec job failed after admission.',
	'helper-protocol': 'The OS audio codec helper violated its closed protocol.',
	'helper-timeout': 'The OS audio codec helper exceeded its runtime limit.',
	'output-invalid': 'The OS audio codec helper output failed exact authentication.',
	'payload-unavailable': 'No authenticated target-native OS audio codec payload is available.',
	'request-rejected': 'The OS audio codec runtime admits only reviewed MP3/AAC decode or exact AAC/MP3 encode.',
	'scratch-failed': 'The OS audio codec scratch files could not be prepared.',
	'spawn-failed': 'The OS audio codec helper could not be started.',
	'tuple-unsupported': 'The operating-system audio codec rejected this exact stream tuple.',
});

export function createOperatingSystemAudioCodecOperationRunner(
	options: OperatingSystemAudioCodecOperationRunnerOptions,
): OperatingSystemAudioCodecOperationRunner {
	validateOptions(options);
	const maximumDurationMs = boundedInteger(
		options.maximumDurationMs ?? DEFAULT_DURATION_MS,
		1, MAXIMUM_DURATION_MS, 'OS audio codec maximum duration',
	);
	const killWaitMs = boundedInteger(
		options.killWaitMs ?? DEFAULT_KILL_WAIT_MS,
		1, MAXIMUM_KILL_WAIT_MS, 'OS audio codec kill wait',
	);
	let active = false;

	return Object.freeze({
		async execute(
			requestValue: DesktopAudioCodecRequest,
			executionOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
		): Promise<OperatingSystemAudioCodecOperationResult> {
			let request: DesktopAudioCodecRequest;
			try { request = normalizeDesktopAudioCodecRequest(requestValue); }
			catch { return unavailable('request-rejected'); }
			if (!reviewedAudioCodecRequest(request)) {
				return unavailable('request-rejected');
			}
			const signal = executionSignal(executionOptions?.signal);
			if (signal?.aborted) return unavailable('cancelled');
			if (active) return unavailable('busy');
			active = true;
			try {
				return await executeActive({
					request, signal, scratchRoot: options.scratchRoot,
					verifyAddon: options.verifyAddon, spawn: options.spawn,
					maximumDurationMs, killWaitMs,
				});
			} finally { active = false; }
		},
	});
}

function reviewedAudioCodecRequest(
	request: DesktopAudioCodecRequest,
): request is ReviewedAudioCodecRequest {
	if (request.operation === 'audio-decode') {
		return request.format === 'mp3' || request.format === 'aac-m4a';
	}
	return request.operation === 'audio-encode'
		&& (request.format === 'aac-m4a' || request.format === 'mp3')
		&& request.sampleRate === 48_000 && request.channelCount === 2
		&& request.settings.bitrateKbps === (request.format === 'mp3' ? 192 : 160);
}

async function executeActive(options: Readonly<{
	request: ReviewedAudioCodecRequest;
	signal: AbortSignal | undefined;
	scratchRoot: string;
	verifyAddon: () => Promise<OperatingSystemAudioCodecAddonDescriptor>;
	spawn: (configuration: OperatingSystemAudioCodecChildConfiguration) => OperatingSystemAudioCodecChild;
	maximumDurationMs: number;
	killWaitMs: number;
}>): Promise<OperatingSystemAudioCodecOperationResult> {
	let scratchDirectory: string | null = null;
	let result: OperatingSystemAudioCodecOperationResult;
	try {
		scratchDirectory = await prepareScratch(options.scratchRoot);
		const files: StagedFiles = Object.freeze({
			inputPath: join(scratchDirectory, options.request.operation === 'audio-encode'
				? 'input.f32le' : options.request.format === 'mp3' ? 'input.mp3' : 'input.m4a'),
			outputPath: join(scratchDirectory, options.request.operation === 'audio-encode'
				? options.request.format === 'mp3' ? 'output.mp3' : 'output.m4a' : 'output.f32le'),
		});
		await writeFile(files.inputPath, Buffer.from(options.request.input), { flag: 'wx', mode: 0o600 });
		result = await executeStaged({ ...options, files });
	} catch { result = unavailable('scratch-failed'); }
	finally {
		if (scratchDirectory !== null) {
			try { await rm(scratchDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 }); }
			catch { result = unavailable('cleanup-failed'); }
		}
	}
	return result!;
}

async function executeStaged(options: Readonly<{
	request: ReviewedAudioCodecRequest;
	signal: AbortSignal | undefined;
	files: StagedFiles;
	verifyAddon: () => Promise<OperatingSystemAudioCodecAddonDescriptor>;
	spawn: (configuration: OperatingSystemAudioCodecChildConfiguration) => OperatingSystemAudioCodecChild;
	maximumDurationMs: number;
	killWaitMs: number;
}>): Promise<OperatingSystemAudioCodecOperationResult> {
	if (options.signal?.aborted) return unavailable('cancelled');
	let descriptor: OperatingSystemAudioCodecAddonDescriptor;
	try { descriptor = addonDescriptor(await options.verifyAddon()); }
	catch { return unavailable('payload-unavailable'); }
	if (options.request.operation === 'audio-encode' && options.request.format === 'mp3'
		&& !descriptor.target.startsWith('win-')) return unavailable('tuple-unsupported');
	if (options.signal?.aborted) return unavailable('cancelled');
	const configuration: OperatingSystemAudioCodecChildConfiguration = Object.freeze({
		contractVersion: 1,
		target: descriptor.target,
		addonPath: descriptor.path,
		addonSha256: descriptor.sha256,
	});
	let child: OperatingSystemAudioCodecChild;
	try { child = inspectedChild(options.spawn(configuration)); }
	catch { return unavailable('spawn-failed'); }
	const helperResult = await superviseChild({
		child, configuration, files: options.files,
		operation: options.request.operation,
		format: options.request.format,
		input: options.request.input, maximumOutputBytes: options.request.maximumOutputBytes,
		...(options.request.operation === 'audio-encode' ? {
			sampleRate: options.request.sampleRate,
			channelCount: options.request.channelCount,
			bitrateKbps: options.request.settings.bitrateKbps,
		} : {}),
		signal: options.signal, maximumDurationMs: options.maximumDurationMs,
		killWaitMs: options.killWaitMs,
	});
	if (helperResult.status === 'unavailable') return helperResult;
	const output = await readBoundedRegularFile(options.files.outputPath, options.request.maximumOutputBytes);
	if (output.status !== 'available' || output.bytes.byteLength !== helperResult.outputBytes
		|| digest(output.bytes) !== helperResult.outputSha256) return unavailable('output-invalid');
	if (options.request.operation === 'audio-encode') {
		if (helperResult.status !== 'encoded') return unavailable('output-invalid');
		const tuple = helperResult.encodedTuple;
		const frameCount = options.request.input.byteLength
			/ (options.request.channelCount * Float32Array.BYTES_PER_ELEMENT);
		const mp3Profile = options.request.format === 'mp3'
			? inspectOperatingSystemMp3SourceProfile(output.bytes) : null;
		const inspected = options.request.format === 'mp3'
			? mp3Profile
			: inspectOperatingSystemAudioSource('aac-m4a', output.bytes);
		if (tuple.sampleRate !== options.request.sampleRate
			|| tuple.channelCount !== options.request.channelCount
			|| tuple.frameCount !== frameCount
			|| tuple.bitrateKbps !== options.request.settings.bitrateKbps
			|| inspected?.sampleRate !== options.request.sampleRate
			|| inspected?.channelCount !== options.request.channelCount
			|| options.request.format === 'mp3'
				&& mp3Profile?.bitrateKbps !== options.request.settings.bitrateKbps) return unavailable('output-invalid');
		return Object.freeze({ status: 'executed', output: output.bytes });
	}
	if (helperResult.status !== 'decoded') return unavailable('output-invalid');
	const geometry = helperResult.decodedGeometry;
	const expectedBytes = geometry.frameCount * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes !== output.bytes.byteLength) {
		return unavailable('output-invalid');
	}
	return Object.freeze({ status: 'executed', output: output.bytes, decodedGeometry: geometry });
}

async function prepareScratch(root: string): Promise<string> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(join(root, 'os-audio-codec-'));
	try { await chmod(directory, 0o700); return directory; }
	catch (error) {
		await rm(directory, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
}

function superviseChild(options: Readonly<{
	child: OperatingSystemAudioCodecChild;
	configuration: OperatingSystemAudioCodecChildConfiguration;
	files: StagedFiles;
	operation: 'audio-decode' | 'audio-encode';
	format: 'mp3' | 'aac-m4a';
	input: Uint8Array;
	maximumOutputBytes: number;
	sampleRate?: number;
	channelCount?: number;
	bitrateKbps?: number;
	signal: AbortSignal | undefined;
	maximumDurationMs: number;
	killWaitMs: number;
}>): Promise<HelperResult> {
	return new Promise((resolve) => {
		let phase: 'ready' | 'running' | 'terminal' = 'ready';
		let terminal: HelperResult | null = null;
		let stopping: 'cancelled' | 'helper-protocol' | 'helper-timeout' | null = null;
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
					inspectReady(value, options.configuration.target);
					phase = 'running';
					options.child.postMessage(Object.freeze({
						contractVersion: 1, type: 'job',
						request: Object.freeze({
							contractVersion: 1,
							operation: options.operation,
							format: options.format,
							inputPath: options.files.inputPath,
							outputPath: options.files.outputPath,
							inputBytes: options.input.byteLength,
							inputSha256: digest(options.input),
							maximumOutputBytes: options.maximumOutputBytes,
							...(options.operation === 'audio-encode' ? {
								sampleRate: options.sampleRate,
								channelCount: options.channelCount,
								bitrateKbps: options.bitrateKbps,
							} : {}),
						}),
					}));
					return;
				}
				if (phase !== 'running') throw new TypeError('Duplicate terminal helper message.');
				terminal = inspectTerminal(value, options.operation);
				phase = 'terminal';
			} catch { stop('helper-protocol'); }
		}

		function onExit(code: number | null): void {
			if (settled) return;
			if (stopping !== null) { finish(unavailable(stopping)); return; }
			if (phase === 'terminal' && terminal !== null && code === 0) { finish(terminal); return; }
			finish(unavailable('helper-crashed'));
		}

		function stop(reason: NonNullable<typeof stopping>): void {
			if (settled || stopping !== null) return;
			stopping = reason;
			try { options.child.kill(); }
			catch { finish(unavailable(reason)); return; }
			killTimer = setTimeout(() => finish(unavailable(reason)), options.killWaitMs);
		}

		function finish(result: HelperResult): void {
			if (settled) return;
			settled = true;
			clearTimeout(durationTimer);
			if (killTimer !== null) clearTimeout(killTimer);
			options.signal?.removeEventListener('abort', onAbort);
			removeMessage();
			removeExit();
			resolve(result);
		}
	});
}

function inspectReady(value: unknown, target: OperatingSystemAudioCodecTarget): void {
	const record = exactRecord(value, ['contractVersion', 'type', 'target'], 'OS audio codec helper ready');
	if (record.contractVersion !== 1 || record.type !== 'ready' || record.target !== target) {
		throw new TypeError('The OS audio codec helper ready message is invalid.');
	}
}

function inspectTerminal(
	value: unknown,
	operation: 'audio-decode' | 'audio-encode',
): HelperResult {
	const type = dataProperty(value, 'type', 'OS audio codec helper terminal message');
	if (type === 'error') {
		const record = exactRecord(value, ['contractVersion', 'type', 'code'], 'OS audio codec helper error');
		if (record.contractVersion !== 1 || record.code !== 'job-failed') {
			throw new TypeError('The OS audio codec helper error is invalid.');
		}
		return unavailable('helper-failed');
	}
	const envelope = exactRecord(value, ['contractVersion', 'type', 'result'], 'OS audio codec helper result');
	if (envelope.contractVersion !== 1 || envelope.type !== 'result') {
		throw new TypeError('The OS audio codec helper result envelope is invalid.');
	}
	const status = dataProperty(envelope.result, 'status', 'OS audio codec helper result');
	if (status === 'unavailable') {
		const record = exactRecord(
			envelope.result,
			['contractVersion', 'status', 'reason', 'nativeApiReached'],
			'OS audio codec helper unavailable result',
		);
		if (record.contractVersion !== 1 || record.nativeApiReached !== true
			&& record.nativeApiReached !== false
			|| record.reason !== 'api-unavailable' && record.reason !== 'tuple-unsupported') {
			throw new TypeError('The OS audio codec helper unavailability is invalid.');
		}
		return unavailable(record.reason);
	}
	if (operation === 'audio-encode') {
		const record = exactRecord(envelope.result, [
			'contractVersion', 'status', 'nativeApiReached', 'exactTuplePassed',
			'outputBytes', 'outputSha256', 'encodedTuple',
		], 'OS audio codec helper encoded result');
		if (record.contractVersion !== 1 || record.status !== 'encoded'
			|| record.nativeApiReached !== true || record.exactTuplePassed !== true
			|| typeof record.outputSha256 !== 'string' || !SHA256.test(record.outputSha256)) {
			throw new TypeError('The OS audio codec helper encoded result is invalid.');
		}
		const tuple = encodedTuple(record.encodedTuple);
		return Object.freeze({
			status: 'encoded',
			outputBytes: boundedInteger(
				record.outputBytes, 1, 128 * 1024 * 1024, 'OS audio codec output byte length',
			),
			outputSha256: record.outputSha256,
			encodedTuple: tuple,
		});
	}
	const record = exactRecord(envelope.result, [
		'contractVersion', 'status', 'nativeApiReached', 'exactTuplePassed',
		'outputBytes', 'outputSha256', 'decodedGeometry',
	], 'OS audio codec helper decoded result');
	if (record.contractVersion !== 1 || record.status !== 'decoded'
		|| record.nativeApiReached !== true || record.exactTuplePassed !== true
		|| typeof record.outputSha256 !== 'string' || !SHA256.test(record.outputSha256)) {
		throw new TypeError('The OS audio codec helper decoded result is invalid.');
	}
	const geometry = decodedGeometry(record.decodedGeometry);
	const outputBytes = boundedInteger(
		record.outputBytes, 1, 128 * 1024 * 1024, 'OS audio codec output byte length',
	);
	if (geometry.frameCount * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT !== outputBytes) {
		throw new TypeError('The OS audio codec helper decoded geometry is invalid.');
	}
	return Object.freeze({
		status: 'decoded', outputBytes, outputSha256: record.outputSha256, decodedGeometry: geometry,
	});
}

function encodedTuple(value: unknown): Extract<HelperResult, { status: 'encoded' }>['encodedTuple'] {
	const record = exactRecord(
		value, ['sampleRate', 'channelCount', 'frameCount', 'bitrateKbps'],
		'OS audio codec encoded tuple',
	);
	return Object.freeze({
		sampleRate: boundedInteger(record.sampleRate, 8_000, 192_000, 'encoded sample rate'),
		channelCount: boundedInteger(record.channelCount, 1, 8, 'encoded channel count'),
		frameCount: boundedInteger(record.frameCount, 1, Number.MAX_SAFE_INTEGER, 'encoded frame count'),
		bitrateKbps: boundedInteger(record.bitrateKbps, 1, 1_000, 'encoded bitrate'),
	});
}

function decodedGeometry(value: unknown): Extract<HelperResult, { status: 'decoded' }>['decodedGeometry'] {
	const record = exactRecord(
		value, ['sampleRate', 'channelCount', 'frameCount'], 'OS audio codec decoded geometry',
	);
	return Object.freeze({
		sampleRate: boundedInteger(record.sampleRate, 8_000, 192_000, 'decoded sample rate'),
		channelCount: boundedInteger(record.channelCount, 1, 8, 'decoded channel count'),
		frameCount: boundedInteger(record.frameCount, 1, Number.MAX_SAFE_INTEGER, 'decoded frame count'),
	});
}

function addonDescriptor(value: unknown): OperatingSystemAudioCodecAddonDescriptor {
	if (!value || typeof value !== 'object') throw new TypeError('The OS audio codec addon descriptor is invalid.');
	const target = dataProperty(value, 'target', 'OS audio codec addon descriptor');
	const path = dataProperty(value, 'path', 'OS audio codec addon descriptor');
	const sha256 = dataProperty(value, 'sha256', 'OS audio codec addon descriptor');
	if (typeof target !== 'string' || !TARGETS.has(target) || typeof path !== 'string'
		|| !isAbsolute(path) || path.includes('\0') || typeof sha256 !== 'string' || !SHA256.test(sha256)) {
		throw new TypeError('The OS audio codec addon descriptor is invalid.');
	}
	return Object.freeze({ target: target as OperatingSystemAudioCodecTarget, path, sha256 });
}

function inspectedChild(value: unknown): OperatingSystemAudioCodecChild {
	if (!value || typeof value !== 'object') throw new TypeError('The OS audio codec helper child is invalid.');
	const child = value as OperatingSystemAudioCodecChild;
	if (typeof child.postMessage !== 'function' || typeof child.onMessage !== 'function'
		|| typeof child.onExit !== 'function' || typeof child.kill !== 'function') {
		throw new TypeError('The OS audio codec helper child is invalid.');
	}
	return child;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is invalid.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| keys.some((key) => !Object.hasOwn(descriptors[key as string]!, 'value'))) {
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

function executionSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	if (!(value instanceof AbortSignal)) throw new TypeError('The OS audio codec AbortSignal is invalid.');
	return value;
}

function validateOptions(options: OperatingSystemAudioCodecOperationRunnerOptions): void {
	if (!options || typeof options !== 'object' || typeof options.scratchRoot !== 'string'
		|| !isAbsolute(options.scratchRoot) || options.scratchRoot.includes('\0')
		|| typeof options.verifyAddon !== 'function' || typeof options.spawn !== 'function') {
		throw new TypeError('The OS audio codec operation runner options are invalid.');
	}
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

function unavailable(
	reason: OperatingSystemAudioCodecUnavailableReason,
): Extract<OperatingSystemAudioCodecOperationResult, { readonly status: 'unavailable' }> {
	return Object.freeze({ status: 'unavailable', reason, detail: DETAILS[reason] });
}
