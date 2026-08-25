/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared control-v1 lifecycle for a helper process that owns one job kind. */

import {
	HELPER_CONTRACT_VERSION,
	HELPER_HEARTBEAT_INTERVAL_MS,
	helperJobTransferredPortCount,
	serializeHelperError,
	validateHelperHostMessage,
	validateHelperProcessMessage,
} from '#desktop-runtime/helper-contract';

export function createSingleKindHelperWorker({
	kind,
	post,
	runJob,
	heartbeatIntervalMs = HELPER_HEARTBEAT_INTERVAL_MS,
	setIntervalImpl = setInterval,
	clearIntervalImpl = clearInterval,
	exit = () => {},
}) {
	if (typeof kind !== 'string' || kind === '') throw new TypeError('A helper worker job kind is required.');
	if (typeof post !== 'function') throw new TypeError('A helper post seam is required.');
	if (typeof runJob !== 'function') throw new TypeError(`The ${kind} helper needs its one job runner.`);
	let activeJob = null;
	let disposed = false;

	const heartbeat = setIntervalImpl(() => {
		send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: activeJob?.jobId ?? null });
	}, heartbeatIntervalMs);
	heartbeat?.unref?.();
	send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'hello', kinds: [kind] });

	function send(message) {
		if (disposed) return;
		try {
			post(validateHelperProcessMessage(message));
		} catch {
			dispose(1);
		}
	}

	function sendError(jobId, error) {
		send({
			contractVersion: HELPER_CONTRACT_VERSION,
			type: 'error',
			jobId,
			error: serializeHelperError(error),
		});
	}

	function handleMessage(value, ports = []) {
		if (disposed) return;
		let message;
		try {
			message = validateHelperHostMessage(value);
		} catch {
			dispose(1);
			return;
		}
		if (message.type === 'shutdown') {
			if (ports.length !== 0) {
				dispose(1);
				return;
			}
			dispose(0);
			return;
		}
		if (message.type === 'cancel') {
			if (ports.length !== 0) {
				dispose(1);
				return;
			}
			const job = activeJob;
			if (job?.jobId === message.jobId) void cancelJob(job);
			return;
		}
		if (activeJob) {
			dispose(1);
			return;
		}
		if (message.kind !== kind) {
			sendError(message.jobId, new RangeError(`This helper does not implement ${message.kind} jobs.`));
			return;
		}
		const expectedPorts = helperJobTransferredPortCount(message.kind, message.grant);
		if (!Array.isArray(ports) || ports.length !== expectedPorts || ports.some((port) => (
			!port || typeof port.postMessage !== 'function' || typeof port.close !== 'function'
		))) {
			dispose(1);
			return;
		}
		startJob(message, ports);
	}

	function startJob(message, ports) {
		const job = { jobId: message.jobId, handle: null, cancelling: false, settled: false };
		activeJob = job;
		let handle;
		try {
			handle = runJob({
				grant: message.grant,
				ports: Object.freeze([...ports]),
				resourcePolicy: message.resourcePolicy,
				onProgress: (value) => {
					if (activeJob !== job || job.cancelling) return;
					send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'progress', jobId: message.jobId, value });
				},
			});
		} catch (error) {
			activeJob = null;
			sendError(message.jobId, error);
			return;
		}
		if (!handle || typeof handle.cancel !== 'function' || !(handle.completion instanceof Promise)) {
			activeJob = null;
			sendError(message.jobId, new TypeError('A helper runner returned no cancellable completion handle.'));
			return;
		}
		job.handle = handle;
		if (job.cancelling) void handle.cancel();
		handle.completion.then(
			(result) => settle(job, () => send({
				contractVersion: HELPER_CONTRACT_VERSION,
				type: 'result',
				jobId: job.jobId,
				result,
			})),
			(error) => settle(job, () => sendError(job.jobId, error)),
		);
	}

	function settle(job, emit) {
		if (job.settled || activeJob !== job) return;
		job.settled = true;
		activeJob = null;
		if (!job.cancelling) emit();
	}

	async function cancelJob(job) {
		if (job.cancelling || job.settled) return;
		job.cancelling = true;
		try {
			await job.handle?.cancel();
		} catch {
			// A rejected runner cancellation leaves quiescence unknown. Terminate
			// this containing process rather than acknowledge or admit overlap.
			dispose(1);
			return;
		}
		if (activeJob === job) {
			job.settled = true;
			activeJob = null;
		}
		send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled', jobId: job.jobId });
	}

	function dispose(code = 0) {
		if (disposed) return;
		disposed = true;
		clearIntervalImpl(heartbeat);
		const job = activeJob;
		activeJob = null;
		if (job && !job.settled) {
			job.settled = true;
			try {
				void Promise.resolve(job.handle?.cancel()).catch(() => undefined);
			} catch {
				// The process is going away; termination is best effort.
			}
		}
		exit(code);
	}

	return Object.freeze({ handleMessage, dispose });
}
