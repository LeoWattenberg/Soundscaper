/* SPDX-License-Identifier: AGPL-3.0-only */

/** Admit only native backends whose bounded offline output passed strict parity. */
export function admitsBoundedOfflineBackend(userAgent: unknown = globalThis.navigator?.userAgent): boolean {
	if (typeof userAgent !== 'string' || !/^Mozilla\/5\.0\s/u.test(userAgent)
		|| /\b(?:iPhone|iPad|iPod|CriOS|FxiOS|Version)\b/iu.test(userAgent)) return false;
	const chromium = /\b(?:Chrome|HeadlessChrome|Chromium)\/\d+(?:\.\d+)*\b/u.test(userAgent);
	const firefox = /\bFirefox\/\d+(?:\.\d+)*\b/u.test(userAgent);
	if (chromium === firefox) return false;
	if (chromium) return /\bAppleWebKit\/537\.36\b/u.test(userAgent) && /\bSafari\/537\.36\b/u.test(userAgent);
	return /\bGecko\/\d+\b/u.test(userAgent) && !/\b(?:AppleWebKit|Safari)\//u.test(userAgent);
}
