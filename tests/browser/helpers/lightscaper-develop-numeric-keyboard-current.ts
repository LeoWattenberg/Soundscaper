/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, type Locator } from '@playwright/test';

export async function editLightscaperDevelopNumberCurrentV1(control: Locator, value: string | number,
	settle?: () => Promise<void>, finalKey: 'Enter' | 'Escape' = 'Enter'): Promise<void> {
	// Bulk and rapid insertion omitted native input events in pinned Chromium;
	// give each character its own locator/focus round trip.
	if (settle) await settle();
	await control.page().bringToFront();
	await control.click();
	await expect(control).toBeFocused();
	if (settle) await settle();
	await control.press('ControlOrMeta+A');
	if (settle) await settle();
	await control.press('Backspace');
	// Observe replacement before typing so a discarded shortcut cannot pass silently.
	await expect(control).toHaveValue('');
	const badInput = await control.evaluate(element => {
		if (!(element instanceof HTMLInputElement)) throw new TypeError('The numeric keyboard helper requires an input.');
		return element.validity.badInput;
	});
	expect(badInput).toBe(false);
	if (settle) await settle();
	for (const character of String(value)) {
		await control.press(character);
		if (settle) await settle();
	}
	await control.press(finalKey);
	if (settle) await settle();
}
