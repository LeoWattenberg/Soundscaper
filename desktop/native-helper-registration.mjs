/* SPDX-License-Identifier: AGPL-3.0-only */

/** Assembles the native audio helper subsystem and registers it on main. */

import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

import { app, utilityProcess } from 'electron/main';

import { HelperSupervisor } from './project-library-runtime/desktop/helper-supervisor.js';
import {
	createNativeAddonVerifier,
	describeNativeAddonAvailability,
} from './project-library-runtime/desktop/native-addon-payload.js';
import { DesktopNativeAudioService } from './project-library-runtime/desktop/native-helper-service.js';

/**
 * Spawn authority lives here and nowhere else. The renderer cannot name the
 * payload, so main resolves it from the asar-protected pins, re-verifies the
 * bytes before every spawn, and hands the helper only an already-checked path
 * and the digest it must re-check for itself.
 */
export function registerDesktopNativeAudioHelper({
	channels, handle, ownerFor, settings, desktopRoot, packaged, resourcesPath,
}) {
	const applicationRoot = dirname(desktopRoot);
	const location = Object.freeze({ applicationRoot, packaged, resourcesPath });
	const verifyPayload = createNativeAddonVerifier(location);
	let child = null;
	let descriptor = null;

	const supervisor = new HelperSupervisor({
		verifyBinary: async () => { descriptor = await verifyPayload(); },
		spawn: async () => {
			if (!descriptor) throw new Error('The native helper payload was not verified before spawn.');
			const forked = utilityProcess.fork(
				join(desktopRoot, 'native-helper-process.js'),
				[`--helper-addon-config=${JSON.stringify({
					addonPath: descriptor.path,
					addonSha256: descriptor.sha256,
				})}`],
				{ serviceName: 'soundscaper-native-audio-helper' },
			);
			child = forked;
			return Object.freeze({
				postMessage: (message) => forked.postMessage(message),
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

	const service = new DesktopNativeAudioService({
		supervisor,
		isEnabled: () => settings.snapshot().nativeAudioHelperEnabled === true,
		describePayload: () => describeNativeAddonAvailability(location),
	});
	handle(channels.nativeAudioAvailability, () => service.availability());
	handle(channels.nativeAudioInventory, (event, value) =>
		service.describeBackend({ owner: ownerFor(event), backend: String(value?.backend || '') }));
	// The supervisor and the payload description are shared with plug-in
	// discovery: one payload, one supervisor, one concurrent job, exactly as
	// contract v1 admits.
	return Object.freeze({
		availability: () => service.availability(),
		clearQuarantine: () => service.clearQuarantine(),
		describeBackend: (request) => service.describeBackend(request),
		revokeOwner: (owner) => service.revokeOwner(owner),
		dispose: () => service.dispose(),
		supervisorPort: supervisor,
		describePayload: () => describeNativeAddonAvailability(location),
	});
}

/**
 * Keeps the surface menu-reached and off by default, like every other one, and
 * folds it into the Tools menu the probe helper already contributes rather than
 * adding a second one: the native tier is one place a user looks, not one place
 * per helper.
 *
 * The registration it acts on is a parameter, not module state: a menu that
 * reads whichever registration was made last acts on a service the tier it
 * belongs to may already have disposed.
 */
export function withNativeAudioHelperMenuItems(sections, settings, audio) {
	const items = [
		{ type: 'separator' },
		{
			label: 'Use Native Audio Helper',
			type: 'checkbox',
			checked: settings.snapshot().nativeAudioHelperEnabled === true,
			click: (item) => void settings.setNativeAudioHelperEnabled(item.checked),
		},
		{
			label: 'Clear Audio Helper Quarantine',
			click: () => audio?.clearQuarantine(),
		},
	];
	return sections.map((section) => (section.label === 'Tools'
		? { ...section, submenu: [...section.submenu, ...items] }
		: section));
}
