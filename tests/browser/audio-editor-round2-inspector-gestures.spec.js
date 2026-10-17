/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';

async function prepareSourceFade(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const monitor = await openSourceMonitor(page, editor, clip);
	const owner = monitor.getByRole('region', { name: 'Source waveform', exact: true });
	const fade = owner.getByRole('slider', { name: 'Fade in', exact: true });
	await fade.press('Home');
	for (let step = 0; step < 2; step++) await fade.press('ArrowRight');
	const previousLength = await fade.getAttribute('aria-valuenow');
	await fade.press('ArrowRight');
	const shape = owner.getByRole('slider', { name: 'Fade in shape', exact: true });
	await expect(shape).toHaveAttribute('aria-valuenow', '2');
	return { editor, clip, owner, fade, previousLength, shape };
}

async function beginShapeDrag(page, owner, shape) {
	await owner.hover();
	const bounds = await shape.boundingBox();
	expect(bounds).not.toBeNull();
	const x = bounds.x + bounds.width / 2;
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + 24, { steps: 12 });
}

test('one Undo restores a complete Source monitor fade-shape drag', async ({ page }) => {
	const { editor, owner, shape } = await prepareSourceFade(page);
	const original = await shape.getAttribute('aria-valuenow');
	await beginShapeDrag(page, owner, shape);
	await expect(shape).not.toHaveAttribute('aria-valuenow', original);
	const preview = await shape.getAttribute('aria-valuenow');
	await page.mouse.up();
	await expect(shape).toHaveAttribute('aria-valuenow', preview);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(shape).toHaveAttribute('aria-valuenow', original);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(shape).toHaveAttribute('aria-valuenow', preview);
});

test('Escape cancels a Source monitor fade-shape drag before mouse release', async ({ page }) => {
	const { editor, clip, owner, fade, previousLength, shape } = await prepareSourceFade(page);
	const original = await shape.getAttribute('aria-valuenow');
	await beginShapeDrag(page, owner, shape);
	await expect(shape).not.toHaveAttribute('aria-valuenow', original);
	await page.keyboard.press('Escape');
	await expect(shape).toHaveAttribute('aria-valuenow', original);
	await page.mouse.up();
	await expect(shape).toHaveAttribute('aria-valuenow', original);
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(fade).toHaveAttribute('aria-valuenow', previousLength);
	await expect(shape).toHaveAttribute('aria-valuenow', original);
});
