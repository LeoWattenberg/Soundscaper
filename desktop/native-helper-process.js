/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The native helper's control plane. In the application this module is the
 * entry of an Electron utility process spawned and owned by main; in tests it
 * is constructed directly with an injected post seam and engine loader, so the
 * contract duties are exercised without platform authority and the real
 * process boundary is exercised separately by the real-process smoke.
 *
 * This is the only place the trusted audio addon is loaded. Professional
 * plug-in roles instead reopen signed staged authority and proxy the actual
 * third-party-loading peer through the enforced child launcher.
 */

import { createSingleKindHelperWorker } from './helper-single-kind-worker.js';
import { createNativePersistentAudioJobRunner } from './native-helper-persistent-audio-job.js';
import { createNativePersistentPluginJobRunner } from './native-helper-persistent-plugin-job.js';
import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';

/** One process role owns one native authority family. */
export const NATIVE_HELPER_ROLES = Object.freeze({
	audio: Object.freeze({ kind: 'audio-device', serviceName: 'soundscaper-native-audio-helper' }),
	'plugin-scanner': Object.freeze({ kind: 'plugin-scan', serviceName: 'soundscaper-native-plugin-scanner' }),
	'plugin-host': Object.freeze({ kind: 'plugin-host', serviceName: 'soundscaper-native-plugin-host' }),
});

/** Aggregate vocabulary for callers selecting a dedicated role. */
export const NATIVE_HELPER_JOB_KINDS = Object.freeze(
	Object.values(NATIVE_HELPER_ROLES).map(({ kind }) => kind),
);

/** The loopback device the synthetic backend exposes for the transport proof. */
export const SYNTHETIC_LOOPBACK_DEVICE_HANDLE = 'synthetic:loopback';

/**
 * The reserved handle that asks a backend to describe itself rather than open a
 * device. Discovery is a distinct operation with a distinct answer, but it
 * travels as an ordinary audio-device grant so it passes exactly the admission
 * an open does — a second grant family would be a second thing to get wrong.
 *
 * Deliberately duplicated from the grant vocabulary rather than imported: this
 * entry may only name modules the packaged runtime maps for it, and that one is
 * not among them. A pinning test keeps the two equal.
 */
export const NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE = 'inventory';

/**
 * The bounds one inventory answer must stay inside, duplicated from the result
 * schema for the same reason and pinned by the same test.
 */
export const NATIVE_AUDIO_INVENTORY_BOUNDS = Object.freeze({
	devices: 128,
	textBytes: 192,
	detailBytes: 1_024,
});

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
	role = 'audio',
	post,
	runJob = null,
	// Transitional injected names keep the focused runner tests source-stable;
	// only the runner matching `role` is ever retained or callable.
	runDeviceJob = null,
	runScanJob = null,
	runHostJob = null,
	heartbeatIntervalMs,
	setIntervalImpl = setInterval,
	clearIntervalImpl = clearInterval,
	exit = () => {},
}) {
	const descriptor = nativeHelperRole(role);
	const selectedRunner = runJob ?? ({
		audio: runDeviceJob,
		'plugin-scanner': runScanJob,
		'plugin-host': runHostJob,
	})[role];
	if (typeof selectedRunner !== 'function') {
		throw new TypeError(`The ${role} native helper role needs its one job runner.`);
	}
	return createSingleKindHelperWorker({
		kind: descriptor.kind,
		post,
		runJob: selectedRunner,
		heartbeatIntervalMs,
		setIntervalImpl,
		clearIntervalImpl,
		exit,
	});
}

export function nativeHelperRole(value) {
	if (typeof value !== 'string' || !Object.hasOwn(NATIVE_HELPER_ROLES, value)) {
		throw new RangeError('A native helper process requires one closed role.');
	}
	return NATIVE_HELPER_ROLES[value];
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
 *
 * A machine with hundreds of PCM hints is answered with as many devices as one
 * inventory can carry and told so, because an answer that overflows the wire is
 * not a longer answer: it is a dead helper and no answer at all.
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
	const offered = Array.isArray(entry.devices) ? entry.devices : [];
	const devices = [];
	for (const device of offered) {
		if (devices.length >= NATIVE_AUDIO_INVENTORY_BOUNDS.devices) break;
		const handle = typeof device?.handle === 'string' ? device.handle : '';
		// A handle is an identity, not a display string: a device whose own is
		// too long to carry is omitted rather than published under a trimmed
		// name that would never reopen it.
		if (handle === '' || wireTextBytes(handle) > NATIVE_AUDIO_INVENTORY_BOUNDS.textBytes) continue;
		const label = typeof device.label === 'string' && device.label !== '' ? device.label : handle;
		const described = {
			handle,
			label: clampWireText(label, NATIVE_AUDIO_INVENTORY_BOUNDS.textBytes),
			direction: device.direction,
		};
		devices.push(Number.isSafeInteger(device.channelCount) && device.channelCount > 0
			? { ...described, channelCount: device.channelCount }
			: described);
	}
	return {
		backend,
		status: entry.status,
		detail: devices.length === offered.length
			? clampWireText(entry.detail ?? '', NATIVE_AUDIO_INVENTORY_BOUNDS.detailBytes)
			: `Only ${String(devices.length)} of ${String(offered.length)} devices fit one inventory answer.`,
		devices,
	};
}

