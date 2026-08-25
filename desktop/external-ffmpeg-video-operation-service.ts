/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned, owner-scoped streaming sessions for fixed external-FFmpeg video plans. */

import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Writable } from 'node:stream';

import {
	createDesktopExternalFfmpegVideoWorkload,
	DESKTOP_VIDEO_CODEC_MAXIMUM_INPUT_CHUNK_BYTES,
	DESKTOP_VIDEO_CODEC_MAXIMUM_OUTPUT_CHUNK_BYTES,
	normalizeDesktopVideoCodecOperationPlan,
	type DesktopExternalFfmpegVideoCapabilities,
	type DesktopVideoCodecOperationPlan,
} from './desktop-video-codec-operation-contract.js';
import {
	externalFfmpegExecutablePairMatches,
	isExternalFfmpegExecutablePairAdmission,
	type ExternalFfmpegExecutablePairAdmission,
} from './external-ffmpeg-executable-pair-admission.js';
import type {
	ExternalFfmpegPreferenceService,
	ExternalFfmpegRuntimeAdmission,
	ExternalFfmpegRuntimeInvalidationReason,
} from './external-ffmpeg-preference-service.js';
import {
	createExternalFfmpegVideoQualifiedCapabilities,
	type DesktopVideoCodecProductId,
	type ExternalFfmpegVideoQualifier,
} from './external-ffmpeg-video-qualified-capabilities.js';
import {
	closeExternalFfmpegVideoInput,
	curatedExternalFfmpegVideoEnvironment,
	guardExternalFfmpegVideoArguments,
	launchExternalFfmpegVideoProcess,
	writeExternalFfmpegVideoInput,
	type ExternalFfmpegVideoChildProcess,
	type ExternalFfmpegVideoSpawn,
} from './external-ffmpeg-video-process.js';

export type {
	ExternalFfmpegVideoChildProcess,
	ExternalFfmpegVideoLaunchOptions,
	ExternalFfmpegVideoSpawn,
} from './external-ffmpeg-video-process.js';

export type DesktopVideoInputRole = 'video' | 'audio';

export interface ExternalFfmpegVideoOperationServiceOptions {
	readonly productId: DesktopVideoCodecProductId;
	readonly scratchRoot: string;
	readonly preferences: Pick<ExternalFfmpegPreferenceService, 'admission' | 'invalidateAdmission'>;
	readonly digestExecutable?: (path: string) => Promise<string>;
	readonly spawn?: ExternalFfmpegVideoSpawn;
	readonly mintOperationId?: () => string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly maximumDurationMs?: number;
	readonly maximumIdleMs?: number;
	readonly maximumLogBytes?: number;
	readonly terminationGraceMs?: number;
	readonly killWaitMs?: number;
	readonly qualifyAdmission?: ExternalFfmpegVideoQualifier;
}

export interface ExternalFfmpegVideoOperationService<Owner extends object = object> {
	capabilities(): Promise<DesktopExternalFfmpegVideoCapabilities>;
	begin(owner: Owner, plan: unknown): Promise<Readonly<{ readonly operationId: string }>>;
	writeInput(owner: Owner, request: Readonly<{
		readonly operationId: string;
		readonly role: DesktopVideoInputRole;
		readonly offset: number;
		readonly bytes: Uint8Array;
	}>): Promise<Readonly<{ readonly offset: number }>>;
	closeInput(owner: Owner, request: Readonly<{
		readonly operationId: string;
		readonly role: DesktopVideoInputRole;
		readonly offset: number;
	}>): Promise<Readonly<{ readonly offset: number }>>;
	execute(owner: Owner, operationId: string): Promise<Readonly<{ readonly exitCode: 0 }>>;
	statOutput(owner: Owner, operationId: string): Promise<Readonly<{ readonly byteLength: number }>>;
	readOutput(owner: Owner, request: Readonly<{
		readonly operationId: string;
		readonly offset: number;
		readonly maximumBytes: number;
	}>): Promise<Uint8Array<ArrayBuffer>>;
	delete(owner: Owner, operationId: string): Promise<boolean>;
	cancel(owner: Owner, operationId: string): Promise<boolean>;
	revokeOwner(owner: Owner): Promise<boolean>;
	dispose(): void;
}

