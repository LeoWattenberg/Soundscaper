/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites[2]!.origin });
test('Motion AE menu downloads separate readable calibration and profile-selected export entries with complete closure', async ({ page }) => {
	await page.goto('/embed/en/'); await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: 'After Effects Bridge', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true });
	await expect(dialog).toContainText('reviewed style profile for your exact AE version, build and language');
	const downloaded = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download Bridge Scripts', exact: true }).click();
	const archive = await downloaded, reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await readFile((await archive.path())!))])));
	try {
		const entries = await reader.getEntries(), names = new Set(entries.map(entry => entry.filename));
		for (const name of ['Motionscaper-Prepare-Shape-Profile.jsx', 'Motionscaper-Capture-Shape-Profile.jsx', 'Motionscaper-Export-Shapes.jsx']) expect(names.has(name)).toBe(true);
		for (const entry of entries) {
			if (entry.directory || !/\.jsx(?:inc)?$/u.test(entry.filename)) continue;
			const text = await entry.getData!(new TextWriter());
			for (const match of text.matchAll(/^#include "([A-Za-z0-9.-]+)"$/gmu)) expect(names.has(match[1]!)).toBe(true);
			if (entry.filename === 'Motionscaper-Export.jsx') expect(text).toContain('runMotionAeInstalledExport();');
			if (entry.filename === 'Motionscaper-Export-Shapes.jsx') expect(text).toContain('runMotionAeInstalledExport(false, false, true);');
		}
	} finally { await reader.close(); }
	await expect(page.locator('[data-motion-project-title]')).toHaveCount(0);
});
