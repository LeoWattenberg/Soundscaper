/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The native helper's control plane. In the application this module is the
 * entry of an Electron utility process spawned and owned by main; in tests it
 * is constructed directly with an injected post seam and engine loader, so the
 * contract duties are exercised without platform authority and the real
 * process boundary is exercised separately by the real-process smoke.
 *
 * This is the only place the native addon is ever loaded. Main never dlopens
 * it, the preload never sees it, and the renderer cannot name it: the helper
 * receives an already-verified absolute payload path and its expected digest,
 * re-checks the bytes itself, and refuses to load anything else.
 */

import { createNativePluginScanJobRunner } from './native-helper-scan-job.js';
import {
	HELPER_CONTRACT_VERSION,
	HELPER_HEARTBEAT_INTERVAL_MS,
	serializeHelperError,
	validateHelperHostMessage,
	validateHelperProcessMessage,
} from '#desktop-runtime/helper-contract';

/** The kinds this helper implements today; unannounced kinds are refused. */
export const NATIVE_HELPER_JOB_KINDS = Object.freeze(['audio-device', 'plugin-scan']);

/** The loopback device the synthetic backend exposes for the transport proof. */
export const SYNTHETIC_LOOPBACK_DEVICE_HANDLE = 'synthetic:loopback';

/**
 * The reserved handle that asks a backend to describe itself rather than open a
 * device. Discovery is a distinct operation with a distinct answer, but it
 * travels as an ordinary audio-device grant so it passes exactly the admission
 * an open does — a second grant family would be a second thing to get wrong.
 */
export const NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE = 'inventory';

export const SYNTHETIC_ENGINE_MODES = Object.freeze({
	passthrough: 0,
	gain: 1,
	tone: 2,
	impulse: 3,
});

export const SYNTHETIC_ENGINE_FAULTS = Object.freeze({
	none: 0,
	abort: 1,
	hang: 2,
});

