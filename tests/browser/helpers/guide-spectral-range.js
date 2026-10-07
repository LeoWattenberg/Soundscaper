/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { chooseNestedCommandAction, commitInput } from '../audio-editor-test-helpers.js';

export async function runSpectralRange(page, editor, entry) {
	await chooseNestedCommandAction(page, editor, 'Effect', ['Spectral editing', 'Spectral box select']);
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await expect(dialog).toBeVisible();
	for (const [label, value] of [['Minimum frequency (Hz)', entry.minimum], ['Maximum frequency (Hz)', entry.maximum]]) {
		await commitInput(dialog.getByRole('textbox', { name: new RegExp(`^${label.replace(/[()]/gu, '\\$&')}`, 'u') }), String(value));
	}
	if (entry.operation === 'amplify') await commitInput(dialog.getByRole('textbox', { name: /^Gain \(dB\)/u }), String(entry.gain));
	const button = { select: 'Select range', delete: 'Spectral Delete', amplify: 'Spectral Amplify' }[entry.operation];
	await dialog.getByRole('button', { name: button, exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 30_000 });
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
}
