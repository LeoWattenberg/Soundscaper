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

export function registerDesktopNativeTier(options) {
	const audio = registerDesktopNativeAudioHelper(options);
	return Object.freeze({
		probe: registerDesktopHelperProbe(options),
		audio,
		// Discovery reuses the audio helper's supervisor because contract v1
		// admits one concurrent job: two supervisors over one payload would let a
		// scan and a device session run at once, which the contract forbids.
		plugins: registerDesktopPluginDiscovery({
			...options,
			supervisor: audio.supervisorPort,
			describePayload: audio.describePayload,
		}),
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
export function desktopNativeTierMenu(settings) {
	return withNativeAudioHelperMenuItems(desktopHelperProbeMenu()).map((section) => (section.label === 'Tools'
		? { ...section, submenu: [...section.submenu, ...desktopPluginDiscoveryMenuItems(settings)] }
		: section));
}
