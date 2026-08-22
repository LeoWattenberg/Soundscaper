/* SPDX-License-Identifier: AGPL-3.0-only */

/** Contract-v1 control plane for one isolated Framescaper media utility process. */

import {
	HELPER_CONTRACT_VERSION,
	HELPER_HEARTBEAT_INTERVAL_MS,
	serializeHelperError,
	type HelperJobGrant,
	type HelperMediaDecodeJobGrant,
	type HelperMediaEncodeJobGrant,
	type HelperMediaProxyJobGrant,
	validateHelperHostMessage,
	validateHelperProcessMessage,
} from './helper-contract.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import type {
	NativeMediaHelperJobHandle,
	NativeMediaHelperJobRequest,
} from './native-media-helper-job.ts';
import type { NativeMediaHelperPoolJobKind } from './native-media-helper-pool.ts';

export const NATIVE_MEDIA_HELPER_PROCESS_KINDS = Object.freeze([
	'probe-video-source',
	'media-decode',
	'media-encode',
	'media-render',
	'media-proxy',
] as const satisfies readonly NativeMediaHelperPoolJobKind[]);

export interface NativeMediaHelperProcessRunner {
	run(request: NativeMediaHelperJobRequest): NativeMediaHelperJobHandle;
}

export interface NativeMediaHelperWorkerOptions {
	readonly post: (message: unknown) => void;
	readonly runner: NativeMediaHelperProcessRunner;
	readonly heartbeatIntervalMs?: number;
	readonly setIntervalImpl?: typeof setInterval;
	readonly clearIntervalImpl?: typeof clearInterval;
	readonly exit?: (code: number) => void;
}

interface ActiveJob {
	readonly jobId: string;
	readonly handle: NativeMediaHelperJobHandle;
	cancelling: boolean;
	settled: boolean;
}

export function createNativeMediaHelperWorker(options: NativeMediaHelperWorkerOptions) {
	if (!options || typeof options.post !== 'function' || !options.runner
		|| typeof options.runner.run !== 'function') {
		throw new TypeError('A native media helper requires post and exact job-runner seams.');
	}
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
	send({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'hello',
		kinds: [...NATIVE_MEDIA_HELPER_PROCESS_KINDS],
	});

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
			if (message.type === 'cancel' && active?.jobId === message.jobId) {
				void cancel(active);
			}
			return;
		}
		if (!(NATIVE_MEDIA_HELPER_PROCESS_KINDS as readonly string[]).includes(message.kind)
			|| active !== null) {
			dispose(1);
			return;
		}
		if (!Array.isArray(ports)
			|| ports.length !== transferredPortCount(
				message.kind as NativeMediaHelperPoolJobKind,
				message.grant as HelperJobGrant<NativeMediaHelperPoolJobKind>,
			)) {
			dispose(1);
			return;
		}
		let handle: NativeMediaHelperJobHandle;
		try {
			handle = options.runner.run({
				kind: message.kind as NativeMediaHelperPoolJobKind,
				grant: message.grant as HelperJobGrant<NativeMediaHelperPoolJobKind>,
				ports: ports as readonly HelperDataPlaneIoPort[],
			});
		} catch (error) {
			if (error instanceof Error && /transferred MessagePort/u.test(error.message)) {
				dispose(1);
				return;
			}
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
		send({
			contractVersion: HELPER_CONTRACT_VERSION,
			type: 'cancelled',
			jobId: job.jobId,
		});
	}

	function settle(job: ActiveJob, emit: () => void): void {
		if (job.settled || active !== job) return;
		if (job.cancelling) return;
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

	function dispose(code: number): void {
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

function transferredPortCount(
	kind: NativeMediaHelperPoolJobKind,
	grant: HelperJobGrant<NativeMediaHelperPoolJobKind>,
): number {
	if (kind === 'probe-video-source') return 0;
	if (kind === 'media-proxy') {
		const proxy = grant as HelperMediaProxyJobGrant;
		return 1 + (proxy.source.type === 'stream' ? 1 : 0);
	}
	const media = grant as HelperMediaDecodeJobGrant | HelperMediaEncodeJobGrant;
	return 1 + media.sources.filter((source) => source.type === 'stream').length
		+ (kind === 'media-decode' ? 1 : 0);
}
