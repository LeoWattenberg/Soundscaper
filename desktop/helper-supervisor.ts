/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned helper supervision with verified spawn, bounded jobs and quarantine. */

import {
	HELPER_CANCELLATION_BUDGET_MS,
	HELPER_CRASH_DETECTION_MS,
	HELPER_RESOURCE_HARD_LIMITS,
	HelperContractViolationError,
	type AnyHelperJobGrant,
	type HelperJobGrant,
	type HelperJobKind,
	type HelperJobResourcePolicy,
	type HelperHostMessage,
	type HelperProcessMessage,
	deserializeHelperError,
	helperJobGrantExceedsResourcePolicy,
	helperJobGrantResourceUsage,
	helperJobSubcontractVersion,
	normalizeHelperResourcePolicy,
	validateHelperJobGrant,
	validateHelperJobResult,
	validateHelperHostMessage,
	validateHelperProcessMessage,
} from './helper-contract.ts';
import {
	admitHelperDataPlaneTransfers,
	type HelperDataPlaneTransfer, type HelperDataPlaneTransferPort,
} from './helper-data-plane-transfer.ts';
import {
	HelperCrashLedger,
	HelperSupervisionError,
	type HelperSupervisorSnapshot,
	type HelperSupervisorState,
} from './helper-supervision-state.ts';
import { HelperAdmissionGate } from './helper-admission-gate.ts';

export { HelperSupervisionError } from './helper-supervision-state.ts';
export type {
	HelperFailureCause,
	HelperSupervisorSnapshot,
	HelperSupervisorState,
} from './helper-supervision-state.ts';
export { HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS } from './helper-admission-gate.ts';

export interface HelperChannel {
	postMessage(message: HelperHostMessage, transfer?: readonly HelperDataPlaneTransferPort[]): void;
	onMessage(listener: (message: unknown) => void): void;
	onExit(listener: (code: number | null) => void): void;
	kill(): void;
}

export interface HelperJobRequest<Kind extends HelperJobKind = 'probe-video-source'> {
	readonly kind: Kind;
	readonly grant: HelperJobGrant<Kind>;
	readonly resourcePolicy?: Partial<HelperJobResourcePolicy>;
	readonly signal?: AbortSignal;
	readonly onProgress?: (value: number | null) => void;
	readonly dataPlaneTransfers?: readonly HelperDataPlaneTransfer[];
	readonly validateResult?: (value: unknown) => unknown;
}

export interface HelperSupervisorOptions {
	spawn: () => HelperChannel | Promise<HelperChannel>;
	/** Re-verifies the helper's executable payload digests before any spawn. */
	verifyBinary: () => Promise<void>;
	mintJobId: () => string;
	crashDetectionMs?: number;
	cancellationBudgetMs?: number;
	quarantineCrashLimit?: number;
	quarantineWindowMs?: number;
	sampleRss?: () => number | null;
	now?: () => number;
	setTimeoutImpl?: typeof setTimeout;
	clearTimeoutImpl?: typeof clearTimeout;
}

interface ActiveJob {
	readonly jobId: string;
	readonly kind: HelperJobKind;
	readonly grant: AnyHelperJobGrant;
	readonly resourcePolicy: HelperJobResourcePolicy;
	readonly onProgress?: (value: number | null) => void;
	readonly signal?: AbortSignal;
	readonly validateResult?: (value: unknown) => unknown;
	readonly abortListener?: () => void;
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	settled: boolean;
	cancelRequested: boolean;
	progressPublished: boolean;
	progressValue: number | null;
	cancelDeadline: ReturnType<typeof setTimeout> | null;
	durationDeadline: ReturnType<typeof setTimeout> | null;
}

export class HelperSupervisor {
	readonly #options: Required<Pick<HelperSupervisorOptions, 'spawn' | 'verifyBinary' | 'mintJobId'>>;
	readonly #crashDetectionMs: number;
	readonly #cancellationBudgetMs: number;
	readonly #sampleRss: (() => number | null) | null;
	readonly #setTimeout: typeof setTimeout;
	readonly #clearTimeout: typeof clearTimeout;
	readonly #crashes: HelperCrashLedger;
	#channel: HelperChannel | null = null;
	#channelReady = false;
	#supportedKinds = new Set<HelperJobKind>();
	#watchdog: ReturnType<typeof setTimeout> | null = null;
	#job: ActiveJob | null = null;
	#jobAdmissionPending = false;
	readonly #gate = new HelperAdmissionGate();
	#pendingHandshake: { resolve: () => void; reject: (error: Error) => void } | null = null;
	#disposed = false;

