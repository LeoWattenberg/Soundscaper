/* SPDX-License-Identifier: AGPL-3.0-only */

/** Speech-specific façade over the shared M5 helper supervisor. */

import {
	ASSISTANCE_CANCELLATION_BUDGET_MS,
	validateAssistanceJobRequest,
	type AssistanceJobRequest,
} from './assistance-job-protocol.ts';
import {
	HelperSupervisionError,
	HelperSupervisor,
	type HelperChannel,
} from './helper-supervisor.ts';

export type AssistanceHelperChannel = HelperChannel;

export interface AssistanceJobProgress {
	readonly completed: number;
	readonly total: number;
}

export interface AssistanceJobStartOptions {
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: AssistanceJobProgress) => void;
}

export interface AssistanceJobHostOptions {
	readonly spawn: () => AssistanceHelperChannel | Promise<AssistanceHelperChannel>;
	readonly verifyBinary?: () => Promise<void>;
	readonly cancellationBudgetMs?: number;
	readonly crashDetectionMs?: number;
	readonly sampleRss?: () => number | null;
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

export function createAssistanceJobHost(options: AssistanceJobHostOptions) {
	let nextJobId: string | null = null;
	let active: Readonly<{ jobId: string; controller: AbortController; completed: Promise<unknown> }> | null = null;
	const supervisor = new HelperSupervisor({
		spawn: options.spawn,
		verifyBinary: options.verifyBinary ?? (() => Promise.resolve()),
		mintJobId: () => {
			if (nextJobId === null) throw new Error('The assistance host has no admitted job identity.');
			const value = nextJobId;
			nextJobId = null;
			return value;
		},
		cancellationBudgetMs: options.cancellationBudgetMs ?? ASSISTANCE_CANCELLATION_BUDGET_MS,
		crashDetectionMs: options.crashDetectionMs,
		sampleRss: options.sampleRss,
		setTimeoutImpl: options.setTimeoutImpl,
		clearTimeoutImpl: options.clearTimeoutImpl,
	});

	function start(
		request: unknown,
		optionsValue?: AssistanceJobStartOptions | ((progress: AssistanceJobProgress) => void),
	): AssistanceJobRun {
		if (active) throw new Error('An assistance job is already running.');
		const validated: AssistanceJobRequest = validateAssistanceJobRequest(request);
		const options: AssistanceJobStartOptions = typeof optionsValue === 'function'
			? Object.freeze({ onProgress: optionsValue })
			: optionsValue ?? Object.freeze({});
		const controller = new AbortController();
		const externalSignal = options.signal;
		const forwardAbort = (): void => controller.abort(externalSignal?.reason);
		if (externalSignal?.aborted) forwardAbort();
		else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
		nextJobId = validated.jobId;
		const completed = supervisor.runJob({
			kind: 'assistance-speech',
			grant: validated.grant,
			signal: controller.signal,
			onProgress: (value) => options.onProgress?.(Object.freeze({ completed: value ?? 0, total: 1 })),
		}).catch((error: unknown) => {
			throw translateError(validated.jobId, error, controller.signal.aborted);
		}).finally(() => {
			externalSignal?.removeEventListener('abort', forwardAbort);
			if (active?.jobId === validated.jobId) active = null;
		});
		active = Object.freeze({ jobId: validated.jobId, controller, completed });
		return Object.freeze({
			jobId: validated.jobId,
			completed,
			async cancel(): Promise<void> {
				if (active?.jobId !== validated.jobId) return;
				controller.abort();
				try {
					await completed;
				} catch (error) {
					if (error instanceof AssistanceJobError && error.cause === 'cancelled') return;
					throw error;
				}
			},
		});
	}

	return Object.freeze({
		start,
		get isBusy(): boolean { return active !== null; },
		dispose(): void {
			if (active) active.controller.abort();
			supervisor.dispose();
		},
	});
}

function translateError(jobId: string, error: unknown, aborted = false): AssistanceJobError {
	if (error instanceof AssistanceJobError) return error;
	if (error instanceof HelperSupervisionError) {
		return new AssistanceJobError(jobId, error.message, assistanceCause(error.cause_));
	}
	if (aborted || isAbortError(error)) {
		return new AssistanceJobError(jobId, 'The assistance job was cancelled.', 'cancelled');
	}
	return new AssistanceJobError(jobId, error instanceof Error ? error.message : String(error), 'helper-error');
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function assistanceCause(cause: HelperSupervisionError['cause_']): string {
	if (cause === 'malformed-message') return 'malformed-message';
	if (cause === 'job-mismatch') return 'job-mismatch';
	if (cause === 'heartbeat') return 'heartbeat';
	if (cause === 'helper-exit') return 'helper-exit';
	if (cause === 'cancelled') return 'cancelled';
	if (cause === 'cancellation-timeout') return 'cancellation-timeout';
	if (cause === 'disposed') return 'disposed';
	return 'helper-error';
}
