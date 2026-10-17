/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect } from '@playwright/test';
import { chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

export async function openClipProperties(page, editor, clip, { additional = true } = {}) {
	if (clip) await selectInspectorClip(clip);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Clip properties']);
	const panel = editor.locator('[data-workspace-panel="clip-properties"]');
	await expect(panel).toBeVisible();
	await expect(panel.locator('[data-upstream-clip-properties]')).toBeVisible();
	// Exact-clock workflows opt into TimeCode presentation on the same fields.
	// Tests of the default upstream presentation pass additional: false.
	if (additional && await panel.locator('[data-clip-audio-settings]').count()) await showClipTimingFields(panel);
	return panel;
}

export async function showClipTimingFields(panel) {
	const settings = panel.locator('[data-clip-audio-settings]');
	if (await settings.count()) {
		if (await panel.locator('[data-clip-field="startFrame"]').count()) return;
		await settings.click();
		await panel.page().getByRole('menuitemcheckbox', { name: 'Timecode fields', exact: true }).click();
		await expect(panel.locator('[data-clip-field="startFrame"]')).toBeVisible();
		return;
	}
	// Native video/image/generator inspectors retain their media drawer.
	const summary = panel.locator('summary').filter({ hasText: 'Media settings' });
	if (await summary.locator('..').getAttribute('open') === null) await summary.click();
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