interface InputState {
	readonly expectedBytes: number;
	writtenBytes: number;
	closed: boolean;
	closing: boolean;
	writing: boolean;
	stream: Writable | null;
}

interface Session<Owner extends object> {
	readonly id: string;
	readonly owner: Owner;
	readonly plan: DesktopVideoCodecOperationPlan;
	readonly admission: ExternalFfmpegRuntimeAdmission;
	readonly pair: ExternalFfmpegExecutablePairAdmission;
	readonly scratchDirectory: string;
	readonly outputPath: string;
	readonly arguments_: readonly string[];
	readonly inputs: Readonly<Record<DesktopVideoInputRole, InputState | null>>;
	readonly controller: AbortController;
	readonly started: Deferred<void>;
	state: 'ready' | 'starting' | 'running' | 'executed' | 'failed' | 'deleted';
	child: ExternalFfmpegVideoChildProcess | null;
	execution: Promise<0> | null;
	output: FileHandle | null;
	outputBytes: number;
	cleanup: Promise<void> | null;
	idleTimer: ReturnType<typeof setTimeout> | null;
}

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
	reject(reason: unknown): void;
}

const OPERATION_ID = /^desktop-video-[a-f0-9]{32}$/u;
const MAXIMUM_SESSIONS = 2;
const HARD_DURATION_MS = 30 * 60 * 1000;
const HARD_LOG_BYTES = 1024 * 1024;
export class DesktopExternalFfmpegVideoOperationError extends Error {
	constructor(readonly reason: string, message: string) {
		super(message);
		this.name = 'DesktopExternalFfmpegVideoOperationError';
	}
}

