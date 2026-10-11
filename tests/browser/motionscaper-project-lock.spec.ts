/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, label: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: label, exact: true }).click();
}
test('M02 competing Motion windows retain one recovery owner and release its product-isolated lock on close', async ({ page, context }) => {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByRole('dialog').getByLabel('Project title', { exact: true }).fill('Owned project');
	await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Owned project');
	await menu(page, 'View', 'Composition Settings');
	await page.getByRole('dialog').getByLabel('Project title', { exact: true }).fill('Retained recovery');
	await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(page.locator('[data-motion-save-status]')).toContainText('Unsaved');
	const locks = await page.evaluate(async () => (await navigator.locks.query()).held?.map(lock => lock.name) ?? []);
	expect(locks.filter(name => name?.startsWith('kw-media-motionscaper-editor-v1-lock:'))).toHaveLength(1);
	expect(locks.some(name => name?.startsWith('kw-media-audio-editor-lock:'))).toBe(false);
	const peer = await context.newPage(); await peer.goto('/embed/en/'); await menu(peer, 'File', 'Project Library');
	await peer.getByRole('button', { name: 'Recover unsaved changes', exact: true }).click();
	await expect(peer.getByRole('alert')).toBeVisible(); await expect(peer.locator('[data-motion-project-title]')).toHaveCount(0);
	await page.close();
	await peer.getByRole('button', { name: 'Recover unsaved changes', exact: true }).click();
	await expect(peer.locator('[data-motion-project-title]')).toHaveText('Retained recovery');
	await menu(peer, 'File', 'Save'); await expect(peer.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await peer.reload(); await menu(peer, 'File', 'Project Library');
	await peer.getByRole('button', { name: 'Retained recovery', exact: true }).click();
	await expect(peer.locator('[data-motion-project-title]')).toHaveText('Retained recovery');
});
