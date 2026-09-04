/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('Soundscaper sound-activated recording', () => {
	registerAudioEditorHooks();

	test('supports pointer, keyboard, persistence, and forced-colors workflows', async ({ page, browserName }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		const recordOptions = editor.getByRole('button', { name: 'Record options', exact: true });

		await recordOptions.click();
		let recordMenu = page.getByRole('menu', { name: 'Record options', exact: true });
		const toggle = recordMenu.getByRole('menuitem', { name: 'Sound-activated recording', exact: true });
		const openSettings = recordMenu.getByRole('menuitem', { name: 'Set activation level', exact: true });
		await expect(toggle).toBeEnabled();
		await expect(openSettings).toBeEnabled();
		await toggle.click();

		await recordOptions.click();
		recordMenu = page.getByRole('menu', { name: 'Record options', exact: true });
		await expect(recordMenu.getByRole('menuitem', { name: 'Sound-activated recording', exact: true })).toBeEnabled();
		await recordMenu.getByRole('menuitem', { name: 'Set activation level', exact: true }).focus();
		await page.keyboard.press('Enter');

		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const panel = preferences.locator('[data-sound-activation-preferences]');
		const enabled = panel.getByRole('switch', { name: 'Sound-activated recording', exact: true });
		const threshold = panel.getByRole('slider', { name: 'Activation threshold', exact: true });
		const hysteresis = panel.getByRole('slider', { name: 'Release hysteresis', exact: true });
		const hold = panel.locator('[data-sound-activation-hold] input');
		await expect(panel).toBeVisible();
		await expect(threshold).toBeFocused();
		await expect(enabled).toBeChecked();
		await expect(panel.locator('.kw-audio-editor-sound-activation__status')).toHaveText('Sound-activated recording is on.');

		await enabled.focus();
		await page.keyboard.press('Space');
		await expectCommittedPreference(panel, 'data-sound-activation-enabled', 'false');
		await expect(enabled).not.toBeChecked();
		await enabled.focus();
		await page.keyboard.press('Space');
		await expectCommittedPreference(panel, 'data-sound-activation-enabled', 'true');
		await expect(enabled).toBeChecked();

		await threshold.focus();
		await page.keyboard.press('ArrowRight');
		await expectCommittedPreference(panel, 'data-sound-activation-threshold-db', '-39');
		await expect(threshold).toHaveValue('-39');
		await hysteresis.focus();
		await page.keyboard.press('ArrowRight');
		await expectCommittedPreference(panel, 'data-sound-activation-hysteresis-db', '7');
		await expect(hysteresis).toHaveValue('7');
		await hold.fill('260');
		await hold.blur();
		await expectCommittedPreference(panel, 'data-sound-activation-hold-milliseconds', '260');
		await expect(hold).toHaveValue('260');

		const thresholdBounds = await threshold.boundingBox();
		expect(thresholdBounds).not.toBeNull();
		await page.mouse.click(
			thresholdBounds.x + thresholdBounds.width * 0.75,
			thresholdBounds.y + thresholdBounds.height / 2,
		);
		await expect.poll(async () => Number(await threshold.inputValue())).toBeGreaterThan(-39);
		const requestedThreshold = await threshold.inputValue();
		await expectCommittedPreference(panel, 'data-sound-activation-threshold-db', requestedThreshold);
		// WebKit commits a pointer-adjusted range's final change on the next
		// keyboard interaction. Advance once through that public control path so
		// the value asserted after reload is the browser's final committed value.
		await threshold.focus();
		await page.keyboard.press('ArrowLeft');
		await expect.poll(async () => threshold.inputValue()).not.toBe(requestedThreshold);
		const persistedThreshold = await threshold.inputValue();
		await expectCommittedPreference(panel, 'data-sound-activation-threshold-db', persistedThreshold);

		await assertNoSeriousAxeViolations(page, '[data-sound-activation-preferences]');
		if (browserName === 'chromium') {
			await page.emulateMedia({ forcedColors: 'active' });
			await expect(panel).toHaveCSS('forced-color-adjust', 'none');
			await expect(panel).toHaveCSS('border-top-width', '1px');
			await page.emulateMedia({ forcedColors: 'none' });
		}

		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await page.reload();
		editor = await waitForEditor(page);
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('menu', { name: 'Record options', exact: true })
			.getByRole('menuitem', { name: 'Set activation level', exact: true })
			.click();
		const restoredPanel = page.getByRole('dialog', { name: 'Editor preferences', exact: true })
			.locator('[data-sound-activation-preferences]');
		await expect(restoredPanel.getByRole('switch', { name: 'Sound-activated recording', exact: true })).toBeChecked();
		await expect(restoredPanel.getByRole('slider', { name: 'Activation threshold', exact: true })).toHaveValue(persistedThreshold);
		await expect(restoredPanel.getByRole('slider', { name: 'Release hysteresis', exact: true })).toHaveValue('7');
		await expect(restoredPanel.locator('[data-sound-activation-hold] input')).toHaveValue('260');
		expect(errors).toEqual([]);
	});

	test('keeps Soundscaper-only controls and commands out of Framescaper', async ({ page }) => {
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await expect(editor.getByRole('button', { name: 'Record options', exact: true })).toHaveCount(0);

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Playback\/Recording$/u }).click();
		await expect(preferences.locator('[data-sound-activation-preferences]')).toHaveCount(0);
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		await preferences.getByRole('searchbox').fill('sound activation');
		await expect(preferences.getByText(/Sound-activated recording|Sound activation level/u)).toHaveCount(0);
	});
});

async function expectCommittedPreference(panel, attribute, value) {
	await expect(panel).toHaveAttribute(attribute, value);
	await expect(panel).toHaveAttribute('data-sound-activation-pending', 'false');
}