export function createExternalFfmpegVideoOperationService<Owner extends object = object>(
	options: ExternalFfmpegVideoOperationServiceOptions,
): ExternalFfmpegVideoOperationService<Owner> {
	validateOptions(options);
	const sessions = new Map<string, Session<Owner>>();
	const beginningOwners = new Set<Owner>();
	const digest = options.digestExecutable ?? sha256File;
	const launch = options.spawn;
	const mint = options.mintOperationId ?? (() => `desktop-video-${randomBytes(16).toString('hex')}`);
	const environment = curatedExternalFfmpegVideoEnvironment(options.environment ?? process.env);
	const duration = lowerLimit(options.maximumDurationMs, 5 * 60 * 1000, HARD_DURATION_MS, 'duration');
	const idle = lowerLimit(options.maximumIdleMs, 30_000, 60_000, 'idle duration');
	const logLimit = lowerLimit(options.maximumLogBytes, 64 * 1024, HARD_LOG_BYTES, 'log');
	const terminationGrace = lowerLimit(options.terminationGraceMs, 1000, 5000, 'termination grace');
	const killWait = lowerLimit(options.killWaitMs, 1000, 5000, 'kill wait');
	const qualifiedCapabilities = createExternalFfmpegVideoQualifiedCapabilities({
		productId: options.productId, scratchRoot: options.scratchRoot, preferences: options.preferences,
		digestExecutable: digest, ...(launch ? { spawn: launch } : {}),
		environment: options.environment ?? process.env,
		...(options.qualifyAdmission ? { qualify: options.qualifyAdmission } : {}),
	});
	let disposed = false;

	const cleanup = (session: Session<Owner>): Promise<void> => {
		if (session.cleanup) return session.cleanup;
		session.state = 'deleted';
		sessions.delete(session.id);
		if (session.idleTimer) clearTimeout(session.idleTimer);
		for (const input of Object.values(session.inputs)) input?.stream?.destroy();
		session.cleanup = Promise.resolve().then(async () => {
			if (session.output) await session.output.close();
			await rm(session.scratchDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 });
		});
		return session.cleanup;
	};

	const service: ExternalFfmpegVideoOperationService<Owner> = Object.freeze({
		capabilities: () => qualifiedCapabilities.capabilities(),
		async begin(ownerValue: Owner, planValue: unknown) {
			assertAvailable(disposed);
			const owner = owned(ownerValue);
			const plan = normalizeDesktopVideoCodecOperationPlan(planValue);
			const releaseBegin = reserveBegin(sessions, beginningOwners, owner);
			try {
				const admission = await qualifiedCapabilities.admission(plan.format);
				const pair = executablePair(admission);
				const operationId = operationIdValue(mint());
				if (sessions.has(operationId)) throw operationError('id-collision', 'Desktop video operation ID collision.');
				await mkdir(options.scratchRoot, { recursive: true, mode: 0o700 });
				const scratchDirectory = await mkdtemp(join(options.scratchRoot, 'video-operation-'));
				try { await chmod(scratchDirectory, 0o700); }
				catch (error) {
					await rm(scratchDirectory, { recursive: true, force: true }).catch(() => undefined);
					throw error;
				}
				const outputPath = join(scratchDirectory, `output.${plan.format}`);
				const executionPlan = createDesktopExternalFfmpegVideoWorkload(plan, { outputPath });
				const started = deferred<void>();
				// A rejected start must never become an unhandled rejection when no writer was waiting.
				void started.promise.catch(() => undefined);
				const session: Session<Owner> = {
					id: operationId, owner, plan, admission, pair, scratchDirectory, outputPath,
					arguments_: guardExternalFfmpegVideoArguments(
						executionPlan.ffmpegArguments, plan.maximumOutputBytes,
					),
					inputs: Object.freeze({
						video: inputState(plan.videoInputBytes),
						audio: plan.audioInputBytes === null ? null : inputState(plan.audioInputBytes),
					}),
					controller: new AbortController(), started, state: 'ready', child: null,
					execution: null, output: null, outputBytes: 0, cleanup: null, idleTimer: null,
				};
				sessions.set(operationId, session);
				session.idleTimer = setTimeout(() => {
					const reason = operationError('idle', 'The desktop video session expired while idle.');
					session.controller.abort(reason); session.started.reject(reason);
					void cleanup(session).catch(() => undefined);
				}, idle); session.idleTimer.unref?.();
				return Object.freeze({ operationId });
			} finally { releaseBegin(); }
		},
		async writeInput(
			ownerValue: Owner,
			request: Parameters<ExternalFfmpegVideoOperationService<Owner>['writeInput']>[1],
		) {
			const session = ownedSession(sessions, ownerValue, request?.operationId);
			const input = sessionInput(session, request?.role);
			const offset = nonNegativeInteger(request?.offset, 'input offset');
			const bytes = request?.bytes;
			if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1
				|| bytes.byteLength > DESKTOP_VIDEO_CODEC_MAXIMUM_INPUT_CHUNK_BYTES) {
				throw operationError('input-limit', 'Desktop video input chunk is invalid.');
			}
			if (input.closed || input.closing || input.writing || offset !== input.writtenBytes
				|| bytes.byteLength > input.expectedBytes - input.writtenBytes) {
				throw operationError('input-drift', 'Desktop video input offset or byte count drifted.');
			}
			input.writing = true;
			try {
				await session.started.promise;
				if (session.state !== 'running' || !input.stream) {
					throw operationError('not-running', 'Desktop video process is not running.');
				}
				await writeExternalFfmpegVideoInput(input.stream, bytes, session.controller.signal);
				input.writtenBytes += bytes.byteLength;
				return Object.freeze({ offset: input.writtenBytes });
			} finally { input.writing = false; }
		},
		async closeInput(
			ownerValue: Owner,
			request: Parameters<ExternalFfmpegVideoOperationService<Owner>['closeInput']>[1],
		) {
			const session = ownedSession(sessions, ownerValue, request?.operationId);
			const input = sessionInput(session, request?.role);
			const offset = nonNegativeInteger(request?.offset, 'input close offset');
			if (input.closed || input.closing || input.writing || offset !== input.writtenBytes
				|| input.writtenBytes !== input.expectedBytes) {
				throw operationError('input-drift', 'Desktop video input closed without its exact admitted bytes.');
			}
			input.closing = true;
			try {
				await session.started.promise;
				if (session.state !== 'running' || !input.stream) throw operationError('not-running', 'Desktop video process is not running.');
				await closeExternalFfmpegVideoInput(input.stream, session.controller.signal);
				input.closed = true;
				return Object.freeze({ offset: input.writtenBytes });
			} finally { input.closing = false; }
		},
		async execute(ownerValue: Owner, idValue: string) {
			const session = ownedSession(sessions, ownerValue, idValue);
			if (session.state !== 'ready') throw operationError('state', 'Desktop video session cannot execute twice.');
			if (session.idleTimer) clearTimeout(session.idleTimer); session.idleTimer = null;
			session.state = 'starting';
			const execution = runSession(session, {
				preferences: options.preferences, digest, launch, environment,
				duration, logLimit, terminationGrace, killWait,
			}).catch(async (error: unknown) => {
				session.state = 'failed';
				session.started.reject(error);
				await cleanup(session).catch(() => undefined);
				throw error;
			});
			session.execution = execution;
			await execution;
			return Object.freeze({ exitCode: 0 as const });
		},
		async statOutput(ownerValue: Owner, idValue: string) {
			const session = executedSession(sessions, ownerValue, idValue);
			return Object.freeze({ byteLength: session.outputBytes });
		},
		async readOutput(
			ownerValue: Owner,
			request: Parameters<ExternalFfmpegVideoOperationService<Owner>['readOutput']>[1],
		) {
			const session = executedSession(sessions, ownerValue, request?.operationId);
			const offset = nonNegativeInteger(request?.offset, 'output offset');
			const maximumBytes = boundedInteger(
				request?.maximumBytes, 1, DESKTOP_VIDEO_CODEC_MAXIMUM_OUTPUT_CHUNK_BYTES,
				'output range',
			);
			if (offset >= session.outputBytes) throw operationError('output-range', 'Desktop video output offset is outside the file.');
			const length = Math.min(maximumBytes, session.outputBytes - offset);
			const bytes = Buffer.alloc(length);
			const { bytesRead } = await session.output!.read(bytes, 0, length, offset);
			if (bytesRead !== length) throw operationError('output-drift', 'Desktop video output changed during a bounded read.');
			return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
		},
		async delete(ownerValue: Owner, idValue: string) {
			const session = ownedSession(sessions, ownerValue, idValue);
			if (session.state !== 'executed') throw operationError('state', 'Desktop video output is not ready to delete.');
			await cleanup(session);
			return true;
		},
		async cancel(ownerValue: Owner, idValue: string) {
			const session = optionalOwnedSession(sessions, ownerValue, idValue);
			if (!session) return false;
			const reason = abortError('The desktop video operation was cancelled.');
			session.controller.abort(reason); session.started.reject(reason);
			if (session.execution) await session.execution.catch(() => undefined);
			else await cleanup(session);
			return true;
		},
		async revokeOwner(ownerValue: Owner) {
			const owner = owned(ownerValue);
			const revoked = [...sessions.values()].filter((session) => session.owner === owner);
			await Promise.all(revoked.map((session) => service.cancel(owner, session.id)));
			return revoked.length > 0;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const session of sessions.values()) {
				const reason = abortError('The desktop video service stopped.');
				session.controller.abort(reason); session.started.reject(reason);
				void (session.execution ?? Promise.resolve()).catch(() => undefined).then(() => cleanup(session));
			}
		},
	});
	return service;
}

