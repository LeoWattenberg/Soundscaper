import { expect } from '@playwright/test';

/** Seek through the one standard transport time display in Framescaper. */
export async function seekFramescaperTimecode(page, editor, label) {
	const digits = label.replace(/\D/gu, '');
	expect(digits).toHaveLength(8);
	const display = editor.locator('[data-time-display] .timecode');
	await expect(display.locator('.timecode__format-button')).toBeVisible();
	await expect(display.locator('.timecode-digit')).toHaveCount(8);
	await display.locator('.timecode-digit').first().click();
	await page.keyboard.type(digits);
	await page.keyboard.press('Enter');
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', label);
}