	constructor(options: HelperSupervisorOptions) {
		this.#options = {
			spawn: options.spawn,
			verifyBinary: options.verifyBinary,
			mintJobId: options.mintJobId,
		};
		this.#crashDetectionMs = options.crashDetectionMs ?? HELPER_CRASH_DETECTION_MS;
		this.#cancellationBudgetMs = options.cancellationBudgetMs ?? HELPER_CANCELLATION_BUDGET_MS;
		this.#sampleRss = options.sampleRss ?? null;
		this.#setTimeout = options.setTimeoutImpl ?? setTimeout;
		this.#clearTimeout = options.clearTimeoutImpl ?? clearTimeout;
		this.#crashes = new HelperCrashLedger({
			crashLimit: options.quarantineCrashLimit ?? 3,
			windowMs: options.quarantineWindowMs ?? 60_000,
			now: options.now ?? (() => Date.now()),
		});
	}

	snapshot(): HelperSupervisorSnapshot {
		return Object.freeze({
			state: this.#state(),
			recentCrashes: this.#crashes.recentCount,
			quarantined: this.#crashes.quarantined,
		});
	}

	/** Explicit user action is the only path out of quarantine mid-session. */
	clearQuarantine(): void {
		this.#crashes.clear();
	}
	async start(): Promise<void> { await this.#ensureChannel(); }
	/**
	 * Contract v1 admits one concurrent job, so a second caller waits for the
	 * first instead of being refused. Every native surface shares one supervisor
	 * over one payload, and two independent user actions arriving together is
	 * not a fault: refusing the later one would make an ordinary collision look
	 * like the helper — or the thing it was scanning — had misbehaved.
	 */
	async runJob<Kind extends HelperJobKind>(request: HelperJobRequest<Kind>): Promise<unknown> {
		this.#assertNotDisposed();
		if (this.#crashes.quarantined) {
			throw new HelperSupervisionError('quarantined', 'The helper is quarantined after repeated crashes.');
		}
		request.signal?.throwIfAborted();
		let admittedGrant: HelperJobGrant<Kind>;
		let resourcePolicy: HelperJobResourcePolicy;
		let usage: ReturnType<typeof helperJobGrantResourceUsage>;
		let dataPlanePorts: readonly HelperDataPlaneTransferPort[];
		try {
			admittedGrant = validateHelperJobGrant(request.kind, request.grant);
			resourcePolicy = normalizeHelperResourcePolicy(request.resourcePolicy, request.kind);
			usage = helperJobGrantResourceUsage(request.kind, admittedGrant);
			dataPlanePorts = admitHelperDataPlaneTransfers(
				request.kind, admittedGrant, request.dataPlaneTransfers,
			);
		} catch (error) {
			throw new HelperSupervisionError('invalid-request',
				`The helper job failed contract admission: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (helperJobGrantExceedsResourcePolicy(usage, resourcePolicy)) {
			throw new HelperSupervisionError('resource-violation',
				'The helper job exceeds its exact input, output, scratch, or data-plane resource policy.');
		}
		const admission = this.#gate.acquire(request.signal);
		const release = typeof admission === 'function' ? admission : await admission;
		try {
			return await this.#admitJob(request, admittedGrant, resourcePolicy, dataPlanePorts);
		} finally {
			release();
		}
	}

	/** Runs one job on the free helper and settles when that job settles. */
	async #admitJob<Kind extends HelperJobKind>(
		request: HelperJobRequest<Kind>,
		admittedGrant: HelperJobGrant<Kind>,
		resourcePolicy: HelperJobResourcePolicy,
		dataPlanePorts: readonly HelperDataPlaneTransferPort[],
	): Promise<unknown> {
		this.#assertNotDisposed();
		if (this.#crashes.quarantined) {
			throw new HelperSupervisionError('quarantined', 'The helper is quarantined after repeated crashes.');
		}
		request.signal?.throwIfAborted();
		if (this.#job || this.#jobAdmissionPending) {
			throw new HelperSupervisionError('helper-error',
				`The helper admits at most ${HELPER_RESOURCE_HARD_LIMITS.maximumConcurrentJobs} concurrent job.`);
		}
		this.#jobAdmissionPending = true;
		try {
			await this.#ensureChannel();
			this.#assertNotDisposed();
			request.signal?.throwIfAborted();
			if (!this.#supportedKinds.has(request.kind)) {
				throw new HelperSupervisionError('unsupported-kind',
					`The helper did not negotiate support for job kind ${request.kind}.`);
			}
			const jobId = this.#options.mintJobId();
			let admittedMessage: HelperHostMessage;
			try {
				admittedMessage = validateHelperHostMessage({
					contractVersion: 1,
					type: 'job',
					jobId,
					kind: request.kind,
					jobContractVersion: helperJobSubcontractVersion(request.kind),
					grant: admittedGrant,
					resourcePolicy,
				});
			} catch (error) {
				throw new HelperSupervisionError('invalid-request',
					`The helper job failed contract admission: ${error instanceof Error ? error.message : String(error)}`);
			}
			return new Promise<unknown>((resolve, reject) => {
				const job: ActiveJob = {
					jobId,
					kind: request.kind,
					grant: admittedGrant,
					resourcePolicy,
					onProgress: request.onProgress,
					signal: request.signal,
					validateResult: request.validateResult,
					resolve,
					reject,
					settled: false,
					cancelRequested: false,
					progressPublished: false,
					progressValue: null,
					cancelDeadline: null,
					durationDeadline: null,
				};
				if (request.signal) {
					const listener = () => this.#requestCancel(job);
					request.signal.addEventListener('abort', listener, { once: true });
					(job as { abortListener?: () => void }).abortListener = listener;
				}
				this.#job = job;
				job.durationDeadline = this.#armTimer(() => {
					this.#failJob(job, new HelperSupervisionError('resource-violation',
						'The helper job exceeded its admitted duration and was terminated.'), {
						killChannel: true,
						qualifyingFault: true,
					});
				}, resourcePolicy.maximumJobDurationMs);
				try {
					this.#postValidated(admittedMessage, dataPlanePorts);
				} catch (error) {
					this.#failJob(job, new HelperSupervisionError('helper-error',
						error instanceof Error ? error.message : String(error)), {
						killChannel: true,
						qualifyingFault: true,
					});
				}
			});
		} finally {
			this.#jobAdmissionPending = false;
		}
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const disposed = new HelperSupervisionError('disposed', 'The helper supervisor is disposed.');
		this.#gate.dispose();
		const job = this.#job;
		if (job) this.#settleJob(job, disposed);
		const handshake = this.#pendingHandshake;
		this.#pendingHandshake = null;
		handshake?.reject(disposed);
		this.#teardownChannel();
	}

	#state(): HelperSupervisorState {
		if (this.#disposed) return 'disposed';
		if (this.#crashes.quarantined) return 'quarantined';
		if (this.#job) return 'busy';
		if (this.#channelReady) return 'ready';
		if (this.#channel) return 'starting';
		return 'idle';
	}

	async #ensureChannel(): Promise<void> {
		this.#assertNotDisposed();
		if (this.#channel && this.#channelReady) return;
		if (this.#channel) throw new HelperSupervisionError('handshake', 'The helper is still starting.');
		try {
			await this.#options.verifyBinary();
		} catch (error) {
			this.#assertNotDisposed();
			throw new HelperSupervisionError('binary-mismatch',
				`The helper executable payload failed verification: ${error instanceof Error ? error.message : String(error)}`);
		}
		this.#assertNotDisposed();
		let channel: HelperChannel;
		try {
			channel = await this.#options.spawn();
		} catch (error) {
			this.#assertNotDisposed();
			throw new HelperSupervisionError('helper-exit',
				`The helper process could not be spawned: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (this.#disposed) {
			try {
				channel.kill();
			} catch {
				/* A process created after disposal is already outside supervision. */
			}
			this.#assertNotDisposed();
		}
		this.#channel = channel;
		this.#channelReady = false;
		channel.onMessage((message) => this.#receive(channel, message));
		channel.onExit(() => this.#handleExit(channel));
		this.#armWatchdog();
		await new Promise<void>((resolve, reject) => {
			this.#pendingHandshake = { resolve, reject };
		});
		this.#assertNotDisposed();
	}

	#assertNotDisposed(): void {
		if (this.#disposed) {
			throw new HelperSupervisionError('disposed', 'The helper supervisor is disposed.');
		}
	}

	#receive(channel: HelperChannel, message: unknown): void {
		if (channel !== this.#channel) return;
		let validated: HelperProcessMessage;
		try {
			validated = validateHelperProcessMessage(message);
		} catch (error) {
			const violation = error instanceof HelperContractViolationError ? error.message : String(error);
			this.#crash(new HelperSupervisionError('malformed-message',
				`The helper sent a message the contract rejects: ${violation}`));
			return;
		}
		if (!this.#channelReady && validated.type !== 'hello') {
			this.#crash(new HelperSupervisionError('handshake',
				'The helper sent a process message before its handshake.'));
			return;
		}
		this.#armWatchdog();
		if (validated.type === 'hello') {
			if (this.#channelReady || !this.#pendingHandshake) {
				this.#crash(new HelperSupervisionError('handshake',
					'The helper sent a duplicate or out-of-phase handshake.'));
				return;
			}
			this.#channelReady = true;
			this.#supportedKinds = new Set(validated.kinds);
			const handshake = this.#pendingHandshake;
			this.#pendingHandshake = null;
			handshake?.resolve();
			return;
		}
		if (validated.type === 'heartbeat') {
			const expectedJobId = this.#job?.jobId ?? null;
			if (validated.jobId !== expectedJobId) {
				this.#crash(new HelperSupervisionError('job-mismatch',
					'The helper heartbeat does not match the active job generation.'));
				return;
			}
			this.#enforceResourcePolicy();
			return;
		}
		const job = this.#job;
		if (!job || validated.jobId !== job.jobId) {
			this.#crash(new HelperSupervisionError('job-mismatch',
				'The helper answered for a job the supervisor does not own.'));
			return;
		}
		if (validated.type === 'progress') {
			this.#publishProgress(job, validated.value);
			return;
		}
		if (validated.type === 'cancelled') {
			if (!job.cancelRequested) {
				this.#crash(new HelperSupervisionError('malformed-message',
					'The helper acknowledged cancellation that the host did not request.'));
				return;
			}
			this.#settleJob(job, new HelperSupervisionError('cancelled', 'The helper job was cancelled.'));
			return;
		}
		if (job.cancelRequested) {
			this.#crash(new HelperSupervisionError('malformed-message',
				'The helper sent a terminal result before cancellation quiescence was acknowledged.'));
			return;
		}
		if (validated.type === 'error') {
			const error = deserializeHelperError(validated.error);
			if ((error as Error & { code?: string }).code === 'HELPER_ENGINE_PROTOCOL_VIOLATION') {
				this.#crash(new HelperSupervisionError('malformed-message',
					`The helper engine violated its process protocol: ${error.message}`));
				return;
			}
			this.#settleJob(job, error);
			return;
		}
		let result: unknown;
		try {
			result = validateHelperJobResult(job.kind, validated.result, job.grant);
		} catch (error) {
			this.#crash(new HelperSupervisionError('malformed-message',
				`The helper returned a result the contract rejects: ${error instanceof Error ? error.message : String(error)}`));
			return;
		}
		if (job.validateResult) {
			try {
				result = job.validateResult(validated.result);
			} catch (error) {
				this.#crash(new HelperSupervisionError('malformed-message',
					`The helper returned a result the contract rejects: ${error instanceof Error ? error.message : String(error)}`));
				return;
			}
		}
		this.#settleJob(job, null, result);
	}

	#requestCancel(job: ActiveJob): void {
		if (job.settled || job !== this.#job || job.cancelRequested) return;
		job.cancelRequested = true;
		try {
			this.#post({ contractVersion: 1, type: 'cancel', jobId: job.jobId });
		} catch (error) {
			this.#failJob(job, new HelperSupervisionError('helper-exit',
				`The helper channel failed during cancellation: ${error instanceof Error ? error.message : String(error)}`), {
				killChannel: true,
				qualifyingFault: true,
			});
			return;
		}
		job.cancelDeadline = this.#armTimer(() => {
			this.#failJob(job, new HelperSupervisionError('cancellation-timeout',
				'The helper missed the cancellation acknowledgement budget and was terminated.'), {
				killChannel: true,
				qualifyingFault: true,
			});
		}, this.#cancellationBudgetMs);
	}

	#enforceResourcePolicy(): void {
		const job = this.#job;
		if (!job || !this.#sampleRss) return;
		const rss = this.#sampleRss();
		if (rss !== null && rss > job.resourcePolicy.maximumRssBytes) {
			this.#failJob(job, new HelperSupervisionError('resource-violation',
				'The helper exceeded its admitted peak RSS and was terminated.'), {
				killChannel: true,
				qualifyingFault: true,
			});
		}
	}

	#handleExit(channel: HelperChannel): void {
		if (channel !== this.#channel) return;
		this.#crash(new HelperSupervisionError('helper-exit', 'The helper process exited unexpectedly.'));
	}

	#crash(error: HelperSupervisionError): void {
		const job = this.#job;
		this.#teardownChannel();
		this.#recordCrash();
		const handshake = this.#pendingHandshake;
		this.#pendingHandshake = null;
		handshake?.reject(error);
		if (job) this.#settleJob(job, error);
	}

	#recordCrash(): void {
		this.#crashes.record();
	}

	#failJob(
		job: ActiveJob,
		error: Error,
		options: Readonly<{ killChannel: boolean; qualifyingFault: boolean }>,
	): void {
		if (job.settled || job !== this.#job) return;
		if (options.killChannel) this.#teardownChannel();
		if (options.qualifyingFault) this.#recordCrash();
		this.#settleJob(job, error);
	}

	#publishProgress(job: ActiveJob, value: number | null): void {
		if (job.settled || job.cancelRequested || job !== this.#job) return;
		if (value === null) {
			if (job.progressPublished) return;
		} else if (job.progressPublished && job.progressValue !== null && value <= job.progressValue) {
			return;
		}
		job.progressPublished = true;
		job.progressValue = value;
		try {
			job.onProgress?.(value);
		} catch {
			/* Progress consumers cannot fail the job. */
		}
	}

	#settleJob(job: ActiveJob, error: Error | null, result?: unknown): void {
		if (job.settled) return;
		job.settled = true;
		if (this.#job === job) this.#job = null;
		if (job.cancelDeadline) this.#clearTimeout(job.cancelDeadline);
		if (job.durationDeadline) this.#clearTimeout(job.durationDeadline);
		if (job.signal && job.abortListener) job.signal.removeEventListener('abort', job.abortListener);
		if (error) job.reject(error);
		else job.resolve(result);
	}

	#armWatchdog(): void {
		if (this.#watchdog) this.#clearTimeout(this.#watchdog);
		this.#watchdog = this.#armTimer(() => {
			this.#crash(new HelperSupervisionError('heartbeat',
				'The helper stopped reporting liveness and was terminated.'));
		}, this.#crashDetectionMs);
	}

	#post(message: HelperHostMessage): void {
		this.#postValidated(validateHelperHostMessage(message));
	}

	#postValidated(
		message: HelperHostMessage,
		transfer: readonly HelperDataPlaneTransferPort[] = [],
	): void {
		const channel = this.#channel;
		if (!channel) throw new HelperSupervisionError('helper-exit', 'The helper channel is closed.');
		channel.postMessage(message, transfer);
	}

	#teardownChannel(): void {
		const channel = this.#channel;
		this.#channel = null;
		this.#channelReady = false;
		this.#supportedKinds.clear();
		if (this.#watchdog) {
			this.#clearTimeout(this.#watchdog);
			this.#watchdog = null;
		}
		if (channel) {
			try {
				channel.kill();
			} catch {
				/* Termination is best-effort once supervision has failed. */
			}
		}
	}

	#armTimer(handler: () => void, delayMs: number): ReturnType<typeof setTimeout> {
		const timer = this.#setTimeout(handler, delayMs);
		(timer as { unref?: () => void }).unref?.();
		return timer;
	}
}
