/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, clipByName, importFiles, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('ordinary warped bin audition', () => {
	registerAudioEditorHooks();

	test('an authored warp can play after moving its recording to Project bin', async ({ page }) => {
		await page.addInitScript(() => {
			window.__binWarpAuditionStarts = [];
			const start = AudioBufferSourceNode.prototype.start;
			AudioBufferSourceNode.prototype.start = function (...args) {
				if (this.buffer && this.context instanceof AudioContext) {
					let peak = 0;
					for (const sample of this.buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
					window.__binWarpAuditionStarts.push({ peak, duration: this.buffer.duration });
				}
				return Reflect.apply(start, this, args);
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await clip.locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
		const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
		await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
		await warp.getByLabel('Outer position', { exact: true }).fill('12000');
		await warp.getByLabel('Source sample', { exact: true }).fill('18000');
		await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
		await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('18000/1');
		await warp.getByRole('button', { name: 'Close', exact: true }).click();
		await clip.locator('.clip-header').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		const card = editor.getByRole('listitem', { name: `Project bin: ${monoTone.name.replace(/\.wav$/u, '')}`, exact: true });
		await expect(card).toBeVisible();
		const before = await page.evaluate(() => window.__binWarpAuditionStarts.length);
		await card.getByRole('button', { name: /^Play:/u }).click();
		await expect.poll(() => page.evaluate(index => window.__binWarpAuditionStarts.slice(index)
			.some(start => start.peak > 0.1 && start.duration > 0.5), before)).toBe(true);
		await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
	});
});
