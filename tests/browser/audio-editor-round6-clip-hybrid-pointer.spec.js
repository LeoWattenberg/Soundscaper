/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('a timeline clip retains its first pen move through a mouse tap', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native pen and mouse input uses the Chromium protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const id = await clip.getAttribute('data-clip-id');
	const projectId = await editor.getAttribute('data-project-id');
	const position = async () => (await persistedProject(page, projectId)).clips.find(item => item.id === id).timelineStartFrame;
	const firstBox = await clip.locator('.clip-header').boundingBox();
	expect(firstBox).not.toBeNull();
	const first = { x: firstBox.x + 30, y: firstBox.y + firstBox.height / 2 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(first.x + 36, first.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(position).toBeGreaterThan(0);
	const completed = await position();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(position).toBe(0);
	const native = await page.context().newCDPSession(page);
	const pen = { button: 'left', pointerType: 'pen' };
	await native.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...first, ...pen, buttons: 1, clickCount: 1 });
	await native.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: first.x + 36, y: first.y, ...pen, buttons: 1 });
	await native.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: first.x + 36, y: first.y, ...pen, buttons: 0, clickCount: 1 });
	await expect.poll(position).toBe(completed);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(position).toBe(0);
	await native.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...first, ...pen, buttons: 1, clickCount: 1 });
	await native.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: first.x + 10, y: first.y, ...pen, buttons: 1 });
	const middle = await clip.locator('.clip-header').boundingBox();
	expect(middle).not.toBeNull();
	await page.mouse.click(middle.x + 30, first.y);
	await native.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: first.x + 36, y: first.y, ...pen, buttons: 1 });
	await native.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: first.x + 36, y: first.y, ...pen, buttons: 0, clickCount: 1 });
	await expect.poll(position).toBe(completed);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(position).toBe(0);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(position).toBe(completed);
});
