/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

for (const product of ['soundscaper', 'framescaper']) {
	test(`${product} keeps track mute and solo beside ${product === 'soundscaper' ? 'pan and volume' : 'effects'}`, async ({ page }) => {
		const editor = await bootEditor(page, product === 'soundscaper' ? '/embed/en/' : '/framescaper/embed/en/');
		if (product === 'framescaper') {
			await editor.getByRole('button', { name: 'Add track', exact: true }).click();
			await page.getByRole('menuitem', { name: 'Audio track', exact: true }).click();
		}
		const track = editor.locator('.audio-editor-track-row').first();
		const controls = {
			pan: track.getByRole('group', { name: 'Pan', exact: true }),
			volume: track.getByRole('group', { name: 'Volume', exact: true }),
			mute: track.getByRole('button', { name: 'Mute', exact: true }),
			solo: track.getByRole('button', { name: 'Solo', exact: true }),
			effects: track.getByRole('button', { name: 'Effects', exact: true }),
		};
		const bounds = {};
		for (const [name, control] of Object.entries(controls)) {
			await expect(control).toBeVisible();
			bounds[name] = await control.boundingBox();
			expect(bounds[name]).not.toBeNull();
		}
		const center = (name) => bounds[name].y + bounds[name].height / 2;
		expect(Math.abs(center('pan') - center('volume'))).toBeLessThanOrEqual(2);
		const neighboringControl = product === 'soundscaper' ? 'volume' : 'effects';
		for (const name of ['mute', 'solo']) {
			expect(Math.abs(center(name) - center(neighboringControl))).toBeLessThanOrEqual(2);
			expect(bounds[name].x).toBeGreaterThanOrEqual(bounds[neighboringControl].x + bounds[neighboringControl].width);
			await controls[name].click();
			await expect(controls[name]).toHaveAttribute('aria-pressed', 'true');
		}
		expect(bounds.effects.y).toBeGreaterThanOrEqual(bounds.volume.y + bounds.volume.height);
	});
}
