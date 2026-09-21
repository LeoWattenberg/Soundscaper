/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';

import type {
	DesktopNightlyTestsDependencies,
	DesktopNightlyTestsEnvironment,
} from '../../scripts/lib/desktop-nightly-tests-runtime.mjs';

export function nightlyProductSitesFixture(
	firstPort: number,
	onClose: () => void = () => undefined,
): NonNullable<DesktopNightlyTestsDependencies['startProductSites']> {
	return async ({ payloadRoot, environment = {} }) => {
		const origins = Object.freeze({
			soundscaper: `http://127.0.0.1:${String(firstPort)}`,
			framescaper: `http://127.0.0.1:${String(firstPort + 1)}`,
		});
		const browserEnvironment: DesktopNightlyTestsEnvironment = Object.freeze({
			...environment,
			SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify(origins),
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify(Object.entries(origins).map(([
				productId,
				origin,
			]) => ({ productId, origin, outputDirectory: join(payloadRoot, 'sites', productId) }))),
		});
		return Object.freeze({
			origins,
			browserEnvironment,
			close: async () => { onClose(); },
		});
	};
}
