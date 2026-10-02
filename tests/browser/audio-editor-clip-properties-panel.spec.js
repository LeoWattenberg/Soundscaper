/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
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

async function savedClipPanelPreferences(page) {
	return page.evaluate(({ databaseName, panelId }) => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const request = database.transaction('settings', 'readonly').objectStore('settings')
				.get('soundscaper:audio-editor-preferences-v1');
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => {
				const panel = request.result?.value?.workspace?.panels?.[panelId] ?? null;
				database.close();
				resolve(panel);
			};
		};
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, panelId: PANEL_ID });
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
		await expect(editor.locator('[data-panel-dock="bottom"] [data-workspace-panel="clip-properties"]')).toBeVisible();
		await expect(panel.locator('[data-clip-properties-drawer][open]')).toHaveCount(0);
		const contentBounds = await panel.locator(`[data-workspace-tab-panel="${PANEL_ID}"]`).boundingBox();
		const bodyBounds = await panel.locator('[data-clip-properties-panel]').boundingBox();
		expect(bodyBounds.x).toBeGreaterThanOrEqual(contentBounds.x);
		expect(bodyBounds.x + bodyBounds.width).toBeLessThanOrEqual(contentBounds.x + contentBounds.width);
		await expect(clipField(panel, 'name')).toHaveValue(FIRST_TITLE);
		await expect(panel.getByRole('tab')).toHaveCount(0);
		await selectClip(second);
		await expect(clipField(panel, 'name')).toHaveValue(SECOND_TITLE);
		await expect(second).toBeFocused();
		await panel.getByText('Fading', { exact: true }).click();
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
		await expect(panel.locator('[data-clip-properties-active-clip]')).toBeFocused();
		await expect(first.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		await expect(second.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		await firstTab.click();
		await expect(firstTab).toHaveAttribute('aria-selected', 'true');
		await panel.getByText('Fading', { exact: true }).click();
		await commitInput(clipField(panel, 'gain'), '-3');
		await panel.getByText('Media settings', { exact: true }).click();
		const inverted = panel.locator('[data-clip-field="inverted"]').getByRole('checkbox');
		await inverted.click();
		await expect(inverted).toHaveAttribute('aria-checked', 'true');
		await firstTab.focus();
		await firstTab.press('ArrowRight');
		await expect(secondTab).toBeFocused();
		await expect(secondTab).toHaveAttribute('aria-selected', 'true');
		await expect(clipField(panel, 'name')).toHaveValue(SECOND_TITLE);
		await expect(clipField(panel, 'gain')).toHaveValue('0.00');
		await panel.getByText('Media settings', { exact: true }).click();
		await expect(inverted).toHaveAttribute('aria-checked', 'false');
		await panel.getByText('Fading', { exact: true }).click();
		await commitInput(clipField(panel, 'gain'), '-9');
		await secondTab.focus();
		await secondTab.press('Home');
		await expect(firstTab).toBeFocused();
		await expect(clipField(panel, 'gain')).toHaveValue('-3.00');
		await panel.getByText('Media settings', { exact: true }).click();
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

	test('drawers expand vertically at the bottom and pitch knobs retain numeric entry', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
		const sourceBounds = await panel.locator('[data-clip-source-editor]').boundingBox();
		const contentBounds = await panel.locator('[data-workspace-tab-panel="clip-properties"]').boundingBox();
		expect(sourceBounds.y + sourceBounds.height).toBeGreaterThanOrEqual(contentBounds.y + contentBounds.height - 12);
		const pitchDrawer = panel.locator('[data-clip-properties-drawer="pitch"]');
		await expect(pitchDrawer).not.toHaveAttribute('open');
		await pitchDrawer.getByText('Pitch and tempo', { exact: true }).click();
		await expect(pitchDrawer).toHaveAttribute('open', '');
		await expect(pitchDrawer.locator('summary')).toHaveCSS('writing-mode', 'vertical-rl');
		const semitones = pitchDrawer.getByRole('button', { name: 'Semitones (half-steps)', exact: true });
		const percent = pitchDrawer.getByRole('button', { name: 'Percent change', exact: true });
		await expect(semitones).toHaveAttribute('aria-pressed', 'true');
		await percent.click();
		await expect(percent).toHaveAttribute('aria-pressed', 'true');
		await expect(semitones).toHaveAttribute('aria-pressed', 'false');
		await commitInput(clipField(panel, 'pitchCents'), '100');
		await semitones.click();
		await expect(clipField(panel, 'pitchCents')).toHaveValue('12.00');
		const knob = panel.locator('[data-clip-knob="pitchCents"]').getByRole('slider');
		await knob.focus();
		await knob.press('ArrowLeft');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('11.99');
		await dockWorkspacePanel(editor, PANEL_ID, 'right');
		await panel.getByText('Pitch and tempo', { exact: true }).click();
		await expect(panel.locator('[data-clip-properties-drawer="pitch"] summary')).toHaveCSS('writing-mode', 'horizontal-tb');
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
		await expect.poll(async () => (await savedClipPanelPreferences(page))?.width).toBe(width + 48);
		await page.reload();
		const restoredEditor = await waitForEditor(page);
		const restored = restoredEditor.locator(`[data-panel-dock="floating"] [data-workspace-panel="${PANEL_ID}"]`);
		await expect(restored).toBeVisible();
		await expect(restored).toHaveAttribute('data-workspace-panel-width', String(width + 48));
		await closeClipProperties(restored);
		await expect.poll(async () => (await savedClipPanelPreferences(page))?.visible).toBe(false);
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
