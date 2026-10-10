/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('ordinary stereo Pan finishes when primary releases while middle stays held', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'supported-pan-recording.wav', frequency: 440, duration: 0.25, channelCount: 2 })]);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const channel = editor.locator('.kw-audio-editor__mixer-channel--track').filter({ hasText: 'supported-pan-recording' });
	const pan = channel.getByRole('slider', { name: /^Pan(?:$|:)/u });
	await expect(pan).toBeEnabled();
	await expect(pan).toHaveAttribute('aria-valuenow', '0');
	const move = async () => {
		const dial = await pan.boundingBox();
		expect(dial).not.toBeNull();
		const x = dial.x + dial.width / 2, y = dial.y + dial.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 24, y, { steps: 4 });
		return { x, y };
	};
	await move();
	await page.mouse.up();
	const healthy = Number(await pan.getAttribute('aria-valuenow'));
	expect(healthy).toBeGreaterThan(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(pan).toHaveAttribute('aria-valuenow', '0');
	const { x, y } = await move();
	await expect(pan).toHaveAttribute('aria-valuenow', String(healthy));
	await page.evaluate(() => {
		document.addEventListener('pointermove', function released(event) {
			if (event.pointerType !== 'mouse' || event.button !== 0 || event.buttons !== 4) return;
			document.documentElement.dataset.panReleasedButton = String(event.button);
			document.documentElement.dataset.panHeldButtons = String(event.buttons);
			document.removeEventListener('pointermove', released, true);
		}, true);
	});
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await expect(page.locator('html')).toHaveAttribute('data-pan-released-button', '0');
	await expect(page.locator('html')).toHaveAttribute('data-pan-held-buttons', '4');
	await page.mouse.move(x + 60, y, { steps: 4 });
	await page.mouse.up({ button: 'middle' });
	await expect(pan).toHaveAttribute('aria-valuenow', String(healthy));
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(pan).toHaveAttribute('aria-valuenow', '0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(pan).toHaveAttribute('aria-valuenow', String(healthy));
	expect(errors).toEqual([]);
});
