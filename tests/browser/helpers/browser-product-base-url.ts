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
	if (customSites || environment.SCAPE_BROWSER_COVERAGE_SITES
		|| !/^motionscaper.*\.spec\.(?:js|ts)$/u.test(file.split(/[\\/]/u).at(-1) ?? '')) return baseURL;
	const plan = ordinaryBrowserProductSitePlan(environment);
	const soundscaper = plan.sites.find(site => site.productId === 'soundscaper');
	const motionscaper = plan.sites.find(site => site.productId === 'motionscaper');
	if (!soundscaper || !motionscaper) throw new Error('Ordinary browser sites must include Soundscaper and Motionscaper.');
	return baseURL === soundscaper.origin ? motionscaper.origin : baseURL;
}