export function createNativeHelperWorker({
	post,
	runDeviceJob,
	runScanJob = null,
	heartbeatIntervalMs = HELPER_HEARTBEAT_INTERVAL_MS,
	setIntervalImpl = setInterval,
	clearIntervalImpl = clearInterval,
	exit = () => {},
}) {
	if (typeof post !== 'function') throw new TypeError('A helper post seam is required.');
	if (typeof runDeviceJob !== 'function') throw new TypeError('A native device job runner is required.');
	let activeJob = null;
	let disposed = false;

	const heartbeat = setIntervalImpl(() => {
		send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: activeJob?.jobId ?? null });
	}, heartbeatIntervalMs);
	if (typeof heartbeat?.unref === 'function') heartbeat.unref();
	send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'hello', kinds: [...NATIVE_HELPER_JOB_KINDS] });

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

	function handleMessage(value) {
		if (disposed) return;
		let message;
		try {
			message = validateHelperHostMessage(value);
		} catch {
			// A host that violates its own contract cannot be reasoned with.
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
		if (activeJob) {
			// Contract v1 admits one concurrent job; a second is a host defect.
			dispose(1);
			return;
		}
		const runner = message.kind === 'plugin-scan' ? runScanJob : runDeviceJob;
		if (!NATIVE_HELPER_JOB_KINDS.includes(message.kind) || typeof runner !== 'function') {
			sendError(message.jobId, new RangeError(`This helper does not implement ${message.kind} jobs.`));
			return;
		}
		startJob(message, runner);
	}

	function startJob(message, runner) {
		// The job record is published before the runner starts, because a runner
		// that reports progress synchronously would otherwise emit against a job
		// the worker does not yet own — and that progress would be dropped.
		const job = { jobId: message.jobId, handle: null, cancelling: false, settled: false };
		activeJob = job;
		let handle;
		try {
			handle = runner({
				grant: message.grant,
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
		// A cancelled job answers `cancelled` and nothing else: the supervisor
		// treats a terminal result after cancellation as a protocol violation.
		if (job.cancelling) return;
		emit();
	}

	async function cancelJob(job) {
		if (job.cancelling || job.settled) return;
		job.cancelling = true;
		try {
			await job.handle?.cancel();
		} catch {
			// Cancellation is best effort; quiescence is what is acknowledged.
		}
		if (activeJob === job) {
			job.settled = true;
			activeJob = null;
		}
		send({ contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled', jobId: job.jobId });
	}

	function dispose(code) {
		if (disposed) return;
		disposed = true;
		clearIntervalImpl(heartbeat);
		const job = activeJob;
		activeJob = null;
		if (job && !job.settled) {
			job.settled = true;
			try {
				void Promise.resolve(job.handle.cancel()).catch(() => undefined);
			} catch {
				// The process is going away; termination is best effort.
			}
		}
		exit(code);
	}

	return Object.freeze({ handleMessage, dispose });
}

/**
 * Loads the verified addon and runs one synthetic device session. The digest is
 * re-checked inside the helper as well as in main: main proves the file it
 * granted is the pinned one, and this proves the bytes this process is about to
 * execute are still those bytes.
 */
export function createNativeDeviceJobRunner({
	addonPath,
	addonSha256,
	loadAddon,
	hash,
	blockFrames = 1_024,
	blocks = 8,
	yieldBetweenBlocks = defaultBlockYield,
}) {
	if (typeof loadAddon !== 'function') throw new TypeError('A native addon loader is required.');
	if (typeof hash !== 'function') throw new TypeError('A native addon digest function is required.');
	let addon = null;

	return ({ grant, onProgress }) => {
		let cancelled = false;
		const completion = (async () => {
			if (grant.deviceHandle === NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE) {
				addon ??= await loadAddon({ addonPath, addonSha256 });
				return describeBackendInventory(addon, grant.backend);
			}
			if (grant.backend !== 'synthetic' || grant.deviceHandle !== SYNTHETIC_LOOPBACK_DEVICE_HANDLE) {
				throw new RangeError(`This helper build implements only the ${SYNTHETIC_LOOPBACK_DEVICE_HANDLE} device.`);
			}
			addon ??= await loadAddon({ addonPath, addonSha256 });
			const description = addon.describe();
			const channelCount = grant.direction === 'duplex' ? 2 : 1;
			const engine = addon.createSyntheticEngine({
				channelCount,
				frameCount: blockFrames,
				sampleRate: 48_000,
				generation: 1,
				mode: SYNTHETIC_ENGINE_MODES.tone,
				fault: SYNTHETIC_ENGINE_FAULTS.none,
				gain: 1,
				faultFrame: 0,
			});
			const channels = Array.from({ length: channelCount }, () => new Float32Array(blockFrames));
			const digest = hash();
			let framesRendered = 0;
			for (let block = 0; block < blocks; block += 1) {
				if (cancelled) break;
				addon.renderSyntheticBlock(engine, framesRendered, blockFrames, null, channels);
				for (const channel of channels) {
					digest.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
				}
				framesRendered += blockFrames;
				onProgress((block + 1) / blocks);
				// Yield to the macrotask queue, not just the microtask queue: a
				// loop that only drains microtasks starves its own channel, so a
				// cancellation posted from main could not arrive until the job
				// had already finished.
				await yieldBetweenBlocks();
			}
			return {
				addon: {
					addonVersion: description.addonVersion,
					buildId: description.buildId,
					napiVersion: description.napiVersion,
					maximumChannelCount: description.maximumChannelCount,
					maximumFrameCount: description.maximumFrameCount,
				},
				backend: grant.backend,
				deviceHandle: grant.deviceHandle,
				sampleRate: 48_000,
				channelCount,
				blockFrames,
				blocksRendered: framesRendered / blockFrames,
				framesRendered,
				renderedSha256: digest.digest('hex'),
			};
		})();
		return Object.freeze({
			completion,
			cancel: async () => {
				cancelled = true;
				await completion.catch(() => undefined);
			},
		});
	};
}

/**
 * Asks the addon what one backend can actually do here. The synthetic backend
 * is answered without consulting the platform and is deliberately reported with
 * no devices: it exists for the transport proof and must never be published as
 * something a user could select.
 */
function describeBackendInventory(addon, backend) {
	if (backend === 'synthetic') {
		return { backend, status: 'unsupported-platform', detail: 'The synthetic backend publishes no devices.', devices: [] };
	}
	const reported = addon.enumerateAudioBackends();
	const entry = Array.isArray(reported) ? reported.find((value) => value?.backend === backend) : null;
	if (!entry) {
		return {
			backend,
			status: 'unsupported-platform',
			detail: `This payload does not implement the ${backend} backend.`,
			devices: [],
		};
	}
	return {
		backend,
		status: entry.status,
		detail: entry.detail ?? '',
		devices: (entry.devices ?? []).map((device) => ({
			handle: device.handle,
			label: device.label,
			direction: device.direction,
		})),
	};
}

function defaultBlockYield() {
	return new Promise((resolve) => { setTimeout(resolve, 0); });
}

/** Reads, digest-checks and loads the addon; a mismatch never reaches dlopen. */
export async function loadVerifiedNativeAddon({ addonPath, addonSha256 }) {
	const { createHash } = await import('node:crypto');
	const { readFile } = await import('node:fs/promises');
	const { createRequire } = await import('node:module');
	const bytes = await readFile(addonPath);
	if (createHash('sha256').update(bytes).digest('hex') !== addonSha256) {
		throw new Error('The native helper addon on disk does not match its pinned digest.');
	}
	return createRequire(import.meta.url)(addonPath);
}

const parentPort = globalThis.process?.parentPort;
if (parentPort && typeof parentPort.on === 'function') {
	const argument = process.argv.find((value) => value.startsWith('--helper-addon-config='));
	const config = JSON.parse(argument ? argument.slice('--helper-addon-config='.length) : '{}');
	const { createHash } = await import('node:crypto');
	const { readFile } = await import('node:fs/promises');
	const addonSeams = { addonPath: config.addonPath, addonSha256: config.addonSha256, loadAddon: loadVerifiedNativeAddon };
	const worker = createNativeHelperWorker({
		post: (message) => parentPort.postMessage(message),
		runDeviceJob: createNativeDeviceJobRunner({ ...addonSeams, hash: () => createHash('sha256') }),
		runScanJob: createNativePluginScanJobRunner({
			...addonSeams,
			hashFile: async (path) => {
				const bytes = await readFile(path);
				return { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
			},
		}),
		exit: (code) => process.exit(code),
	});
	parentPort.on('message', (event) => worker.handleMessage(event.data));
}
