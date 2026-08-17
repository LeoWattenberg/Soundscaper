/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * One seam for the whole supervised native tier.
 *
 * Every helper is registered, revoked, disposed and menu-reached together, so
 * main holds one handle rather than one variable per helper. That matters
 * beyond tidiness: a helper that main forgets to revoke on renderer loss keeps
 * running for a window that is already gone, and a per-helper variable is
 * exactly how that gets forgotten.
 */

import { desktopHelperProbeMenu, registerDesktopHelperProbe } from './helper-registration.mjs';
import {
	registerDesktopNativeAudioHelper,
	withNativeAudioHelperMenuItems,
} from './native-helper-registration.mjs';
import {
	desktopPluginDiscoveryMenuItems,
	registerDesktopPluginDiscovery,
} from './plugin-registration.mjs';

/**
 * What every registrar behind this seam is entitled to receive. Spreading an
 * unchecked bag into each of them is what let a missing seam reach a path join
 * inside a helper, where the failure named an argument type rather than the
 * caller that forgot it, and took the whole start-up down with it.
 */
const REQUIRED_SEAMS = Object.freeze({
	channels: 'object',
	handle: 'function',
	ownerFor: 'function',
	readCapabilities: 'object',
	settings: 'object',
	desktopRoot: 'string',
	packaged: 'boolean',
	resourcesPath: 'string',
	userDataPath: 'string',
	parentWindow: 'function',
});

export function registerDesktopNativeTier(options) {
	const seams = requireNativeTierSeams(options);
	const audio = registerDesktopNativeAudioHelper(seams);
	const plugins = registerDesktopPluginDiscovery({
		...seams,
		// Discovery reuses the audio helper's supervisor because contract v1
		// admits one concurrent job: two supervisors over one payload would let a
		// scan and a device session run at once, which the contract forbids.
		supervisor: audio.supervisorPort,
		describePayload: audio.describePayload,
	});
	return Object.freeze({
		probe: registerDesktopHelperProbe(seams),
		audio,
		plugins,
		/** The durable stores the surfaces consult, loaded before a window exists. */
		ready: () => plugins.ready(),
	});
}

export function disposeDesktopNativeTier(tier) {
	tier?.probe?.dispose();
	tier?.audio?.dispose();
	tier?.plugins?.dispose();
}

/** Every native surface drains together when a renderer goes away. */
export function revokeDesktopNativeTierOwner(tier, owner) {
	tier?.probe?.revokeOwner(owner);
	tier?.audio?.revokeOwner(owner);
	tier?.plugins?.revokeOwner(owner);
}

/** Every native surface lives under the one Tools menu, off by default. */
export function desktopNativeTierMenu(settings, tier) {
	return withNativeAudioHelperMenuItems(desktopHelperProbeMenu(), settings, tier?.audio)
		.map((section) => (section.label === 'Tools'
			? { ...section, submenu: [...section.submenu, ...desktopPluginDiscoveryMenuItems(settings)] }
			: section));
}

function requireNativeTierSeams(options) {
	if (!options || typeof options !== 'object') {
		throw new TypeError('The native tier is registered from one options record naming every seam it forwards.');
	}
	for (const [seam, kind] of Object.entries(REQUIRED_SEAMS)) {
		if (options[seam] === null || typeof options[seam] !== kind) {
			throw new TypeError(`The native tier requires a ${kind} ${seam} seam from main.`);
		}
	}
	return options;
}