async function runSession<Owner extends object>(
	session: Session<Owner>,
	options: Readonly<{
		preferences: Pick<ExternalFfmpegPreferenceService, 'admission' | 'invalidateAdmission'>;
		digest: (path: string) => Promise<string>;
		launch?: ExternalFfmpegVideoSpawn;
		environment: Readonly<Record<string, string>>;
		duration: number;
		logLimit: number;
		terminationGrace: number;
		killWait: number;
	}>,
): Promise<0> {
	throwIfAborted(session.controller.signal);
	if (!sameAdmission(options.preferences.admission(), session.admission)) {
		throw operationError('stale-admission', 'The external FFmpeg admission changed before execution.');
	}
	await assertIdentity(session, options.preferences, options.digest);
	throwIfAborted(session.controller.signal);
	const process = launchExternalFfmpegVideoProcess({
		executablePath: session.pair.executablePath,
		arguments: session.arguments_,
		scratchDirectory: session.scratchDirectory,
		hasAudio: session.inputs.audio !== null,
		signal: session.controller.signal,
		environment: options.environment,
		limits: Object.freeze({
			duration: options.duration, log: options.logLimit,
			terminationGrace: options.terminationGrace, killWait: options.killWait,
		}),
		...(options.launch ? { spawn: options.launch } : {}),
		error: operationError,
	});
	session.child = process.child;
	session.inputs.video!.stream = process.videoInput;
	if (session.inputs.audio) session.inputs.audio.stream = process.audioInput;
	session.state = 'running';
	session.started.resolve();
	await process.completion;
	for (const input of Object.values(session.inputs)) {
		if (input && (!input.closed || input.writtenBytes !== input.expectedBytes)) {
			throw operationError('input-incomplete', 'External FFmpeg exited before exact input completion.');
		}
	}
	await assertIdentity(session, options.preferences, options.digest);
	let output: FileHandle;
	try { output = await open(session.outputPath, fsConstants.O_RDONLY); }
	catch { throw operationError('output-missing', 'External FFmpeg produced no video output.'); }
	const metadata = await output.stat();
	if (!metadata.isFile() || metadata.size < 1 || metadata.size > session.plan.maximumOutputBytes) {
		await output.close();
		throw operationError('output-limit', 'External FFmpeg produced an invalid or oversized video output.');
	}
	session.output = output;
	session.outputBytes = metadata.size;
	session.state = 'executed';
	return 0;
}

