/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The guide steps that drive a workflow surface rather than a menu entry: the
 * Contrast analyzer's two measurements, a macro built and run in the Macro
 * manager, and play-at-speed from the transport. Each function drives one step
 * kind for `guide-runner.js`, which owns the shared state.
 */

import { expect } from '@playwright/test';

import { chooseCommandAction, closeDialog, commitInput } from '../audio-editor-test-helpers.js';

const RUN_TIMEOUT = 30_000;

/** Measure the selection as foreground or background and wait for the panel to report it. */
export async function runContrast(state, entry) {
	const panel = state.editor.locator('[data-workspace-panel="contrast"]');
	await expect(panel).toBeVisible();
	const button = entry.role === 'foreground' ? 'Measure foreground' : 'Measure background';
	await panel.getByRole('button', { name: button, exact: true }).click();
	await expect(state.editor.locator('[data-status]')).toContainText(`Stored contrast ${entry.role}.`, { timeout: RUN_TIMEOUT });
	if (entry.role === 'foreground') {
		const report = panel.locator('[data-analysis-report="contrast"]');
		await expect(report).toBeVisible({ timeout: RUN_TIMEOUT });
		await expect(report).toContainText('Difference');
	}
}

/**
 * Build a macro from the named effects and run it. The effect picker is the
 * rack's flyout, which can remount the dialog, so the manager is located afresh
 * after every choice rather than held.
 */
export async function runMacro(page, state, entry) {
	const { editor } = state;
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = () => page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await expect(manager()).toBeVisible();
	await manager().getByRole('region', { name: 'Macros', exact: true }).getByRole('button', { name: 'New macro', exact: true }).click();
	await commitInput(manager().getByLabel('Macro name', { exact: true }), entry.name);
	await expect(manager().locator('[data-macro-id]').filter({ hasText: entry.name })).toHaveCount(1);
	for (const name of entry.effects) {
		await manager().locator('[data-macro-steps] [data-macro-add-effect]').click();
		await page.getByRole('menu', { name: 'Choose an effect' }).getByRole('menuitem', { name, exact: true }).click();
		await expect(manager().locator('[data-macro-effect-stack]').getByRole('group', { name, exact: true })).toBeVisible();
	}
	await manager().getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager().getByRole('status')).toHaveText('Macro applied.', { timeout: RUN_TIMEOUT });
	await closeDialog(manager());
}

/** Set the playback speed from the transport's play options, play at it, then pause. */
export async function runPlayAtSpeed(page, state, entry) {
	const { editor } = state;
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	const control = editor.locator('[data-play-at-speed]');
	await expect(control).toBeVisible();
	await control.getByRole('slider', { name: 'Playback speed', exact: true }).fill(String(entry.rate));
	await expect(control.locator('output')).toHaveText(new RegExp(`^${String(entry.rate)}0*×$`, 'u'));
	await page.keyboard.press('Escape');
	await expect(control).toBeHidden();
	await editor.getByRole('button', { name: 'Play at speed', exact: true }).click();
	const pause = editor.getByRole('button', { name: 'Pause play at speed', exact: true });
	await expect(pause).toBeVisible({ timeout: RUN_TIMEOUT });
	await pause.click();
}
