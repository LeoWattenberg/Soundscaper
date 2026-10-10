/* SPDX-License-Identifier: AGPL-3.0-only */

import { open } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

const LUT = ['TITLE "Identity"', 'LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0',
	'0 0 1', '1 0 1', '0 1 1', '1 1 1', ''].join('\n');

for (const closed of [false, true]) test(`pending native LUT read ${closed ? 'is cancelled by Close' : 'publishes to the open finishing target'}`, async ({ page }) => {
	let resume;
	const reading = new Promise(resolve => { resume = resolve; });
	let started = false;
	const native = await installNativeCaptionSidecar(page, 'identity.cube', LUT, {
		async openSelectedFile(...args) { started = true; await reading; return open(...args); },
	});
	try {
		const editor = await bootEditor(page, '/framescaper/en/');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
		const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
		await expect(clip).toHaveCount(1);
		await clip.focus(); await clip.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
		const inspector = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
		await inspector.getByRole('spinbutton', { name: 'Opacity', exact: true }).fill('0.5');
		await inspector.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(inspector.getByRole('status').last()).toHaveText('Selected visual updated.');
		await inspector.getByRole('button', { name: 'Close', exact: true }).click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Grading & Finishing Presets']);
		let dialog = page.getByRole('dialog', { name: 'Grading & Finishing Presets', exact: true });
		await expect(dialog.getByRole('combobox', { name: 'Cube LUT target', exact: true })).toHaveValue(/^presentation:/u);
		await dialog.getByRole('button', { name: 'Choose .cube LUT', exact: true }).click();
		await expect.poll(() => started).toBe(true);
		await expect(dialog.getByRole('button', { name: 'Choose .cube LUT', exact: true })).toBeDisabled();
		if (closed) await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		resume();
		// The native lease encloses the complete LUT consumer and its history
		// publication, so its release positively fences the canonical observer.
		await expect.poll(() => native.releases.length).toBe(1);
		if (!closed) await expect(dialog.getByRole('status')).toHaveText(/^Presentation .+: [0-9a-f]{12}$/u);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		if (closed) {
			await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Grading & Finishing Presets']);
			dialog = page.getByRole('dialog', { name: 'Grading & Finishing Presets', exact: true });
		}
		const saved = JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue());
		expect(saved.videoVisualPresentations).toHaveLength(1);
		expect(saved.videoVisualPresentations[0].opacity).toBe(0.5);
		expect(saved.videoVisualPresentations[0].grade?.lut != null).toBe(!closed);
	} finally { resume(); await native.close(); }
});