function wireTextBytes(value) {
	return Buffer.byteLength(JSON.stringify(value));
}

function clampWireText(value, maximumBytes) {
	if (wireTextBytes(value) <= maximumBytes) return value;
	const points = Array.from(value);
	while (points.length > 0 && wireTextBytes(points.join('')) > maximumBytes) points.pop();
	return points.join('');
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
	const roleArgument = process.argv.find((value) => value.startsWith('--helper-role='));
	const role = roleArgument ? roleArgument.slice('--helper-role='.length) : '';
	nativeHelperRole(role);
	const { createHash } = await import('node:crypto');
	const addonSeams = config.payloadKind === 'professional'
		? await createProfessionalNativeHelperRoleSeams(config.location, role)
		: { addonPath: config.addonPath, addonSha256: config.addonSha256, loadAddon: loadVerifiedNativeAddon };
	const hashFile = authenticatePluginCandidate;
	let runJob;
	if (role === 'audio') {
		const runOneShot = createNativeDeviceJobRunner({ ...addonSeams, hash: () => createHash('sha256') });
		const runPersistent = createNativePersistentAudioJobRunner(addonSeams);
		runJob = (request) => request.grant.persistentPort ? runPersistent(request) : runOneShot(request);
	} else if (role === 'plugin-scanner') {
		const { createNativePluginScanJobRunner } = await import('./native-helper-scan-job.js');
		runJob = createNativePluginScanJobRunner({ ...addonSeams, hashFile });
	} else {
		const { createNativePluginHostJobRunner } = await import('./native-helper-host-job.js');
		const runOneShot = createNativePluginHostJobRunner({ ...addonSeams, hashFile, hash: () => createHash('sha256') });
		const runPersistent = createNativePersistentPluginJobRunner({ ...addonSeams, hashFile });
		runJob = (request) => request.grant.persistentPort ? runPersistent(request) : runOneShot(request);
	}
	const worker = createNativeHelperWorker({
		role,
		post: (message) => parentPort.postMessage(message),
		runJob,
		exit: (code) => process.exit(code),
	});
	parentPort.on('message', (event) => worker.handleMessage(event.data, event.ports ?? []));
}

export async function createProfessionalNativeHelperRoleSeams(location, role, ports = {}) {
	const { createSoundscaperProfessionalNativeVerifier } = await import('./soundscaper-professional-native-payload.mjs');
	const descriptor = await (ports.verifyPayload ?? createSoundscaperProfessionalNativeVerifier(location))();
	if (role === 'audio') {
		return { addonPath: descriptor.path, addonSha256: descriptor.sha256, loadAddon: loadVerifiedNativeAddon };
	}
	if (!descriptor.pluginPeer || !descriptor.isolation?.entrypoint) {
		throw new Error('Professional plug-in roles require an authenticated peer/isolation closure.');
	}
	const createLauncher = ports.createLauncher ?? (await import(
		'./project-library-runtime/desktop/native-child-isolation-launcher.js')).createNativeChildIsolationLauncher;
	const createPeer = ports.createPeer ?? (await import(
		'./project-library-runtime/desktop/soundscaper-professional-plugin-peer.js')).createSoundscaperProfessionalPluginPeer;
	const launcher = createLauncher({
		target: descriptor.target,
		machineWorkload: Object.freeze({
			kind: 'soundscaper',
			payloads: Object.freeze([descriptor.pluginPeer]),
			runtimeClosure: descriptor.isolation.runtimeClosure,
		}),
		artifacts: {
			launcher: descriptor.isolation.launcher,
			sandboxProfile: descriptor.isolation.sandboxProfile,
			brokerPolicy: descriptor.isolation.brokerPolicy,
		},
	});
	const machineAvailability = await launcher.machineReady();
	if (machineAvailability.status !== 'ready') {
		throw new Error(`The professional child launcher is unavailable: ${machineAvailability.detail}`);
	}
	const formats = descriptor.target.startsWith('mac-') ? ['vst3', 'clap', 'au']
		: descriptor.target.startsWith('linux-') ? ['vst3', 'clap', 'lv2'] : ['vst3', 'clap'];
	const peer = createPeer({
		launcher, peerExecutable: descriptor.pluginPeer, entryExecutable: descriptor.isolation.entrypoint,
		runtimeReadExecute: descriptor.isolation.runtimeClosure, pluginFormats: formats,
	});
	return { addonPath: descriptor.pluginPeer.path, addonSha256: descriptor.pluginPeer.sha256,
		loadAddon: async () => peer };
}
