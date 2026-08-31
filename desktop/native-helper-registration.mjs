/* SPDX-License-Identifier: AGPL-3.0-only */

/** Assembles the native audio helper subsystem and registers it on main. */

import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

import { app, MessageChannelMain, utilityProcess } from 'electron/main';

import { HelperSupervisor } from './project-library-runtime/desktop/helper-supervisor.js';
import { createNativeAudioHelperRuntime } from './project-library-runtime/desktop/native-audio-helper-adapter.js';
import { DesktopNativeAudioSessionService } from './project-library-runtime/desktop/native-audio-session-service.js';
import {
	createNativeAddonVerifier,
	describeNativeAddonAvailability,
} from './project-library-runtime/desktop/native-addon-payload.js';
import { DesktopNativeAudioService } from './project-library-runtime/desktop/native-helper-service.js';
import { DesktopNativeRealtimeBroker } from './project-library-runtime/desktop/native-realtime-broker.js';
import { productionSoundscaperAudioBackendActivated } from './soundscaper-native-activation-policy.mjs';
import {
	createSoundscaperProfessionalNativeVerifier,
	describeSoundscaperProfessionalNativePayload,
} from './soundscaper-professional-native-payload.mjs';

/**
 * Spawn authority lives here and nowhere else. The renderer cannot name the
 * payload, so main resolves it from the asar-protected pins, re-verifies the
 * bytes before every spawn, and hands the helper only an already-checked path
 * and the digest it must re-check for itself.
 */
export function registerDesktopNativeAudioHelper({
	channels, handle, ownerFor, settings, desktopRoot, packaged, resourcesPath,
	createMessageChannel = () => new MessageChannelMain(),
	isBackendActivated = productionAudioBackendActivated,
}) {
	const helper = createDesktopNativeAddonHelperSupervisor({
		desktopRoot, packaged, resourcesPath, role: 'audio',
		serviceName: 'soundscaper-native-audio-helper',
		payloadKind: 'professional',
	});
	const { supervisor } = helper;

	const service = new DesktopNativeAudioService({
		supervisor,
		isEnabled: () => settings.snapshot().nativeAudioHelperEnabled === true,
		describePayload: helper.describePayload,
	});
	const broker = new DesktopNativeRealtimeBroker({
		isEnabled: () => settings.snapshot().nativeAudioHelperEnabled === true,
	});
	const helperRuntime = createNativeAudioHelperRuntime({
		supervisor,
		broker,
		createChannel: createMessageChannel,
	});
	const sessions = new DesktopNativeAudioSessionService({
		adapter: Object.freeze({
			open: (candidate, format, signal) => settings.snapshot().nativeAudioHelperEnabled === true
				&& isBackendActivated(candidate.backend) === true
				? helperRuntime.adapter.open(candidate, format, signal)
				: Promise.resolve(Object.freeze({
					status: 'refused', code: 'backend-absent',
					detail: 'That native audio backend remains behind its production activation gate.',
				})),
		}),
		broker,
		realtime: helperRuntime.realtime,
		mintId: () => randomBytes(20).toString('hex'),
		resolveCalibration: (identity) => settings.resolveNativeAudioCalibration?.(identity) ?? null,
		persistCalibration: (value) => {
			if (typeof settings.persistNativeAudioCalibration !== 'function') {
				return Promise.reject(new Error('Desktop settings cannot persist native audio calibration.'));
			}
			return settings.persistNativeAudioCalibration(value);
		},
		persistRoute: (request) => {
			if (typeof settings.setNativeAudioRoutePreference !== 'function') {
				return Promise.reject(new Error('Desktop settings cannot persist a native audio route.'));
			}
			return settings.setNativeAudioRoutePreference(request);
		},
	});
	const setEnabled = async (enabled) => {
		const result = await settings.setNativeAudioHelperEnabled(enabled === true);
		if (!result) {
			service.disable();
			await sessions.closeAll();
		}
		return result;
	};
	const availability = async () => {
		const value = await service.availability();
		return Object.freeze({ ...value,
			routePreference: settings.snapshot().nativeAudioRoutePreference ?? null,
			backends: Object.freeze(
			value.backends.filter((backend) => isBackendActivated(backend) === true),
		) });
	};
	const describeBackend = (request) => isBackendActivated(request.backend) === true
		? service.describeBackend(request)
		: Promise.resolve(Object.freeze({
			status: 'failed', code: 'helper-unavailable',
			message: 'That native audio backend remains behind its production activation gate.',
		}));
	handle(channels.nativeAudioAvailability, availability);
	handle(channels.nativeAudioInventory, (event, value) => describeBackend({
		owner: ownerFor(event), backend: String(value?.backend || ''),
	}));
	handle(channels.nativeAudioSetEnabled, (event, value) => {
		ownerFor(event);
		return setEnabled(value === true);
	});
	handle(channels.nativeAudioSessionOpen, (event, value) => sessions.open(ownerFor(event), value));
	handle(channels.nativeAudioSessionBind, (event, value) => {
		const owner = ownerFor(event);
		return sessions.bind(owner, {
			sessionId: value?.sessionId,
			owner: event.sender,
			queueCapacity: value?.queueCapacity,
		});
	});
	handle(channels.nativeAudioSessionStatus, (event, value) =>
		sessions.status(ownerFor(event), value?.sessionId));
	handle(channels.nativeAudioSessionCalibrate, (event, value) =>
		sessions.calibrate(ownerFor(event), value?.sessionId, value?.calibrationFrames));
	handle(channels.nativeAudioSessionReport, (event, value) => {
		const owner = ownerFor(event);
		sessions.reportTransfer(owner, value?.sessionId, value?.framesTransferred, value?.lostFrames);
		return sessions.status(owner, value?.sessionId);
	});
	handle(channels.nativeAudioSessionLoss, async (event, value) => {
		const owner = ownerFor(event);
		await sessions.reportDeviceLost(owner, value?.sessionId, value?.reason);
		return sessions.status(owner, value?.sessionId);
	});
	handle(channels.nativeAudioSessionClose, (event, value) =>
		sessions.close(ownerFor(event), value?.sessionId));
	return Object.freeze({
		availability,
		controlSnapshot: () => Object.freeze({
			enabled: settings.snapshot().nativeAudioHelperEnabled === true,
			quarantined: supervisor.snapshot().quarantined === true,
		}),
		clearQuarantine: () => service.clearQuarantine(),
		describeBackend,
		setEnabled,
		sessions,
		realtimeBroker: broker,
		revokeOwner: async (owner) => {
			service.revokeOwner(owner);
			await sessions.revokeOwner(owner);
		},
		dispose: async () => {
			await sessions.dispose();
			broker.dispose();
			service.dispose();
		},
		supervisorPort: supervisor,
		describePayload: helper.describePayload,
	});
}

