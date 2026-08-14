/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Supervises assistance jobs running in a helper process.
 *
 * The channel is injected rather than constructed here: in the application it
 * is an Electron utility process, and in tests it is an in-process double, so
 * the supervision rules are provable without a packaged app. Native inference
 * never runs in a worker thread, where one segmentation fault would take the
 * editor with it; a helper crash resolves the job as a typed failure and
 * leaves the project untouched.
 */

import {
	ASSISTANCE_CANCELLATION_BUDGET_MS,
	ASSISTANCE_JOB_HEARTBEAT_MS,
	validateAssistanceHelperMessage,
	validateAssistanceJobRequest,
	type AssistanceJobRequest,
} from './assistance-job-protocol.ts';

export interface AssistanceHelperChannel {
	postMessage(message: unknown): void;
	onMessage(listener: (message: unknown) => void): void;
	onExit(listener: (code: number | null) => void): void;
	kill(): void;
}

export interface AssistanceJobProgress {
	readonly completed: number;
	readonly total: number;
}

export interface AssistanceJobHostOptions {
	readonly spawn: () => AssistanceHelperChannel;
	readonly heartbeatMs?: number;
	readonly cancellationBudgetMs?: number;
	readonly setTimeoutImpl?: typeof setTimeout;
	readonly clearTimeoutImpl?: typeof clearTimeout;
}

export interface AssistanceJobRun {
	readonly jobId: string;
	readonly completed: Promise<unknown>;
	cancel(): Promise<void>;
}

export class AssistanceJobError extends Error {
	readonly jobId: string;

	readonly cause: string;

	constructor(jobId: string, message: string, cause: string) {
		super(message);
		this.name = 'AssistanceJobError';
		this.jobId = jobId;
		this.cause = cause;
	}
}

interface ActiveJob {
	readonly request: AssistanceJobRequest;
	readonly channel: AssistanceHelperChannel;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	settled: boolean;
	heartbeat: ReturnType<typeof setTimeout> | null;
}

/**
 * Runs one job at a time. Assistance is background work competing with the
 * editor for memory and cores, so admission is serialized rather than queued
 * deeply; a caller that wants more parallelism creates another host.
 */
export function createAssistanceJobHost(options: AssistanceJobHostOptions) {
	const heartbeatMs = options.heartbeatMs ?? ASSISTANCE_JOB_HEARTBEAT_MS;
	const cancellationBudgetMs = options.cancellationBudgetMs ?? ASSISTANCE_CANCELLATION_BUDGET_MS;
	const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
	const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
	let active: ActiveJob | null = null;

	function settle(job: ActiveJob, error: Error | null, value?: unknown): void {
		if (job.settled) return;
		job.settled = true;
		if (job.heartbeat) clearTimeoutImpl(job.heartbeat);
		job.heartbeat = null;
		active = null;
		try {
			job.channel.kill();
		} catch {
			// A channel that is already gone needs no teardown.
		}
		if (error) job.reject(error);
		else job.resolve(value);
	}

	function armHeartbeat(job: ActiveJob): void {
		if (job.heartbeat) clearTimeoutImpl(job.heartbeat);
		job.heartbeat = setTimeoutImpl(() => {
			settle(job, new AssistanceJobError(
				job.request.jobId,
				'The assistance helper stopped reporting progress.',
				'heartbeat',
			));
		}, heartbeatMs);
	}

	function start(
		request: unknown,
		onProgress?: (progress: AssistanceJobProgress) => void,
	): AssistanceJobRun {
		if (active) {
			throw new Error('An assistance job is already running.');
		}
		const validated = validateAssistanceJobRequest(request);
		const channel = options.spawn();
		let resolve!: (value: unknown) => void;
		let reject!: (error: Error) => void;
		const completed = new Promise<unknown>((resolveFn, rejectFn) => {
			resolve = resolveFn;
			reject = rejectFn;
		});
		const job: ActiveJob = {
			request: validated,
			channel,
			resolve,
			reject,
			settled: false,
			heartbeat: null,
		};
		active = job;

		channel.onMessage((raw) => {
			if (job.settled) return;
			let message;
			try {
				message = validateAssistanceHelperMessage(raw);
			} catch (error) {
				settle(job, new AssistanceJobError(
					validated.jobId,
					'The assistance helper sent a message the editor could not validate.',
					'malformed-message',
				));
				void error;
				return;
			}
			if (message.jobId !== validated.jobId) {
				settle(job, new AssistanceJobError(
					validated.jobId,
					'The assistance helper answered for a different job.',
					'job-mismatch',
				));
				return;
			}
			switch (message.type) {
				case 'progress':
					armHeartbeat(job);
					onProgress?.(Object.freeze({ completed: message.completed, total: message.total }));
					return;
				case 'result':
					settle(job, null, message.payload);
					return;
				case 'cancelled':
					settle(job, new AssistanceJobError(validated.jobId, 'The assistance job was cancelled.', 'cancelled'));
					return;
				default:
					settle(job, new AssistanceJobError(validated.jobId, message.reason, 'helper-error'));
			}
		});

		channel.onExit((code) => {
			settle(job, new AssistanceJobError(
				validated.jobId,
				`The assistance helper exited before finishing (code ${String(code)}).`,
				'helper-exit',
			));
		});

		armHeartbeat(job);
		channel.postMessage(validated);

		return Object.freeze({
			jobId: validated.jobId,
			completed,
			async cancel(): Promise<void> {
				if (job.settled) return;
				try {
					channel.postMessage({ type: 'cancel', jobId: validated.jobId });
				} catch {
					// A dead channel is already cancelled.
				}
				const deadline = setTimeoutImpl(() => {
					settle(job, new AssistanceJobError(
						validated.jobId,
						'The assistance helper did not acknowledge cancellation in time.',
						'cancellation-timeout',
					));
				}, cancellationBudgetMs);
				try {
					await completed.catch(() => undefined);
				} finally {
					clearTimeoutImpl(deadline);
				}
			},
		});
	}

	return Object.freeze({
		start,
		get isBusy(): boolean {
			return active !== null;
		},
		dispose(): void {
			if (active) {
				settle(active, new AssistanceJobError(active.request.jobId, 'The assistance host was disposed.', 'disposed'));
			}
		},
	});
}
