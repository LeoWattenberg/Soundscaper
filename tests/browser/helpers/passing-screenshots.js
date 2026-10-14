/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep unscored PNGs available for review without rendering them in ordinary runs. */
export async function capturePassingScreenshot(surface, options) {
	if (process.env.SCAPE_BROWSER_PASSING_SCREENSHOTS === '1') {
		await surface.screenshot(options);
	}
}