async function assertIdentity(
	session: Session<object>,
	preferences: Pick<ExternalFfmpegPreferenceService, 'invalidateAdmission'>,
	digest: (path: string) => Promise<string>,
): Promise<void> {
	let matches: boolean;
	try { matches = await externalFfmpegExecutablePairMatches(session.pair, digest); }
	catch {
		await invalidate(preferences, session.admission, 'executable-unavailable');
		throw operationError('executable-unavailable', 'The admitted FFmpeg executable pair is unavailable.');
	}
	if (!matches) {
		await invalidate(preferences, session.admission, 'identity-changed');
		throw operationError('identity-changed', 'The admitted FFmpeg executable identity changed.');
	}
}

async function invalidate(
	preferences: Pick<ExternalFfmpegPreferenceService, 'invalidateAdmission'>,
	admission: ExternalFfmpegRuntimeAdmission,
	reason: ExternalFfmpegRuntimeInvalidationReason,
): Promise<void> {
	try { await preferences.invalidateAdmission(admission, reason); }
	catch { throw operationError(reason, 'External FFmpeg identity quarantine failed.'); }
}

function executablePair(admission: ExternalFfmpegRuntimeAdmission): ExternalFfmpegExecutablePairAdmission {
	const pair = Object.freeze({
		executablePath: admission.executablePath,
		ffmpegSha256: admission.identity.ffmpegSha256,
		ffprobePath: admission.identity.ffprobePath,
		ffprobeSha256: admission.identity.ffprobeSha256,
		executablePairClosureSha256: admission.identity.executablePairClosureSha256,
	});
	if (!isExternalFfmpegExecutablePairAdmission(pair)) {
		throw operationError('admission-invalid', 'The external FFmpeg executable admission is invalid.');
	}
	return pair;
}

function sameAdmission(left: ExternalFfmpegRuntimeAdmission | null, right: ExternalFfmpegRuntimeAdmission): boolean {
	return left !== null && left.executablePath === right.executablePath
		&& left.capabilityGeneration === right.capabilityGeneration
		&& left.identity.executablePairClosureSha256 === right.identity.executablePairClosureSha256;
}

function inputState(expectedBytes: number): InputState {
	return { expectedBytes, writtenBytes: 0, closed: false, closing: false, writing: false, stream: null };
}

function reserveBegin<Owner extends object>(
	sessions: ReadonlyMap<string, Session<Owner>>,
	beginningOwners: Set<Owner>,
	owner: Owner,
): () => void {
	if (sessions.size + beginningOwners.size >= MAXIMUM_SESSIONS
		|| beginningOwners.has(owner)
		|| [...sessions.values()].some((session) => session.owner === owner)) {
		throw operationError('busy', 'A desktop video session is already active.');
	}
	beginningOwners.add(owner);
	return () => { beginningOwners.delete(owner); };
}

