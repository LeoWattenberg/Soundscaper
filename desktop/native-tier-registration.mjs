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

export function registerDesktopNativeTier(options) {
	return Object.freeze({
		probe: registerDesktopHelperProbe(options),
		audio: registerDesktopNativeAudioHelper(options),
	});
}

export function disposeDesktopNativeTier(tier) {
	tier?.probe?.dispose();
	tier?.audio?.dispose();
}

/** Every native surface lives under the one Tools menu, off by default. */
export function desktopNativeTierMenu() {
	return withNativeAudioHelperMenuItems(desktopHelperProbeMenu());
}
