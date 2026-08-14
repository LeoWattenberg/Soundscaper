/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The probe helper's control plane. In the application this module runs as
 * the entry of an Electron utility process spawned and owned by main; in
 * tests it is constructed directly with an injected post seam and engine.
 * The control plane owns the contract-v1 client duties — handshake,
 * heartbeat, one-job admission, cancellation acknowledgement — and runs the
 * probe engine in a dedicated worker thread per job, so a malformed media
 * file can only take down that thread, cancellation is an immediate thread
 * termination inside the acknowledgement budget, and heartbeats keep
 * flowing while the engine decodes.
 */

import {
	HELPER_CONTRACT_VERSION,
	HELPER_HEARTBEAT_INTERVAL_MS,
	HELPER_JOB_KINDS,
	serializeHelperError,
	validateHelperHostMessage,
} from '#desktop-runtime/helper-contract';

export function createHelperProbeWorker({
	post,
	runEngineJob,
	heartbeatIntervalMs = HELPER_HEARTBEAT_INTERVAL_MS,
	setIntervalImpl = setInterval,
	clearIntervalImpl = clearInterval,
	exit = () => {},
}) {
	if (typeof post !== 'function') throw new TypeError('A helper post seam is required.');
	if (typeof runEngineJob !== 'function') throw new TypeError('A helper engine job runner is required.');
	let activeJob = null;
	let disposed = false;

	const heartbeat = setIntervalImpl(() => {
		send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: activeJob?.jobId ?? null });
	}, heartbeatIntervalMs);
	if (typeof heartbeat?.unref === 'function') heartbeat.unref();
	send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'hello', kinds: [...HELPER_JOB_KINDS] });

	function send(message) {
		if (disposed) return;
		try {
			post(message);
		} catch {
			dispose(1);
		}
	}

	function handleMessage(value) {
		if (disposed) return;
		let message;
		try {
			message = validateHelperHostMessage(value);
		} catch {
			// A host that violates its own contract cannot be reasoned with:
			// fail closed instead of guessing at intent.
			dispose(1);
			return;
		}
		if (message.type === 'shutdown') {
			dispose(0);
			return;
		}
		if (message.type === 'cancel') {
			const job = activeJob;
			if (!job || job.jobId !== message.jobId) return;
			job.cancelled = true;
			job.cancel();
			send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled', jobId: job.jobId });
			activeJob = null;
			return;
		}
		if (activeJob) {
			send({
				contractVersion: HELPER_CONTRACT_VERSION,
				type: 'error',
				jobId: message.jobId,
				error: serializeHelperError(new Error('The helper admits one job at a time.')),
			});
			return;
		}
		const job = { jobId: message.jobId, cancelled: false, cancel: () => {} };
		activeJob = job;
		const engine = runEngineJob({
			kind: message.kind,
			grant: message.grant,
			resourcePolicy: message.resourcePolicy,
		});
		job.cancel = () => engine.cancel();
		engine.completion.then(
			(result) => {
				if (job.cancelled || disposed || activeJob !== job) return;
				activeJob = null;
				send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId: job.jobId, result });
			},
			(error) => {
				if (job.cancelled || disposed || activeJob !== job) return;
				activeJob = null;
				send({
					contractVersion: HELPER_CONTRACT_VERSION,
					type: 'error',
					jobId: job.jobId,
					error: serializeHelperError(error),
				});
			},
		);
	}

	function dispose(code) {
		if (disposed) return;
		disposed = true;
		clearIntervalImpl(heartbeat);
		activeJob?.cancel();
		activeJob = null;
		exit(code);
	}

	return Object.freeze({ handleMessage, dispose });
}

/**
 * Runs one probe job in a fresh worker thread. A fresh thread per job keeps
 * engine state from ever crossing jobs and makes cancellation an immediate
 * `terminate()` rather than a cooperative request.
 */
export function createEngineThreadJobRunner({ engineModuleUrl, engineConfig, WorkerImpl }) {
	return ({ grant, resourcePolicy }) => {
		const worker = new WorkerImpl(engineModuleUrl, {
			workerData: { engineConfig, grant, resourcePolicy },
		});
		let settle;
		const completion = new Promise((resolve, reject) => {
			settle = { resolve, reject };
		});
		let finished = false;
		worker.once('message', (message) => {
			finished = true;
			if (message && message.ok === true) settle.resolve(message.result);
			else settle.reject(deserializeEngineError(message));
			void worker.terminate();
		});
		worker.once('error', (error) => {
			if (finished) return;
			finished = true;
			settle.reject(error instanceof Error ? error : new Error(String(error)));
		});
		worker.once('exit', (code) => {
			if (finished) return;
			finished = true;
			settle.reject(new Error(`The probe engine thread exited with code ${String(code)}.`));
		});
		return Object.freeze({
			completion,
			cancel: () => {
				finished = true;
				void worker.terminate();
			},
		});
	};
}

function deserializeEngineError(message) {
	const error = new Error(typeof message?.message === 'string' ? message.message : 'The probe engine failed.');
	if (typeof message?.name === 'string' && message.name) error.name = message.name;
	if (typeof message?.code === 'string' && message.code) error.code = message.code;
	return error;
}

const parentPort = globalThis.process?.parentPort;
if (parentPort && typeof parentPort.on === 'function') {
	const configArgument = process.argv.find((argument) => argument.startsWith('--helper-engine-config='));
	const engineConfig = JSON.parse(configArgument ? configArgument.slice('--helper-engine-config='.length) : '{}');
	const { Worker } = await import('node:worker_threads');
	const worker = createHelperProbeWorker({
		post: (message) => parentPort.postMessage(message),
		runEngineJob: createEngineThreadJobRunner({
			engineModuleUrl: new URL('./helper-probe-engine.js', import.meta.url),
			engineConfig,
			WorkerImpl: Worker,
		}),
		exit: (code) => process.exit(code),
	});
	parentPort.on('message', (event) => worker.handleMessage(event.data));
}