function ownedSession<Owner extends object>(
	sessions: ReadonlyMap<string, Session<Owner>>,
	ownerValue: Owner,
	idValue: unknown,
): Session<Owner> {
	const id = operationIdValue(idValue);
	const session = sessions.get(id);
	if (!session) throw operationError('unknown', 'The desktop video operation is unknown.');
	if (session.owner !== owned(ownerValue)) throw operationError('owner', 'The desktop video operation is not owned by this renderer.');
	return session;
}

function optionalOwnedSession<Owner extends object>(
	sessions: ReadonlyMap<string, Session<Owner>>,
	ownerValue: Owner,
	idValue: unknown,
): Session<Owner> | null {
	const id = operationIdValue(idValue);
	const session = sessions.get(id);
	return session?.owner === owned(ownerValue) ? session : null;
}

function executedSession<Owner extends object>(
	sessions: ReadonlyMap<string, Session<Owner>>,
	owner: Owner,
	id: unknown,
): Session<Owner> {
	const session = ownedSession(sessions, owner, id);
	if (session.state !== 'executed' || !session.output) throw operationError('state', 'Desktop video output is not ready.');
	return session;
}

function sessionInput<Owner extends object>(session: Session<Owner>, role: unknown): InputState {
	if (role !== 'video' && role !== 'audio') throw operationError('role', 'Desktop video input role is invalid.');
	const input = session.inputs[role];
	if (!input) throw operationError('role', 'The desktop video plan has no such input.');
	return input;
}

function owned<Owner extends object>(value: Owner): Owner {
	if (!value || typeof value !== 'object') throw new TypeError('A desktop renderer owner is required.');
	return value;
}

function operationIdValue(value: unknown): string {
	if (typeof value !== 'string' || !OPERATION_ID.test(value)) throw new TypeError('Desktop video operation ID is invalid.');
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, label);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Desktop video ${label} is invalid.`);
	}
	return value;
}

function lowerLimit(value: number | undefined, fallback: number, hard: number, label: string): number {
	return boundedInteger(value ?? fallback, 1, hard, label);
}

function validateOptions(options: ExternalFfmpegVideoOperationServiceOptions): void {
	if (!options || typeof options !== 'object' || typeof options.scratchRoot !== 'string'
		|| !isAbsolute(options.scratchRoot) || options.scratchRoot.length > 4_096
		|| options.scratchRoot.includes('\0') || !options.preferences
		|| typeof options.preferences.admission !== 'function'
		|| typeof options.preferences.invalidateAdmission !== 'function'
		|| options.digestExecutable !== undefined && typeof options.digestExecutable !== 'function'
		|| options.spawn !== undefined && typeof options.spawn !== 'function'
			|| options.mintOperationId !== undefined && typeof options.mintOperationId !== 'function'
			|| options.qualifyAdmission !== undefined && typeof options.qualifyAdmission !== 'function') {
		throw new TypeError('External FFmpeg video service options are invalid.');
	}
}

function assertAvailable(disposed: boolean): void {
	if (disposed) throw operationError('disposed', 'The desktop video service is disposed.');
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((resolve_, reject_) => { resolve = resolve_; reject = reject_; });
	return { promise, resolve, reject };
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? abortError('The desktop video operation was cancelled.');
}

function abortError(message: string): Error {
	return typeof DOMException === 'function'
		? new DOMException(message, 'AbortError')
		: Object.assign(new Error(message), { name: 'AbortError' });
}

function operationError(reason: string, message: string): DesktopExternalFfmpegVideoOperationError {
	return new DesktopExternalFfmpegVideoOperationError(reason, message);
}

async function sha256File(path: string): Promise<string> {
	const handle = await open(path, fsConstants.O_RDONLY);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new Error('External FFmpeg is not a regular file.');
		const hash = createHash('sha256');
		const buffer = Buffer.alloc(64 * 1024);
		let position = 0;
		for (;;) {
			const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		return hash.digest('hex');
	} finally { await handle.close(); }
}
