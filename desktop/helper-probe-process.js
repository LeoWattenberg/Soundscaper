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
	HELPER_PROBE_JOB_KINDS,
	serializeHelperError,
	validateHelperHostMessage,
	validateHelperProcessMessage,
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
	send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'hello', kinds: [...HELPER_PROBE_JOB_KINDS] });

	function send(message) {
		if (disposed) return;
		try {
			post(validateHelperProcessMessage(message));
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
			void cancelJob(job);
			return;
		}
		if (!HELPER_PROBE_JOB_KINDS.includes(message.kind)) {
			dispose(1);
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
		const job = { jobId: message.jobId, cancelled: false, cancelling: false, cancel: async () => {} };
		activeJob = job;
		let engine;
		try {
			engine = runEngineJob({
				kind: message.kind,
				grant: message.grant,
				resourcePolicy: message.resourcePolicy,
				onProgress: (value) => {
					if (job.cancelled || disposed || activeJob !== job) return;
					send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'progress', jobId: job.jobId, value });
				},
			});
		} catch {
			dispose(1);
			return;
		}
		if (!engine || typeof engine !== 'object' || typeof engine.cancel !== 'function'
			|| typeof engine.completion?.then !== 'function') {
			dispose(1);
			return;
		}
		job.cancel = () => engine.cancel();
		engine.completion.then(
			(result) => {
				if (job.cancelled || disposed || activeJob !== job) return;
				activeJob = null;
				send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId: job.jobId, result });
			},
			(error) => {
				if (job.cancelled || disposed || activeJob !== job) return;
				if (error?.code === 'HELPER_ENGINE_PROTOCOL_VIOLATION') {
					dispose(1);
					return;
				}
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

	async function cancelJob(job) {
		if (job.cancelling || job !== activeJob) return;
		job.cancelling = true;
		job.cancelled = true;
		try {
			await job.cancel();
		} catch {
			// Without a completed engine cancellation, quiescence is unknown.
			// Exit the containing utility process instead of acknowledging or
			// admitting another worker that could overlap the old one.
			dispose(1);
			return;
		}
		if (disposed || activeJob !== job) return;
		activeJob = null;
		send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled', jobId: job.jobId });
	}

	function dispose(code) {
		if (disposed) return;
		disposed = true;
		clearIntervalImpl(heartbeat);
		if (activeJob) void Promise.resolve(activeJob.cancel()).catch(() => undefined);
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
	return ({ grant, resourcePolicy, onProgress = () => {} }) => {
		const worker = new WorkerImpl(engineModuleUrl, {
			workerData: { engineConfig, grant, resourcePolicy },
		});
		let settle;
		const completion = new Promise((resolve, reject) => {
			settle = { resolve, reject };
		});
		let finished = false;
		let termination = null;
		const terminate = () => {
			if (termination) return termination;
			try {
				termination = Promise.resolve(worker.terminate()).then(() => undefined);
			} catch (error) {
				termination = Promise.reject(error);
			}
			return termination;
		};
		worker.on('message', (message) => {
			if (finished) return;
			if (message?.type === 'progress') {
				const keys = Object.keys(message);
				if (keys.length === 2 && keys.includes('type') && keys.includes('value')
					&& (message.value === null || (typeof message.value === 'number'
						&& Number.isFinite(message.value) && message.value >= 0 && message.value <= 1))) {
					onProgress(message.value);
					return;
				}
				finished = true;
				void terminate().then(
					() => settle.reject(engineProtocolViolation('The probe engine sent malformed progress.')),
					(error) => settle.reject(error instanceof Error ? error : new Error(String(error))),
				);
				return;
			}
			let terminal;
			try {
				terminal = validateEngineTerminalMessage(message);
			} catch (error) {
				finished = true;
				void terminate().then(
					() => settle.reject(error),
					(terminationError) => settle.reject(
						terminationError instanceof Error ? terminationError : new Error(String(terminationError)),
					),
				);
				return;
			}
			finished = true;
			void terminate().then(
				() => {
					if (terminal.ok === true) settle.resolve(terminal.result);
					else settle.reject(deserializeEngineError(terminal));
				},
				(error) => settle.reject(error instanceof Error ? error : new Error(String(error))),
			);
		});
		worker.once('error', (error) => {
			if (finished) return;
			finished = true;
			void terminate().then(
				() => settle.reject(error instanceof Error ? error : new Error(String(error))),
				(terminationError) => settle.reject(
					terminationError instanceof Error ? terminationError : new Error(String(terminationError)),
				),
			);
		});
		worker.once('exit', (code) => {
			if (finished) return;
			finished = true;
			settle.reject(new Error(`The probe engine thread exited with code ${String(code)}.`));
		});
		return Object.freeze({
			completion,
			cancel: () => {
				if (finished) return termination ?? Promise.resolve();
				finished = true;
				return terminate();
			},
		});
	};
}

function validateEngineTerminalMessage(message) {
	if (!message || typeof message !== 'object' || Array.isArray(message)) {
		throw engineProtocolViolation('The probe engine sent a malformed terminal message.');
	}
	const keys = Object.keys(message);
	if (message.ok === true && keys.length === 2 && keys.includes('ok') && keys.includes('result')) return message;
	const errorKeys = ['ok', 'name', 'message', ...(message.code === undefined ? [] : ['code'])];
	if (message.ok === false && keys.length === errorKeys.length && keys.every((key) => errorKeys.includes(key))
		&& typeof message.name === 'string' && typeof message.message === 'string'
		&& (message.code === undefined || typeof message.code === 'string')) {
		return message;
	}
	throw engineProtocolViolation('The probe engine sent a malformed terminal message.');
}

function engineProtocolViolation(message) {
	const error = new TypeError(message);
	error.code = 'HELPER_ENGINE_PROTOCOL_VIOLATION';
	return error;
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
