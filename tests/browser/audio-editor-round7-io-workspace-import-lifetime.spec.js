/* SPDX-License-Identifier: AGPL-3.0-only */

import { open } from 'node:fs/promises';
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, openNestedCommandMenu, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

for (const destination of ['timeline', 'project-bin']) for (const changed of [false, true]) test(`desktop ${destination} Import retains its original project with New project=${String(changed)}`, async ({ page }) => {
	const reading = Promise.withResolvers();
	let opens = 0;
	const native = await installNativeCaptionSidecar(page, monoTone.name,
		Uint8Array.from(monoTone.buffer), {
			async openSelectedFile(...args) {
				opens += 1;
				if (opens === 1) await reading.promise;
				return open(...args);
			},
		});
	try {
		const editor = await bootEditor(page, '/framescaper/en/');
		const choose = () => destination === 'timeline' ? chooseFileAction(page, editor, 'Import')
			: editor.locator('[data-workspace-panel="project-bin"] button').filter({ hasText: 'Add media' }).click();
		const originalId = await editor.getAttribute('data-project-id');
		await choose();
		await expect.poll(() => opens).toBe(1);
		if (changed) {
			await expect(editor.getByRole('button', { name: 'New project', exact: true })).toBeEnabled();
			await editor.getByRole('button', { name: 'New project', exact: true }).click();
			await expect(editor).not.toHaveAttribute('data-project-id', originalId);
			await waitForProjectActivation(editor);
			const menu = await openNestedCommandMenu(page, editor, 'File', []);
			await expect(menu.getByRole('menuitem', { name: /^Import(?:\s|$)/u })).toBeEnabled();
			await menu.press('Escape');
		}
		reading.resolve();
		await expect.poll(() => native.releases.length).toBe(1);
		const placed = destination === 'timeline' ? editor.locator('[data-clip-id]') : editor.locator('[data-project-bin-item]');
		if (!changed) await expect(placed).toHaveCount(1);
		// A completed positive import fences the observer beyond the pending
		// handoff, rather than accepting an initially empty replacement draft.
		await choose();
		await expect.poll(() => native.releases.length).toBe(2);
		await expect(placed).toHaveCount(changed ? 1 : 2);
		await expect(editor).toHaveAttribute('data-clip-count', destination === 'timeline' ? changed ? '1' : '2' : '0');
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(placed).toHaveCount(changed ? 0 : 1);
	} finally {
		reading.resolve();
		await native.close();
	}
});
