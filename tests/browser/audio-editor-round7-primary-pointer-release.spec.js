/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('a clip move completes when primary releases while an auxiliary button remains held', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const id = await clip.getAttribute('data-clip-id');
	const projectId = await editor.getAttribute('data-project-id');
	const position = async () => (await persistedProject(page, projectId)).clips.find(item => item.id === id)?.timelineStartFrame;
	const drag = async auxiliary => {
		const box = await clip.locator('.clip-header').boundingBox();
		expect(box).not.toBeNull();
		const x = box.x + 30, y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 24, y, { steps: 4 });
		if (auxiliary) await page.mouse.down({ button: 'middle' });
		await page.mouse.up();
		if (auxiliary) {
			await page.mouse.move(x + 48, y, { steps: 4 });
			await page.mouse.up({ button: 'middle' });
		}
	};
	await drag(false);
	await expect.poll(position).toBeGreaterThan(0);
	const completed = await position();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(position).toBe(0);
	await drag(true);
	await expect.poll(position).toBe(completed);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(position).toBe(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(position).toBe(completed);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
