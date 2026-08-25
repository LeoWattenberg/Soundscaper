/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated one-shot utility-process boundary for reviewed bundled audio codecs. */

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from './desktop-audio-codec-broker.js';
import type {
	DesktopAudioCodecFormat,
	DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.js';
import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
} from '../src/common/editor/desktop-codec-coordinator.js';
import type { DesktopCodecTarget } from '../src/common/editor/desktop-codec-provider-catalog.js';

export const BUNDLED_AUDIO_CODEC_IDS = Object.freeze([
	'flac', 'lame', 'mpg123', 'opus', 'twolame', 'vorbis', 'wavpack',
] as const);
export type BundledAudioCodecId = typeof BUNDLED_AUDIO_CODEC_IDS[number];

export interface BundledAudioCodecHelperConfiguration {
	readonly contractVersion: 1;
	readonly target: DesktopCodecTarget;
	readonly codec: BundledAudioCodecId;
	readonly runtimeRoot: string;
	readonly moduleBytes: number;
	readonly moduleSha256: string;
	readonly wasmBytes: number;
	readonly wasmSha256: string;
}

export interface BundledAudioCodecHelperWorker {
	handleMessage(value: unknown): void;
}

interface HelperPorts {
	readonly lstat?: typeof lstat;
	readonly readFile?: typeof readFile;
	readonly realpath?: typeof realpath;
	readonly writeFile?: typeof writeFile;
	readonly importRuntime?: (
		modulePath: string,
		options: Readonly<{
			readonly target: DesktopCodecTarget;
			readonly readPayload: () => Promise<Uint8Array>;
		}>,
	) => Promise<DesktopAudioCodecProviderRuntime | null>;
}

interface CodecSpec {
	readonly moduleFile: string;
	readonly wasmFile: string;
	readonly loaderName: string;
	readonly providerId: (target: DesktopCodecTarget) => string;
}

type HelperPreflightResult = Readonly<{
	readonly contractVersion: 1;
	readonly status: 'preflight';
	readonly disposition: DesktopCodecPreflightResult['disposition'];
	readonly reason: string | null;
}>;

type HelperExecutionResult = Readonly<{
	readonly contractVersion: 1;
	readonly status: 'executed';
	readonly outputBytes: number;
	readonly outputSha256: string;
	readonly decodedGeometry?: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly frameCount: number;
	}>;
}> | Readonly<{
	readonly contractVersion: 1;
	readonly status: 'failed';
	readonly reason: DesktopAudioCodecProviderExecutionResult extends infer _Result
		? 'unavailable' | 'cancelled' | 'execution-failed' | 'security-failed' | 'process-failed' | 'result-failed'
		: never;
	readonly detail: string;
}>;

type HelperJobResult = HelperPreflightResult | HelperExecutionResult;

