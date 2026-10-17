/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect } from '@playwright/test';
import { chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

export async function openClipProperties(page, editor, clip, { additional = true } = {}) {
	if (clip) await selectInspectorClip(clip);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Clip properties']);
	const panel = editor.locator('[data-workspace-panel="clip-properties"]');
	await expect(panel).toBeVisible();
	await expect(panel.locator('[data-upstream-clip-properties]')).toBeVisible();
	if (additional) {
		const summary = panel.locator('summary').filter({ hasText: 'Additional properties' });
		if (await summary.count() && await summary.locator('..').getAttribute('open') === null) await summary.click();
	}
	return panel;
}

export async function openSourceMonitor(page, editor, clip) {
	if (clip) await selectInspectorClip(clip);
	const panel = editor.locator('[data-workspace-panel="source-monitor"]');
	if (!await panel.isVisible()) await chooseCommandAction(page, editor, 'Window', 'Source monitor');
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('region', { name: 'Source waveform', exact: true })).toBeVisible();
	return panel;
}

async function selectInspectorClip(clip) {
	// Enter on an already selected clip now seeks to its start.
	await clip.focus();
	if (!await clip.locator('.clip-display--selected').count()) await clip.press('Enter');
}
