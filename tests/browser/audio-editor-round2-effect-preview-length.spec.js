/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, importFiles } from './audio-editor-test-helpers.js';

test('a slowed Change Tempo preview plays the complete short selection', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round2PreviewDurations = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer) window.__round2PreviewDurations.push(this.buffer.duration);
			return Reflect.apply(start, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Change tempo']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(dialog.getByRole('group', { name: /^Percent change/u }).getByRole('spinbutton'), '-50');
	await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round2PreviewDurations.at(-1))).toBeCloseTo(1.6, 2);
});