const TARGETS = new Set<string>([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const CODEC_IDS = new Set<string>(BUNDLED_AUDIO_CODEC_IDS);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_INPUT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const MAXIMUM_MODULE_BYTES = 2 * 1024 * 1024;
const PATH_BYTES = 4_096;
const DETAIL_BYTES = 2_048;
const FAILURE_REASONS = new Set<string>([
	'unavailable', 'cancelled', 'execution-failed', 'security-failed', 'process-failed', 'result-failed',
]);
const CONFIGURATION_FIELDS = Object.freeze([
	'contractVersion', 'target', 'codec', 'runtimeRoot', 'moduleBytes', 'moduleSha256',
	'wasmBytes', 'wasmSha256',
]);
const JOB_FIELDS = Object.freeze(['contractVersion', 'type', 'phase', 'operation', 'request']);
const REQUEST_FIELDS = Object.freeze([
	'contractVersion', 'operation', 'format', 'inputPath', 'outputPath', 'inputBytes',
	'inputSha256', 'maximumOutputBytes', 'sampleRate', 'channelCount', 'settings',
]);
const OPERATION_FIELDS = Object.freeze([
	'direction', 'mediaKind', 'container', 'codec', 'profile', 'sampleFormat', 'pixelFormat',
	'sampleRate', 'channelCount', 'width', 'height',
]);
const CODECS: Readonly<Record<BundledAudioCodecId, Readonly<CodecSpec>>> = Object.freeze({
	flac: Object.freeze({
		moduleFile: 'desktop/bundled-flac-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/flac/flac.wasm',
		loaderName: 'loadBundledFlacAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-libflac-wasm-${target}`,
	}),
	lame: Object.freeze({
		moduleFile: 'desktop/bundled-lame-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/lame/lame.wasm',
		loaderName: 'loadBundledLameAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-lame-wasm-${target}`,
	}),
	mpg123: Object.freeze({
		moduleFile: 'desktop/bundled-mpg123-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/mpg123/mpg123.wasm',
		loaderName: 'loadBundledMpg123AudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-mpg123-wasm-${target}`,
	}),
	opus: Object.freeze({
		moduleFile: 'desktop/bundled-opus-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/opus/opus.wasm',
		loaderName: 'loadBundledOpusAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-libopus-libogg-wasm-${target}`,
	}),
	twolame: Object.freeze({
		moduleFile: 'desktop/bundled-twolame-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/twolame/twolame.wasm',
		loaderName: 'loadBundledTwolameAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-twolame-wasm-${target}`,
	}),
	vorbis: Object.freeze({
		moduleFile: 'desktop/bundled-vorbis-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/vorbis/vorbis.wasm',
		loaderName: 'loadBundledVorbisAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-libvorbis-libogg-wasm-${target}`,
	}),
	wavpack: Object.freeze({
		moduleFile: 'desktop/bundled-wavpack-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/wavpack/wavpack.wasm',
		loaderName: 'loadBundledWavPackAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-wavpack-wasm-${target}`,
	}),
});

export async function createBundledAudioCodecHelperWorker(options: Readonly<{
	readonly configuration: unknown;
	readonly post: (message: unknown) => void;
	readonly exit: (code: number) => void;
	readonly schedule?: (callback: () => void) => void;
	readonly ports?: HelperPorts;
}>): Promise<BundledAudioCodecHelperWorker> {
	if (!options || typeof options !== 'object' || typeof options.post !== 'function'
		|| typeof options.exit !== 'function'
		|| options.schedule !== undefined && typeof options.schedule !== 'function') {
		throw new TypeError('The bundled audio codec helper worker ports are invalid.');
	}
	const configuration = codecConfiguration(options.configuration);
	const runtime = await loadAuthenticatedRuntime(configuration, options.ports ?? {});
	let phase: 'ready' | 'running' | 'terminal' | 'failed' = 'ready';
	const schedule = options.schedule ?? ((callback: () => void) => { setImmediate(callback); });
	options.post(Object.freeze({
		contractVersion: 1, type: 'ready', target: configuration.target, codec: configuration.codec,
	}));
	return Object.freeze({
		handleMessage(value: unknown): void {
			if (phase !== 'ready') {
				phase = 'failed';
				options.exit(1);
				return;
			}
			phase = 'running';
			void runBundledAudioCodecHelperJob({ configuration, runtime, value, ports: options.ports })
				.then((result) => {
					if (phase !== 'running') return;
					phase = 'terminal';
					options.post(Object.freeze({ contractVersion: 1, type: 'result', result }));
					schedule(() => options.exit(0));
				})
				.catch(() => {
					if (phase !== 'running') return;
					phase = 'terminal';
					options.post(Object.freeze({ contractVersion: 1, type: 'error', code: 'job-failed' }));
					schedule(() => options.exit(0));
				});
		},
	});
}

export async function runBundledAudioCodecHelperJob(options: Readonly<{
	readonly configuration: unknown;
	readonly runtime: DesktopAudioCodecProviderRuntime;
	readonly value: unknown;
	readonly ports?: HelperPorts;
}>): Promise<HelperJobResult> {
	const configuration = codecConfiguration(options.configuration);
	const runtime = inspectedRuntime(options.runtime, configuration);
	const job = exactRecord(options.value, JOB_FIELDS, 'bundled audio codec helper job');
	if (job.contractVersion !== 1 || job.type !== 'job'
		|| job.phase !== 'preflight' && job.phase !== 'execute') {
		throw new TypeError('The bundled audio codec helper job is invalid.');
	}
	const operation = codecOperation(job.operation);
	const wire = codecRequest(job.request, configuration.codec);
	if (dirname(wire.inputPath) !== dirname(wire.outputPath) || wire.inputPath === wire.outputPath) {
		throw new TypeError('Bundled audio codec jobs require sibling private scratch files.');
	}
	const operations = fileOperations(options.ports ?? {});
	await assertAbsent(wire.outputPath, operations.lstat);
	const input = await inspectAuthenticatedFile({
		path: wire.inputPath, expectedBytes: wire.inputBytes, expectedSha256: wire.inputSha256,
		label: 'input', operations,
	});
	const request = Object.freeze({
		operation: wire.operation, format: wire.format, input: new Uint8Array(input),
		sampleRate: wire.sampleRate, channelCount: wire.channelCount,
		settings: wire.settings, maximumOutputBytes: wire.maximumOutputBytes,
	}) as DesktopAudioCodecRequest;
	const preflight = await exactPreflight(runtime, request, operation);
	if (job.phase === 'preflight') return helperPreflight(preflight);
	if (preflight.disposition !== 'supported') return Object.freeze({
		contractVersion: 1, status: 'failed', reason: 'security-failed',
		detail: 'The isolated bundled codec request no longer matches its exact preflight.',
	});
	const execution = inspectedExecution(await runtime.execute(
		request, Object.freeze({ operation }),
	), request.operation);
	if (execution.status === 'failed') return Object.freeze({ contractVersion: 1, ...execution });
	if (execution.output.byteLength > wire.maximumOutputBytes) {
		throw new RangeError('The bundled audio codec output exceeded its bound.');
	}
	await operations.writeFile(wire.outputPath, execution.output, { flag: 'wx', mode: 0o600 });
	return Object.freeze({
		contractVersion: 1, status: 'executed', outputBytes: execution.output.byteLength,
		outputSha256: digest(execution.output),
		...(execution.decodedGeometry === undefined
			? {} : { decodedGeometry: execution.decodedGeometry }),
	});
}

async function loadAuthenticatedRuntime(
	configuration: BundledAudioCodecHelperConfiguration,
	ports: HelperPorts,
): Promise<DesktopAudioCodecProviderRuntime> {
	const spec = CODECS[configuration.codec];
	const operations = fileOperations(ports);
	const modulePath = join(configuration.runtimeRoot, spec.moduleFile);
	const wasmPath = join(configuration.runtimeRoot, spec.wasmFile);
	await inspectAuthenticatedFile({
		path: modulePath, expectedBytes: configuration.moduleBytes,
		expectedSha256: configuration.moduleSha256, label: 'module', operations,
	});
	const payload = await inspectAuthenticatedFile({
		path: wasmPath, expectedBytes: configuration.wasmBytes,
		expectedSha256: configuration.wasmSha256, label: 'wasm', operations,
	});
	const importer = ports.importRuntime ?? (async (path, options) => {
		const module = await import(pathToFileURL(path).href) as Record<string, unknown>;
		const loader = module[spec.loaderName];
		if (typeof loader !== 'function') throw new TypeError('The bundled codec loader export is invalid.');
		return await (loader as (value: unknown) => Promise<DesktopAudioCodecProviderRuntime | null>)({
			target: options.target, readPayload: options.readPayload,
		});
	});
	const runtime = await importer(modulePath, Object.freeze({
		target: configuration.target,
		readPayload: async () => new Uint8Array(payload),
	}));
	await inspectAuthenticatedFile({
		path: modulePath, expectedBytes: configuration.moduleBytes,
		expectedSha256: configuration.moduleSha256, label: 'module', operations,
	});
	return inspectedRuntime(runtime, configuration);
}

async function exactPreflight(
	runtime: DesktopAudioCodecProviderRuntime,
	request: DesktopAudioCodecRequest,
	operation: DesktopCodecOperation,
): Promise<DesktopCodecPreflightResult> {
	const tuple = inspectPreflight(await runtime.provider.preflight(operation, Object.freeze({})));
	if (tuple.disposition !== 'supported' || runtime.preflightRequest === undefined) return tuple;
	return inspectPreflight(await runtime.preflightRequest(request, Object.freeze({ operation })));
}

function helperPreflight(value: DesktopCodecPreflightResult): HelperPreflightResult {
	return Object.freeze({ contractVersion: 1, status: 'preflight', ...value });
}

function inspectPreflight(value: unknown): DesktopCodecPreflightResult {
	const record = exactRecord(value, ['disposition', 'reason'], 'bundled codec preflight result');
	if (record.disposition === 'supported' && record.reason === null) {
		return Object.freeze({ disposition: 'supported', reason: null });
	}
	if ((record.disposition === 'unsupported' || record.disposition === 'unavailable'
		|| record.disposition === 'rejected') && validDetail(record.reason)) {
		return Object.freeze({ disposition: record.disposition, reason: record.reason });
	}
	throw new TypeError('The bundled codec preflight result is invalid.');
}

function inspectedExecution(
	value: unknown,
	operation: 'audio-decode' | 'audio-encode',
): DesktopAudioCodecProviderExecutionResult {
	const status = dataProperty(value, 'status', 'bundled codec execution result');
	if (status === 'failed') {
		const record = exactRecord(value, ['status', 'reason', 'detail'], 'bundled codec failure');
		if (typeof record.reason !== 'string' || !FAILURE_REASONS.has(record.reason)
			|| !validDetail(record.detail)) throw new TypeError('The bundled codec failure is invalid.');
		return Object.freeze({
			status: 'failed', reason: record.reason as Extract<
				DesktopAudioCodecProviderExecutionResult, { status: 'failed' }
			>['reason'], detail: record.detail,
		});
	}
	const fields = operation === 'audio-decode'
		? ['status', 'output', 'decodedGeometry'] : ['status', 'output'];
	const record = exactRecord(value, fields, 'bundled codec execution');
	if (record.status !== 'executed' || !(record.output instanceof Uint8Array)
		|| record.output.byteLength < 1 || record.output.byteLength > MAXIMUM_OUTPUT_BYTES) {
		throw new TypeError('The bundled codec execution result is invalid.');
	}
	if (operation === 'audio-encode') {
		return Object.freeze({ status: 'executed', output: new Uint8Array(record.output) });
	}
	return Object.freeze({
		status: 'executed', output: new Uint8Array(record.output),
		decodedGeometry: decodedGeometry(record.decodedGeometry, record.output.byteLength),
	});
}

function decodedGeometry(value: unknown, outputBytes: number) {
	const record = exactRecord(value, ['sampleRate', 'channelCount', 'frameCount'], 'decoded geometry');
	const sampleRate = integer(record.sampleRate, 8_000, 192_000, 'decoded sample rate');
	const channelCount = integer(record.channelCount, 1, 8, 'decoded channel count');
	const frameCount = integer(record.frameCount, 1, Number.MAX_SAFE_INTEGER, 'decoded frame count');
	if (frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT !== outputBytes) {
		throw new RangeError('The isolated bundled codec decoded geometry is invalid.');
	}
	return Object.freeze({ sampleRate, channelCount, frameCount });
}

function inspectedRuntime(
	value: unknown,
	configuration: BundledAudioCodecHelperConfiguration,
): DesktopAudioCodecProviderRuntime {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The isolated bundled codec runtime is unavailable.');
	}
	const runtime = value as DesktopAudioCodecProviderRuntime;
	if (runtime.provider?.kind !== 'bundled'
		|| runtime.provider.id !== CODECS[configuration.codec].providerId(configuration.target)
		|| typeof runtime.provider.preflight !== 'function' || typeof runtime.execute !== 'function'
		|| runtime.preflightRequest !== undefined && typeof runtime.preflightRequest !== 'function') {
		throw new TypeError('The isolated bundled codec runtime identity is invalid.');
	}
	return runtime;
}

function codecConfiguration(value: unknown): BundledAudioCodecHelperConfiguration {
	const record = exactRecord(value, CONFIGURATION_FIELDS, 'bundled audio codec configuration');
	if (record.contractVersion !== 1 || typeof record.target !== 'string' || !TARGETS.has(record.target)
		|| typeof record.codec !== 'string' || !CODEC_IDS.has(record.codec)) {
		throw new TypeError('The bundled audio codec helper target is invalid.');
	}
	return Object.freeze({
		contractVersion: 1, target: record.target as DesktopCodecTarget,
		codec: record.codec as BundledAudioCodecId,
		runtimeRoot: absolutePath(record.runtimeRoot, 'runtime root'),
		moduleBytes: integer(record.moduleBytes, 1, MAXIMUM_MODULE_BYTES, 'module byte length'),
		moduleSha256: sha256(record.moduleSha256, 'module'),
		wasmBytes: integer(record.wasmBytes, 8, MAXIMUM_MODULE_BYTES, 'wasm byte length'),
		wasmSha256: sha256(record.wasmSha256, 'wasm'),
	});
}

function codecRequest(value: unknown, codec: BundledAudioCodecId) {
	const record = exactRecord(value, REQUEST_FIELDS, 'bundled audio codec request');
	if (record.contractVersion !== 1
		|| record.operation !== 'audio-decode' && record.operation !== 'audio-encode'
		|| typeof record.format !== 'string' || !codecMatches(codec, record.operation, record.format)) {
		throw new TypeError('The bundled audio codec request tuple is invalid.');
	}
	const sampleRate = record.operation === 'audio-decode'
		? null : integer(record.sampleRate, 8_000, 192_000, 'sample rate');
	const channelCount = record.operation === 'audio-decode'
		? null : integer(record.channelCount, 1, 8, 'channel count');
	if (record.operation === 'audio-decode' && (record.sampleRate !== null || record.channelCount !== null)) {
		throw new TypeError('The bundled audio decode geometry is invalid.');
	}
	return Object.freeze({
		contractVersion: 1, operation: record.operation,
		format: record.format as DesktopAudioCodecFormat,
		inputPath: absolutePath(record.inputPath, 'input'),
		outputPath: absolutePath(record.outputPath, 'output'),
		inputBytes: integer(record.inputBytes, 1, MAXIMUM_INPUT_BYTES, 'input byte length'),
		inputSha256: sha256(record.inputSha256, 'input'),
		maximumOutputBytes: integer(record.maximumOutputBytes, 1, MAXIMUM_OUTPUT_BYTES, 'output bound'),
		sampleRate, channelCount, settings: settings(record.settings, record.operation, record.format),
	});
}

function codecOperation(value: unknown): DesktopCodecOperation {
	const record = exactRecord(value, OPERATION_FIELDS, 'bundled audio codec operation');
	if ((record.direction !== 'decode' && record.direction !== 'encode') || record.mediaKind !== 'audio'
		|| !boundedToken(record.container) || !boundedToken(record.codec)
		|| record.profile !== null && !boundedToken(record.profile)
		|| record.sampleFormat !== null && !boundedToken(record.sampleFormat)
		|| record.pixelFormat !== null && !boundedToken(record.pixelFormat)
		|| record.width !== null || record.height !== null
		|| !nullableInteger(record.sampleRate, 8_000, 192_000)
		|| !nullableInteger(record.channelCount, 1, 8)) {
		throw new TypeError('The bundled audio codec operation is invalid.');
	}
	return Object.freeze({ ...record }) as unknown as DesktopCodecOperation;
}

function settings(value: unknown, operation: string, format: string): Readonly<Record<string, number | string>> {
	const fields = operation === 'audio-decode' ? ['sampleFormat']
		: format === 'flac' ? ['compressionLevel', 'bitDepth']
			: format === 'ogg-vorbis' ? ['quality']
				: format === 'wavpack' ? ['compressionLevel'] : ['bitrateKbps'];
	const record = exactRecord(value, fields, 'bundled audio codec settings');
	for (const field of fields) {
		if (typeof record[field] !== 'string' && !Number.isSafeInteger(record[field])) {
			throw new TypeError('The bundled audio codec settings are invalid.');
		}
	}
	return Object.freeze({ ...record }) as Readonly<Record<string, number | string>>;
}

function codecMatches(codec: BundledAudioCodecId, operation: string, format: string): boolean {
	if (codec === 'lame') return operation === 'audio-encode' && format === 'mp3';
	if (codec === 'mpg123') return operation === 'audio-decode' && (format === 'mp3' || format === 'mp2');
	if (codec === 'twolame') return operation === 'audio-encode' && format === 'mp2';
	if (codec === 'vorbis') return format === 'ogg-vorbis';
	return format === codec;
}

function fileOperations(ports: HelperPorts) {
	return Object.freeze({
		lstat: ports.lstat ?? lstat, readFile: ports.readFile ?? readFile,
		realpath: ports.realpath ?? realpath, writeFile: ports.writeFile ?? writeFile,
	});
}

async function inspectAuthenticatedFile(options: Readonly<{
	path: string;
	expectedBytes: number;
	expectedSha256: string;
	label: string;
	operations: ReturnType<typeof fileOperations>;
}>): Promise<Uint8Array> {
	const before = await options.operations.lstat(options.path);
	if (!before.isFile() || before.isSymbolicLink() || before.size !== options.expectedBytes
		|| await options.operations.realpath(options.path) !== options.path) {
		throw new Error(`The bundled audio codec ${options.label} identity is invalid.`);
	}
	const bytes = await options.operations.readFile(options.path);
	const after = await options.operations.lstat(options.path);
	if (!sameFile(before, after) || bytes.byteLength !== options.expectedBytes
		|| digest(bytes) !== options.expectedSha256) {
		throw new Error(`The bundled audio codec ${options.label} digest is invalid.`);
	}
	return new Uint8Array(bytes);
}

async function assertAbsent(path: string, inspect: typeof lstat): Promise<void> {
	try { await inspect(path); }
	catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
		throw error;
	}
	throw new Error('The bundled audio codec output path already exists.');
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

function absolutePath(value: unknown, label: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')
		|| Buffer.byteLength(value) > PATH_BYTES || value.split(/[\\/]/u).includes('..')) {
		throw new TypeError(`The bundled audio codec ${label} path is invalid.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The bundled audio codec ${label} is invalid.`);
	}
	return Number(value);
}

