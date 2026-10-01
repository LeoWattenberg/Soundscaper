// @ts-check
/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

/** @param {ReadonlyArray<readonly [import('@playwright/test').Locator, import('@playwright/test').Locator]>} pairs */
export async function expectRenderedTrackOrder(pairs) {
	for (const [original, rendered] of pairs) {
		const index = Number(await original.getAttribute('data-track-index'));
		await expect(rendered.locator('xpath=ancestor::div[@data-track-row][1]'))
			.toHaveAttribute('data-track-index', String(index + 1));
	}
}
