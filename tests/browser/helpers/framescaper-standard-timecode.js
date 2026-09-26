import { expect } from '@playwright/test';
import { chooseNestedCommandAction, closeWorkspacePanel } from '../audio-editor-test-helpers.js';

/** Set the German Framescaper sequence to NTSC through Project properties. */
export async function setFramescaperNtscSequenceRate(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Datei', ['Projektverwaltung', 'Metadaten']);
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Sequenz-Timing', exact: true }).click();
	const timing = panel.getByRole('tabpanel', { name: 'Sequenz-Timing', exact: true });
	await timing.getByRole('combobox', { name: 'Bildrate', exact: true }).selectOption('30000/1001');
	await expect(timing.locator('[data-sequence-rate]')).toHaveAttribute('data-sequence-rate', '30000/1001');
	await closeWorkspacePanel(editor, 'metadata');
}

/** Seek through the one standard transport time display in Framescaper. */
export async function seekFramescaperTimecode(page, editor, label) {
	const digits = label.replace(/\D/gu, '');
	expect(digits).toHaveLength(8);
	const display = editor.locator('[data-time-display] .timecode');
	await expect(display.locator('.timecode__format-button')).toBeVisible();
	await expect(display.locator('.timecode-digit')).toHaveCount(8);
	await display.locator('.timecode-digit').first().click();
	await page.keyboard.type(digits);
	await page.keyboard.press('Enter');
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', label);
}