function nullableInteger(value: unknown, minimum: number, maximum: number): boolean {
	return value === null || Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function boundedToken(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('\0');
}

function validDetail(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 1 && Buffer.byteLength(value) <= DETAIL_BYTES;
}

function sha256(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The bundled audio codec ${label} digest is invalid.`);
	}
	return value;
}

function sameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
	return left.dev === right.dev && left.ino === right.ino && left.size === right.size
		&& left.mtimeMs === right.mtimeMs;
}

function digest(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

interface UtilityParentPort {
	on(event: 'message', listener: (event: Readonly<{ readonly data: unknown }>) => void): void;
	postMessage(message: unknown): void;
}

const utilityParentPort = (globalThis.process as NodeJS.Process & {
	readonly parentPort?: UtilityParentPort;
}).parentPort;
if (utilityParentPort && typeof utilityParentPort.on === 'function') {
	void startUtilityProcess(utilityParentPort);
}

async function startUtilityProcess(parentPort: UtilityParentPort): Promise<void> {
	const prefix = '--bundled-audio-codec-config=';
	const argument = process.argv.find((value) => value.startsWith(prefix));
	try {
		const worker = await createBundledAudioCodecHelperWorker({
			configuration: JSON.parse(argument?.slice(prefix.length) ?? 'null') as unknown,
			post: (message) => parentPort.postMessage(message),
			exit: (code) => process.exit(code),
		});
		parentPort.on('message', (event) => { worker.handleMessage(event.data); });
	} catch { process.exit(1); }
}
