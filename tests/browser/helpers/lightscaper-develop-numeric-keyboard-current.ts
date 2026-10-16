/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, type Locator } from '@playwright/test';

export async function editLightscaperDevelopNumberCurrentV1(control: Locator, value: string | number): Promise<void> {
	// Bulk and rapid insertion omitted native input events in pinned Chromium;
	// give each character its own locator/focus round trip.
	await control.focus();
	await expect(control).toBeFocused();
	await control.press('ControlOrMeta+A');
	for (const character of String(value)) await control.press(character);
	await control.press('Enter');
}
