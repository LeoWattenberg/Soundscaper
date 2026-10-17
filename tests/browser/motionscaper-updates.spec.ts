/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './helpers/browser-coverage-fixture.js';

test('browser Help keeps native update checks absent', async ({ page }) => {
	await page.goto('/embed/en/'); await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: 'Check for Updates', exact: true })).toHaveCount(0);
});

test('desktop Help dispatches a localized manual update check without creating a project', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'scapeDesktop', { value: { v1: { getEnvironment: () => Promise.resolve({ locale: 'de' }), motionUpdates: { check: async () => {
			const count = Number(document.documentElement.dataset.motionUpdateChecks ?? 0); document.documentElement.dataset.motionUpdateChecks = String(count + 1);
			throw new Error('Native dialog unavailable');
		} } } } });
	});
	await page.goto('/embed/de/'); await expect(page.locator('html')).not.toHaveAttribute('data-motion-update-checks');
	await page.getByRole('menuitem', { name: 'Hilfe', exact: true }).click(); await page.getByRole('menuitem', { name: 'Nach Updates suchen', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-motion-update-checks', '1');
	await expect(page.getByRole('alert')).toContainText('Motionscaper-Updates konnten nicht geprüft werden');
	await expect(page.locator('[data-motion-workspace]')).toHaveCount(0);
	await page.getByRole('menuitem', { name: 'Hilfe', exact: true }).click(); await page.getByRole('menuitem', { name: 'Nach Updates suchen', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-motion-update-checks', '2');
});
