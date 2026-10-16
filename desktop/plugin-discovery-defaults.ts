/* SPDX-License-Identifier: AGPL-3.0-only */

import { DesktopPluginConsent, type DesktopPluginConsentOptions, type PluginFormat } from './plugin-consent.ts';

/** New installations discover standard folders; restored choices bypass these defaults. */
export function createDefaultPluginDiscoveryConsent(options: DesktopPluginConsentOptions, defaults: Readonly<{
	enabled: boolean;
	isFormatActivated: (format: PluginFormat) => boolean;
}>): DesktopPluginConsent {
	const consent = new DesktopPluginConsent(options);
	if (!defaults.enabled || options.state !== undefined) return consent;
	for (const format of consent.describe().formats) {
		if (!format.supported || !defaults.isFormatActivated(format.format) || format.roots.length === 0) continue;
		consent.grant(format.format);
		for (const root of format.roots) consent.admitStandardRoot(format.format, root.rootId);
	}
	return consent;
}
