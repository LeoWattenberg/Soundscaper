import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { test } from './audio-editor-test-fixtures.js';
import { waitForEditor } from './audio-editor-test-helpers.js';

const { version: applicationVersion } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('Help About exposes version, credits, license and enabled modules with keyboard tabs', async ({ page }) => {
	await page.goto('/en/');
	const editor = await waitForEditor(page);
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: 'Help', exact: true }).click();
	await page.getByRole('menu', { name: 'Help', exact: true })
		.getByRole('menuitem', { name: 'About Soundscaper', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'About Soundscaper', exact: true });
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('[data-about-version]')).toContainText(applicationVersion);
	const about = dialog.getByRole('tab', { name: 'About', exact: true });
	await expect(about).toBeFocused();
	await expect(dialog.getByRole('tabpanel', { name: 'About', exact: true })).toContainText('local-first');
	await about.press('ArrowRight');
	await expect(dialog.getByRole('tab', { name: 'Contributors', exact: true })).toBeFocused();
	let panel = dialog.getByRole('tabpanel', { name: 'Contributors', exact: true });
	await expect(panel).toContainText('Leo Wattenberg');
	await expect(panel).toContainText('DilsonsPickles');
	await expect(panel).toContainText('Audacity');
	await dialog.getByRole('tab', { name: 'License', exact: true }).click();
	panel = dialog.getByRole('tabpanel', { name: 'License', exact: true });
	await expect(panel).toContainText('GNU Affero General Public License');
	await expect(panel.getByRole('link', { name: 'Third-party notices', exact: true })).toBeVisible();
	await panel.locator('summary').click();
	await expect(panel.locator('.kw-audio-editor-about__license-text'))
		.toContainText('Remote Network Interaction');
	await dialog.getByRole('tab', { name: 'License', exact: true }).press('End');
	await expect(dialog.getByRole('tab', { name: 'Enabled modules', exact: true })).toBeFocused();
	panel = dialog.getByRole('tabpanel', { name: 'Enabled modules', exact: true });
	await expect(panel.getByText('Audio recording', { exact: true })).toBeVisible();
	await expect(panel.getByText('Video effects', { exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
});
