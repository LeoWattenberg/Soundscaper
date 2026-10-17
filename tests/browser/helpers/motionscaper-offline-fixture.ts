/* SPDX-License-Identifier: AGPL-3.0-only */
import { test } from './browser-coverage-fixture.js';
import { createMotionscaperOfflineSite } from './motionscaper-offline-site.ts';

/** Keep the authenticated real origin alive until its coverage collector closes. */
export const motionOfflineTest = test.extend<{ offlineSite: Awaited<ReturnType<typeof createMotionscaperOfflineSite>> }>({
	// eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
	offlineSite: async ({}, use) => {
		const site = await createMotionscaperOfflineSite();
		try { await use(site); } finally { await site.dispose(); }
	},
	browserCoverageSites: async ({ offlineSite }, use) => { await use([offlineSite.descriptor]); },
});
