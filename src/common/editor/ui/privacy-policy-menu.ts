/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_APPLICATION_MENU_UTILITY_IDS } from './application-menu-registry.ts';

export function createPrivacyPolicyMenuItem(
	copy: Readonly<{ legalLink: string }>,
	open: () => unknown,
) {
	return Object.freeze({
		id: AUDIO_EDITOR_APPLICATION_MENU_UTILITY_IDS.privacyPolicy,
		label: copy.legalLink,
		onClick: open,
	});
}
