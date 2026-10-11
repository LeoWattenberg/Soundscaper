/* SPDX-License-Identifier: AGPL-3.0-only */
import { ordinaryBrowserProductSitePlan } from '../../../scripts/lib/browser-product-site-plan.mjs';

interface BrowserProductBaseUrlOptions {
	readonly file: string;
	readonly baseURL: string | undefined;
	readonly customSites?: boolean;
	readonly environment?: Readonly<Record<string, string | undefined>>;
}

/** Route ordinary Motion UI tests while preserving dedicated-site configuration. */
export function resolveBrowserProductBaseURL({
	file, baseURL, customSites = false, environment = process.env,
}: BrowserProductBaseUrlOptions): string | undefined {
	if (customSites || !/^motionscaper.*\.spec\.(?:js|ts)$/u.test(file.split(/[\\/]/u).at(-1) ?? '')) return baseURL;
	if (environment.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT && baseURL === environment.SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL) {
		const origins = JSON.parse(environment.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ?? 'null') as Record<string, unknown> | null;
		const sites = JSON.parse(environment.SCAPE_BROWSER_COVERAGE_SITES ?? 'null') as { productId: string; origin: string }[] | null;
		const motion = sites?.filter(site => site.productId === 'motionscaper');
		if (motion?.length !== 1 || typeof origins?.motionscaper !== 'string' || motion[0]!.origin !== origins.motionscaper) {
			throw new Error('Nightly Motion navigation requires its declared product origin and coverage site.');
		}
		const origin = new URL(origins.motionscaper);
		if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.origin !== origins.motionscaper) {
			throw new Error('Nightly Motion navigation requires an exact loopback origin.');
		}
		return origin.origin;
	}
	if (environment.SCAPE_BROWSER_COVERAGE_SITES) return baseURL;
	const plan = ordinaryBrowserProductSitePlan(environment);
	const soundscaper = plan.sites.find(site => site.productId === 'soundscaper');
	const motionscaper = plan.sites.find(site => site.productId === 'motionscaper');
	if (!soundscaper || !motionscaper) throw new Error('Ordinary browser sites must include Soundscaper and Motionscaper.');
	return baseURL === soundscaper.origin ? motionscaper.origin : baseURL;
}

/** A rehosted fixture replaces only the portable collector's site authority. */
export function scopedBrowserCoverageEnvironment(sites: readonly unknown[] | null, environment = process.env): NodeJS.ProcessEnv {
	return sites !== null && environment.SCAPE_BROWSER_COVERAGE_SITES
		? { ...environment, SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify(sites) } : environment;
}
