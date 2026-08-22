/* SPDX-License-Identifier: AGPL-3.0-only */

/** Contract-v1 control plane for one scanner or one per-fingerprint OpenFX utility process. */

import {
	HELPER_CONTRACT_VERSION,
	HELPER_HEARTBEAT_INTERVAL_MS,
	serializeHelperError,
	type HelperOfxHostJobGrant,
	type HelperOfxScanJobGrant,
	validateHelperHostMessage,
	validateHelperProcessMessage,
} from './helper-contract.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import type { FramescaperOpenFxHelperMode } from './framescaper-openfx-runtime.ts';

export interface OpenFxHelperJobRequest {
	readonly kind: 'ofx-scan' | 'ofx-host';
	readonly grant: HelperOfxScanJobGrant | HelperOfxHostJobGrant;
	readonly ports: readonly HelperDataPlaneIoPort[];
}

export interface OpenFxHelperJobHandle {
	readonly completion: Promise<unknown>;
	cancel(): Promise<void>;
}

export interface OpenFxHelperJobRunnerPort {
	run(request: OpenFxHelperJobRequest): OpenFxHelperJobHandle;
}

export interface OpenFxHelperWorkerOptions {
	readonly mode: FramescaperOpenFxHelperMode;
	readonly post: (message: unknown) => void;
	readonly runner: OpenFxHelperJobRunnerPort;
	readonly heartbeatIntervalMs?: number;
	readonly setIntervalImpl?: typeof setInterval;
	readonly clearIntervalImpl?: typeof clearInterval;
	readonly exit?: (code: number) => void;
}

interface ActiveJob {
	readonly jobId: string;
	readonly handle: OpenFxHelperJobHandle;
	cancelling: boolean;
	settled: boolean;
}

export function createOpenFxHelperWorker(options: OpenFxHelperWorkerOptions) {
	if (!options || (options.mode !== 'scanner' && options.mode !== 'runtime')
		|| typeof options.post !== 'function' || !options.runner
		|| typeof options.runner.run !== 'function') {
		throw new TypeError('An OpenFX helper requires an exact mode, post port, and job runner.');
	}
	const kind = options.mode === 'scanner' ? 'ofx-scan' : 'ofx-host';
	const setIntervalImpl = options.setIntervalImpl ?? setInterval;
	const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
	const exit = options.exit ?? (() => undefined);
	let active: ActiveJob | null = null;
	let disposed = false;
	const heartbeat = setIntervalImpl(() => send({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'heartbeat',
		jobId: active?.jobId ?? null,
	}), options.heartbeatIntervalMs ?? HELPER_HEARTBEAT_INTERVAL_MS);
	heartbeat.unref?.();
	send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'hello', kinds: [kind] });

	function send(value: unknown): void {
		if (disposed) return;
		try { options.post(validateHelperProcessMessage(value)); }
		catch { dispose(1); }
	}

	function handleMessage(value: unknown, ports: readonly unknown[] = []): void {
		if (disposed) return;
		let message: ReturnType<typeof validateHelperHostMessage>;
		try { message = validateHelperHostMessage(value); }
		catch { dispose(1); return; }
		if (message.type !== 'job') {
			if (!Array.isArray(ports) || ports.length !== 0) { dispose(1); return; }
			if (message.type === 'shutdown') { dispose(0); return; }
			if (message.type === 'cancel' && active?.jobId === message.jobId) void cancel(active);
			return;
		}
		if (message.kind !== kind || active !== null
			|| !Array.isArray(ports)
			|| ports.length !== openFxHelperTransferredPortCount(
				message.kind as 'ofx-scan' | 'ofx-host',
				message.grant as HelperOfxScanJobGrant | HelperOfxHostJobGrant,
			)) {
			dispose(1);
			return;
		}
		let handle: OpenFxHelperJobHandle;
		try {
			handle = options.runner.run({
				kind,
				grant: message.grant as HelperOfxScanJobGrant | HelperOfxHostJobGrant,
				ports: ports as readonly HelperDataPlaneIoPort[],
			});
		} catch (error) {
			sendError(message.jobId, error);
			return;
		}
		const job: ActiveJob = { jobId: message.jobId, handle, cancelling: false, settled: false };
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
		send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled', jobId: job.jobId });
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
		if (job && !job.settled) void job.handle.cancel().catch(() => undefined);
		exit(code);
	}

	return Object.freeze({ handleMessage, dispose });
}

export function openFxHelperTransferredPortCount(
	kind: 'ofx-scan' | 'ofx-host',
	grant: HelperOfxScanJobGrant | HelperOfxHostJobGrant,
): number {
	if (kind === 'ofx-scan') return 1;
	const host = grant as HelperOfxHostJobGrant;
	return 2 + host.inputs.length;
}
