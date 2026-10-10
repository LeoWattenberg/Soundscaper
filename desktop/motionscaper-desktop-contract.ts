/* SPDX-License-Identifier: AGPL-3.0-only */

export const MOTIONSCAPER_DESKTOP = Object.freeze({
	productId: 'motionscaper', name: 'Motionscaper', appId: 'org.motionscaper.desktop',
	scheme: 'motionscaper-app', origin: 'motionscaper-app://bundle',
	partition: 'persist:motionscaper-production', extension: '.mscape',
	updateTagPrefix: 'motionscaper-v',
});

export const MOTIONSCAPER_DESKTOP_CHANNELS = Object.freeze({
	environment: 'motionscaper:v1:environment',
	checkForUpdates: 'motionscaper:v1:updates:check',
});

/** M01 exposes identity only. Each later native service needs explicit admission. */
export function motionscaperDesktopEnvironment(version: string, platform: string) {
	return Object.freeze({
		productId: MOTIONSCAPER_DESKTOP.productId, appName: MOTIONSCAPER_DESKTOP.name,
		version, platform, locale: 'en', nativeCapabilities: Object.freeze([]),
	});
}

/** Only top-level, generated application documents may invoke the shell bridge. */
export function motionscaperDesktopDocumentUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === `${MOTIONSCAPER_DESKTOP.scheme}:` && url.host === 'bundle'
			&& !url.username && !url.password && !url.search
			&& /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?(?:index\.html)?$/u.test(url.pathname);
	} catch { return false; }
}
