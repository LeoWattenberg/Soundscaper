/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	clipField,
	closeClipProperties,
	collectClientErrors,
	commitInput,
	dockWorkspacePanel,
	importFiles,
	openClipProperties,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

const PANEL_ID = 'clip-properties';
const FIRST_TITLE = toneA.name.replace(/\.[^.]+$/u, '');
const SECOND_TITLE = toneB.name.replace(/\.[^.]+$/u, '');
const EMPTY_SELECTION = 'Select a clip to edit its start, length, fades, and gain precisely.';

async function selectClip(clip) {
	await clip.focus();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
}

test.describe('live dockable Clip properties', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1_440, height: 1_000 } });

	test('stays hidden until opened and follows selection, deselection, deletion and undo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const first = clipByName(editor, toneA.name);
		const second = clipByName(editor, toneB.name);
		const panel = editor.locator(`[data-workspace-panel="${PANEL_ID}"]`);
		await expect(panel).toHaveCount(0);
		await selectClip(first);
		await expect(panel).toHaveCount(0);
		await openClipProperties(page, editor);
		const contentBounds = await panel.locator(`[data-workspace-tab-panel="${PANEL_ID}"]`).boundingBox();
		const bodyBounds = await panel.locator('[data-clip-properties-panel]').boundingBox();
		expect(bodyBounds.x).toBeGreaterThanOrEqual(contentBounds.x);
		expect(bodyBounds.x + bodyBounds.width).toBeLessThanOrEqual(contentBounds.x + contentBounds.width);
		await expect(clipField(panel, 'name')).toHaveValue(FIRST_TITLE);
		await expect(panel.getByRole('tab')).toHaveCount(0);
		await selectClip(second);
		await expect(clipField(panel, 'name')).toHaveValue(SECOND_TITLE);
		await expect(second).toBeFocused();
		await commitInput(clipField(panel, 'gain'), '-3');
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await expect(panel.getByText(EMPTY_SELECTION, { exact: true })).toBeVisible();
		await expect(clipField(panel, 'name')).toHaveCount(0);
		await selectClip(first);
		await expect(clipField(panel, 'gain')).toHaveValue('0.00');
		await selectClip(second);
		await expect(clipField(panel, 'gain')).toHaveValue('-3.00');
		await editor.getByRole('region', { name: 'Timeline', exact: true }).first().press('Delete');
		await expect(second).toHaveCount(0);
		await expect(panel).toBeVisible();
		await expect(panel.getByText(EMPTY_SELECTION, { exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(second).toBeVisible();
		await selectClip(second);
		await expect(clipField(panel, 'gain')).toHaveValue('-3.00');
		expect(errors).toEqual([]);
	});

	test('edits the active clip tab and navigates tabs without changing the selected clips', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const first = clipByName(editor, toneA.name);
		const second = clipByName(editor, toneB.name);
		await first.locator('.clip-header').click();
		await second.locator('.clip-header').click({ modifiers: ['Shift'] });
		const panel = await openClipProperties(page, editor);
		const firstTab = panel.getByRole('tab', { name: FIRST_TITLE, exact: true });
		const secondTab = panel.getByRole('tab', { name: SECOND_TITLE, exact: true });
		await expect(panel.getByRole('tab')).toHaveCount(2);
		await first.click({ button: 'right', position: { x: 32, y: 10 } });
		await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Clip properties', exact: true }).click();
		await expect(panel.getByRole('tab')).toHaveCount(2);
		await expect(firstTab).toHaveAttribute('aria-selected', 'true');
		await expect(clipField(panel, 'name')).toBeFocused();
		await expect(first.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		await expect(second.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		await firstTab.click();
		await expect(firstTab).toHaveAttribute('aria-selected', 'true');
		await commitInput(clipField(panel, 'gain'), '-3');
		const inverted = panel.locator('[data-clip-field="inverted"]').getByRole('checkbox');
		await inverted.click();
		await expect(inverted).toHaveAttribute('aria-checked', 'true');
		await firstTab.focus();
		await firstTab.press('ArrowRight');
		await expect(secondTab).toBeFocused();
		await expect(secondTab).toHaveAttribute('aria-selected', 'true');
		await expect(clipField(panel, 'name')).toHaveValue(SECOND_TITLE);
		await expect(clipField(panel, 'gain')).toHaveValue('0.00');
		await expect(inverted).toHaveAttribute('aria-checked', 'false');
		await commitInput(clipField(panel, 'gain'), '-9');
		await secondTab.focus();
		await secondTab.press('Home');
		await expect(firstTab).toBeFocused();
		await expect(clipField(panel, 'gain')).toHaveValue('-3.00');
		await expect(inverted).toHaveAttribute('aria-checked', 'true');
		await firstTab.press('End');
		await expect(secondTab).toBeFocused();
		await expect(clipField(panel, 'gain')).toHaveValue('-9.00');
		await secondTab.press('ArrowLeft');
		await expect(firstTab).toBeFocused();
		await expect(clipField(panel, 'name')).toHaveValue(FIRST_TITLE);
		await expect(first.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		await expect(second.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		await first.locator('.clip-header').click({ modifiers: ['Control'] });
		await expect(panel.getByRole('tab')).toHaveCount(0);
		await expect(clipField(panel, 'name')).toHaveValue(SECOND_TITLE);
		await expect(clipField(panel, 'gain')).toHaveValue('-9.00');
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await expect(panel.getByRole('tab')).toHaveCount(0);
		await expect(panel.getByText(EMPTY_SELECTION, { exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('opens from View and the clip menu, docks, resizes and restores its visibility', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = editor.locator(`[data-workspace-panel="${PANEL_ID}"]`);
		await expect(panel).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Clip properties']);
		await expect(panel).toBeVisible();
		await expect(panel.getByText(EMPTY_SELECTION, { exact: true })).toBeVisible();
		await importFiles(editor, [toneA]);
		for (const dock of ['left', 'top', 'bottom', 'floating']) {
			await dockWorkspacePanel(editor, PANEL_ID, dock);
		}
		const resize = panel.locator(`[data-floating-panel-resize-handle="${PANEL_ID}"]`);
		const width = Number(await panel.getAttribute('data-workspace-panel-width'));
		await resize.press('Shift+ArrowRight');
		await expect(panel).toHaveAttribute('data-workspace-panel-width', String(width + 48));
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restoredEditor = await waitForEditor(page);
		const restored = restoredEditor.locator(`[data-panel-dock="floating"] [data-workspace-panel="${PANEL_ID}"]`);
		await expect(restored).toBeVisible();
		await expect(restored).toHaveAttribute('data-workspace-panel-width', String(width + 48));
		await closeClipProperties(restored);
		await page.reload();
		const closedEditor = await waitForEditor(page);
		await expect(closedEditor.locator(`[data-workspace-panel="${PANEL_ID}"]`)).toHaveCount(0);
		const clip = clipByName(closedEditor, toneA.name);
		await clip.click({ button: 'right', position: { x: 32, y: 10 } });
		await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Clip properties', exact: true }).click();
		await expect(closedEditor.locator(`[data-workspace-panel="${PANEL_ID}"]`)).toBeVisible();
		await expect(clipField(closedEditor.locator(`[data-workspace-panel="${PANEL_ID}"]`), 'name')).toHaveValue(FIRST_TITLE);
		expect(errors).toEqual([]);
	});
});
