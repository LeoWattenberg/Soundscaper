/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Supervises one milestone-5 helper process under contract v1. The channel is
 * injected: in the application it is an Electron utility process owned by
 * main, and in tests it is an in-process double, so every supervision rule —
 * verified spawn, handshake, heartbeat crash detection, cancellation
 * acknowledgement, repeated-crash quarantine, and per-job admission — is
 * exercised without platform authority. A helper failure settles the active
 * job with a typed error and never touches project state: helpers are
 * read-only workers whose loss degrades, not corrupts.
 */

import {
	HELPER_CANCELLATION_BUDGET_MS,
	HELPER_CRASH_DETECTION_MS,
	HELPER_RESOURCE_HARD_LIMITS,
	HelperContractViolationError,
	type HelperJobGrant,
	type HelperJobKind,
	type HelperJobResourcePolicy,
	type HelperHostMessage,
	type HelperProcessMessage,
	deserializeHelperError,
	normalizeHelperResourcePolicy,
	validateHelperProcessMessage,
} from './helper-contract.ts';

export interface HelperChannel {
	postMessage(message: HelperHostMessage): void;
	onMessage(listener: (message: unknown) => void): void;
	onExit(listener: (code: number | null) => void): void;
	kill(): void;
}

export type HelperFailureCause =
	| 'binary-mismatch'
	| 'handshake'
	| 'heartbeat'
	| 'malformed-message'
	| 'job-mismatch'
	| 'helper-error'
	| 'helper-exit'
	| 'cancelled'
	| 'cancellation-timeout'
	| 'resource-violation'
	| 'quarantined'
	| 'disposed';

export class HelperSupervisionError extends Error {
	readonly cause_: HelperFailureCause;

	constructor(cause: HelperFailureCause, message: string) {
		super(message);
		this.name = 'HelperSupervisionError';
		this.cause_ = cause;
	}
}

export type HelperSupervisorState = 'idle' | 'starting' | 'ready' | 'busy' | 'quarantined' | 'disposed';

export interface HelperSupervisorSnapshot {
	readonly state: HelperSupervisorState;
	readonly recentCrashes: number;
	readonly quarantined: boolean;
}

export interface HelperJobRequest {
	readonly kind: HelperJobKind;
	readonly grant: HelperJobGrant;
	readonly resourcePolicy?: Partial<HelperJobResourcePolicy>;
	readonly signal?: AbortSignal;
	readonly onProgress?: (value: number | null) => void;
	/** Kind-specific result admission; a rejected result is a helper fault. */
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
	readonly resourcePolicy: HelperJobResourcePolicy;
	readonly onProgress?: (value: number | null) => void;
	readonly signal?: AbortSignal;
	readonly validateResult?: (value: unknown) => unknown;
	readonly abortListener?: () => void;
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	settled: boolean;
	cancelRequested: boolean;
	cancelDeadline: ReturnType<typeof setTimeout> | null;
	durationDeadline: ReturnType<typeof setTimeout> | null;
}

export class HelperSupervisor {
	readonly #options: Required<Pick<HelperSupervisorOptions, 'spawn' | 'verifyBinary' | 'mintJobId'>>;
	readonly #crashDetectionMs: number;
	readonly #cancellationBudgetMs: number;
	readonly #quarantineCrashLimit: number;
	readonly #quarantineWindowMs: number;
	readonly #sampleRss: (() => number | null) | null;
	readonly #now: () => number;
	readonly #setTimeout: typeof setTimeout;
	readonly #clearTimeout: typeof clearTimeout;
	#channel: HelperChannel | null = null;
	#channelReady = false;
	#watchdog: ReturnType<typeof setTimeout> | null = null;
	#job: ActiveJob | null = null;
	#pendingHandshake: { resolve: () => void; reject: (error: Error) => void } | null = null;
	#crashTimestamps: number[] = [];
	#quarantined = false;
	#disposed = false;

