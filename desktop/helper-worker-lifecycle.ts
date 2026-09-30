/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared contract-v1 lifecycle for one-active-job desktop helper workers. */

import {
	HELPER_CONTRACT_VERSION,
	HELPER_HEARTBEAT_INTERVAL_MS,
	serializeHelperError,
	validateHelperHostMessage,
	validateHelperProcessMessage,
	type HelperJobKind,
	type HelperJobMessage,
} from './helper-contract.ts';

export interface HelperWorkerLifecycleJobHandle {
	readonly completion: Promise<unknown>;
	cancel(): Promise<void>;
}

export interface HelperWorkerLifecycleOptions {
	readonly kinds: readonly HelperJobKind[];
	readonly post: (message: unknown) => void;
	readonly admitsJob: (message: HelperJobMessage) => boolean;
	readonly transferredPortCount: (message: HelperJobMessage) => number;
	readonly runJob: (
		message: HelperJobMessage,
		ports: readonly unknown[],
	) => HelperWorkerLifecycleJobHandle;
	readonly releasePorts?: (ports: unknown) => void;
	readonly isFatalRunError?: (error: unknown) => boolean;
	readonly heartbeatIntervalMs?: number;
	readonly setIntervalImpl?: typeof setInterval;
	readonly clearIntervalImpl?: typeof clearInterval;
	readonly exit?: (code: number) => void;
}

interface ActiveJob {
	readonly jobId: string;
	readonly handle: HelperWorkerLifecycleJobHandle;
	readonly ports: readonly unknown[];
	cancelling: boolean;
	settled: boolean;
}

export function createHelperWorkerLifecycle(options: HelperWorkerLifecycleOptions) {
	const setIntervalImpl = options.setIntervalImpl ?? setInterval;
	const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
	const releasePorts = options.releasePorts ?? (() => undefined);
	const exit = options.exit ?? (() => undefined);
	let active: ActiveJob | null = null;
	let disposed = false;
	const heartbeat = setIntervalImpl(() => send({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'heartbeat',
		jobId: active?.jobId ?? null,
	}), options.heartbeatIntervalMs ?? HELPER_HEARTBEAT_INTERVAL_MS);
	heartbeat.unref?.();
	send({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'hello',
		kinds: [...options.kinds],
	});

	function send(value: unknown): void {
		if (disposed) return;
		try { options.post(validateHelperProcessMessage(value)); }
		catch { dispose(1); }
	}

	function handleMessage(value: unknown, ports: readonly unknown[] = []): void {
		if (disposed) { releasePorts(ports); return; }
		let message: ReturnType<typeof validateHelperHostMessage>;
		try { message = validateHelperHostMessage(value); }
		catch { releasePorts(ports); dispose(1); return; }
		if (message.type !== 'job') {
			if (!Array.isArray(ports) || ports.length !== 0) {
				releasePorts(ports);
				dispose(1);
				return;
			}
			if (message.type === 'shutdown') { dispose(0); return; }
			if (message.type === 'cancel' && active?.jobId === message.jobId) {
				void cancel(active);
			}
			return;
		}
		if (!options.admitsJob(message) || active !== null) {
			releasePorts(ports);
			dispose(1);
			return;
		}
		if (!Array.isArray(ports) || ports.length !== options.transferredPortCount(message)) {
			releasePorts(ports);
			dispose(1);
			return;
		}
		let handle: HelperWorkerLifecycleJobHandle;
		try { handle = options.runJob(message, ports); }
		catch (error) {
			releasePorts(ports);
			if (options.isFatalRunError?.(error) === true) { dispose(1); return; }
			sendError(message.jobId, error);
			return;
		}
		const job: ActiveJob = {
			jobId: message.jobId,
			handle,
			ports,
			cancelling: false,
			settled: false,
		};
		active = job;
		handle.completion.then(
			(result) => settle(job, () => send({
				contractVersion: HELPER_CONTRACT_VERSION,
				type: 'result',
				jobId: job.jobId,
				result,
			})),
			(error: unknown) => settle(job, () => sendError(job.jobId, error)),
		);
	}

	async function cancel(job: ActiveJob): Promise<void> {
		if (job.cancelling || job.settled || active !== job) return;
		job.cancelling = true;
		try { await job.handle.cancel(); }
		catch { dispose(1); return; }
		if (disposed || active !== job) return;
		job.settled = true;
		active = null;
		send({
			contractVersion: HELPER_CONTRACT_VERSION,
			type: 'cancelled',
			jobId: job.jobId,
		});
	}

	function settle(job: ActiveJob, emit: () => void): void {
		if (job.settled || active !== job || job.cancelling) return;
		job.settled = true;
		active = null;
		emit();
	}

	function sendError(jobId: string, error: unknown): void {
		send({
			contractVersion: HELPER_CONTRACT_VERSION,
			type: 'error',
			jobId,
			error: serializeHelperError(error),
		});
	}

	function dispose(code = 0): void {
		if (disposed) return;
		disposed = true;
		clearIntervalImpl(heartbeat);
		const job = active;
		active = null;
		if (job && !job.settled) {
			releasePorts(job.ports);
			void job.handle.cancel().catch(() => undefined);
		}
		exit(code);
	}

	return Object.freeze({ handleMessage, dispose });
}