/** Resolve machine activation for native backends from authenticated machine state. */
export function productionAudioBackendActivated() {
	return productionSoundscaperAudioBackendActivated(...arguments);
}

/**
 * Creates one supervisor for one native-helper role. Sharing a payload does
 * not share process authority: audio, scanning, and each future plug-in host
 * get separate utility processes and separate crash/quarantine generations.
 */
export function createDesktopNativeAddonHelperSupervisor({
	desktopRoot, packaged, resourcesPath, role, serviceName, payloadKind = 'fixture',
}) {
	if (!['audio', 'plugin-scanner', 'plugin-host'].includes(role)) {
		throw new RangeError('A native addon helper requires one closed process role.');
	}
	const applicationRoot = dirname(desktopRoot);
	const location = Object.freeze({ applicationRoot, packaged, resourcesPath });
	if (!['fixture', 'professional'].includes(payloadKind)) {
		throw new RangeError('A native helper requires one closed payload kind.');
	}
	const professional = payloadKind === 'professional';
	const verifyPayload = professional
		? createSoundscaperProfessionalNativeVerifier(location)
		: createNativeAddonVerifier(location);
	let child = null;
	let descriptor = null;
	const supervisor = new HelperSupervisor({
		verifyBinary: async () => {
			descriptor = await verifyPayload();
			if (professional && role !== 'audio'
				&& (!descriptor.pluginPeer || !descriptor.isolation?.entrypoint)) {
				throw new Error('A professional plug-in helper requires an authenticated peer/isolation closure.');
			}
		},
		spawn: async () => {
			if (!descriptor) throw new Error('The native helper payload was not verified before spawn.');
			const forked = utilityProcess.fork(
				join(desktopRoot, 'native-helper-process.js'),
				[
					`--helper-role=${role}`,
					`--helper-addon-config=${JSON.stringify(professional ? {
						payloadKind: 'professional', location,
					} : {
						payloadKind: 'fixture', addonPath: descriptor.path, addonSha256: descriptor.sha256,
					})}`,
				],
				{ serviceName },
			);
			child = forked;
			return Object.freeze({
				postMessage: (message, transfer = []) => forked.postMessage(message, transfer),
				onMessage: (listener) => forked.on('message', listener),
				onExit: (listener) => forked.on('exit', (code) => listener(code ?? null)),
				kill: () => forked.kill(),
			});
		},
		mintJobId: () => randomBytes(20).toString('hex'),
		sampleRss: () => {
			const pid = child?.pid;
			if (!pid) return null;
			const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
			return metric ? metric.memory.workingSetSize * 1024 : null;
		},
	});
	return Object.freeze({
		location,
		supervisor,
		describePayload: () => professional
			? describeSoundscaperProfessionalNativePayload(location)
			: describeNativeAddonAvailability(location),
	});
}