	constructor(options: HelperSupervisorOptions) {
		this.#options = {
			spawn: options.spawn,
			verifyBinary: options.verifyBinary,
			mintJobId: options.mintJobId,
		};
		this.#crashDetectionMs = options.crashDetectionMs ?? HELPER_CRASH_DETECTION_MS;
		this.#cancellationBudgetMs = options.cancellationBudgetMs ?? HELPER_CANCELLATION_BUDGET_MS;
		this.#quarantineCrashLimit = options.quarantineCrashLimit ?? 3;
		this.#quarantineWindowMs = options.quarantineWindowMs ?? 60_000;
		this.#sampleRss = options.sampleRss ?? null;
		this.#now = options.now ?? (() => Date.now());
		this.#setTimeout = options.setTimeoutImpl ?? setTimeout;
		this.#clearTimeout = options.clearTimeoutImpl ?? clearTimeout;
	}

	snapshot(): HelperSupervisorSnapshot {
		return Object.freeze({
			state: this.#state(),
			recentCrashes: this.#recentCrashes().length,
			quarantined: this.#quarantined,
		});
	}

	/** Explicit user action is the only path out of quarantine mid-session. */
	clearQuarantine(): void {
		this.#crashTimestamps = [];
		this.#quarantined = false;
	}

	async runJob(request: HelperJobRequest): Promise<unknown> {
		if (this.#disposed) throw new HelperSupervisionError('disposed', 'The helper supervisor is disposed.');
		if (this.#quarantined) {
			throw new HelperSupervisionError('quarantined', 'The helper is quarantined after repeated crashes.');
		}
		if (this.#job) {
			throw new HelperSupervisionError('helper-error',
				`The helper admits at most ${HELPER_RESOURCE_HARD_LIMITS.maximumConcurrentJobs} concurrent job.`);
		}
		request.signal?.throwIfAborted();
		const resourcePolicy = normalizeHelperResourcePolicy(request.resourcePolicy);
		if (request.grant.mediaBytes > resourcePolicy.maximumInputBytes) {
			throw new HelperSupervisionError('resource-violation',
				'The helper job input exceeds its admitted byte limit.');
		}
		await this.#ensureChannel();
		request.signal?.throwIfAborted();
		const jobId = this.#options.mintJobId();
		return new Promise<unknown>((resolve, reject) => {
			const job: ActiveJob = {
				jobId,
				resourcePolicy,
				onProgress: request.onProgress,
				signal: request.signal,
				validateResult: request.validateResult,
				resolve,
				reject,
				settled: false,
				cancelRequested: false,
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
					'The helper job exceeded its admitted duration and was terminated.'), true);
			}, resourcePolicy.maximumJobDurationMs);
			try {
				this.#post({
					contractVersion: 1,
					type: 'job',
					jobId,
					kind: request.kind,
					grant: request.grant,
					resourcePolicy,
				});
			} catch (error) {
				this.#failJob(job, new HelperSupervisionError('helper-error',
					error instanceof Error ? error.message : String(error)), true);
			}
		});
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const job = this.#job;
		if (job) {
			this.#settleJob(job, new HelperSupervisionError('disposed', 'The helper supervisor is disposed.'));
		}
		this.#teardownChannel();
	}

	#state(): HelperSupervisorState {
		if (this.#disposed) return 'disposed';
		if (this.#quarantined) return 'quarantined';
		if (this.#job) return 'busy';
		if (this.#channelReady) return 'ready';
		if (this.#channel) return 'starting';
		return 'idle';
	}

	async #ensureChannel(): Promise<void> {
		if (this.#channel && this.#channelReady) return;
		if (this.#channel) throw new HelperSupervisionError('handshake', 'The helper is still starting.');
		try {
			await this.#options.verifyBinary();
		} catch (error) {
			throw new HelperSupervisionError('binary-mismatch',
				`The helper executable payload failed verification: ${error instanceof Error ? error.message : String(error)}`);
		}
		let channel: HelperChannel;
		try {
			channel = await this.#options.spawn();
		} catch (error) {
			throw new HelperSupervisionError('helper-exit',
				`The helper process could not be spawned: ${error instanceof Error ? error.message : String(error)}`);
		}
		this.#channel = channel;
		this.#channelReady = false;
		channel.onMessage((message) => this.#receive(channel, message));
		channel.onExit(() => this.#handleExit(channel));
		this.#armWatchdog();
		await new Promise<void>((resolve, reject) => {
			this.#pendingHandshake = { resolve, reject };
		});
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
		this.#armWatchdog();
		if (validated.type === 'hello') {
			this.#channelReady = true;
			const handshake = this.#pendingHandshake;
			this.#pendingHandshake = null;
			handshake?.resolve();
			return;
		}
		if (validated.type === 'heartbeat') {
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
			try {
				job.onProgress?.(validated.value);
			} catch {
				/* Progress consumers cannot fail the job. */
			}
			return;
		}
		if (validated.type === 'cancelled') {
			this.#settleJob(job, new HelperSupervisionError('cancelled', 'The helper job was cancelled.'));
			return;
		}
		if (validated.type === 'error') {
			this.#settleJob(job, deserializeHelperError(validated.error));
			return;
		}
		let result: unknown = validated.result;
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
		} catch {
			this.#failJob(job, new HelperSupervisionError('cancelled', 'The helper job was cancelled.'), true);
			return;
		}
		job.cancelDeadline = this.#armTimer(() => {
			this.#failJob(job, new HelperSupervisionError('cancellation-timeout',
				'The helper missed the cancellation acknowledgement budget and was terminated.'), true);
		}, this.#cancellationBudgetMs);
	}

	#enforceResourcePolicy(): void {
		const job = this.#job;
		if (!job || !this.#sampleRss) return;
		const rss = this.#sampleRss();
		if (rss !== null && rss > job.resourcePolicy.maximumRssBytes) {
			this.#failJob(job, new HelperSupervisionError('resource-violation',
				'The helper exceeded its admitted peak RSS and was terminated.'), true);
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
		this.#crashTimestamps = [...this.#recentCrashes(), this.#now()];
		if (this.#crashTimestamps.length >= this.#quarantineCrashLimit) this.#quarantined = true;
	}

	#recentCrashes(): number[] {
		const cutoff = this.#now() - this.#quarantineWindowMs;
		return this.#crashTimestamps.filter((timestamp) => timestamp > cutoff);
	}

	#failJob(job: ActiveJob, error: Error, killChannel: boolean): void {
		if (killChannel) this.#teardownChannel();
		this.#settleJob(job, error);
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
		const channel = this.#channel;
		if (!channel) throw new HelperSupervisionError('helper-exit', 'The helper channel is closed.');
		channel.postMessage(message);
	}

	#teardownChannel(): void {
		const channel = this.#channel;
		this.#channel = null;
		this.#channelReady = false;
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
