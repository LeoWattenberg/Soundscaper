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
	openSourceMonitor,
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
		const first = clipByName(editor, toneA.name), second = clipByName(editor, toneB.name);
		const panel = editor.locator(`[data-workspace-panel="${PANEL_ID}"]`);
		await expect(panel).toHaveCount(0);
		await selectClip(first);
		await expect(panel).toHaveCount(0);
		await openClipProperties(page, editor, undefined, { additional: false });
		const name = panel.getByRole('textbox', { name: 'Clip name', exact: true });
		await expect(name).toHaveValue(FIRST_TITLE);
		await expect(panel.locator('[data-clip-properties-drawer]')).toHaveCount(0);
		await selectClip(second);
		await expect(name).toHaveValue(SECOND_TITLE);
		await expect(second).toBeFocused();
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await expect(panel.getByText(EMPTY_SELECTION, { exact: true })).toBeVisible();
		await expect(name).toHaveCount(0);
		await selectClip(second);
		await editor.getByRole('region', { name: 'Timeline', exact: true }).first().press('Delete');
		await expect(second).toHaveCount(0);
		await expect(panel.getByText(EMPTY_SELECTION, { exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(second).toBeVisible();
		await selectClip(second);
		await expect(name).toHaveValue(SECOND_TITLE);
		expect(errors).toEqual([]);
	});

	test('Source monitor navigates individual source tabs without changing the selected clips', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const first = clipByName(editor, toneA.name), second = clipByName(editor, toneB.name);
		await first.locator('.clip-header').click();
		await second.locator('.clip-header').click({ modifiers: ['Shift'] });
		const panel = await openSourceMonitor(page, editor);
		const firstTab = panel.getByRole('tab', { name: FIRST_TITLE, exact: true });
		const secondTab = panel.getByRole('tab', { name: SECOND_TITLE, exact: true });
		await expect(panel.getByRole('tab')).toHaveCount(2);
		await firstTab.click();
		await firstTab.press('ArrowRight');
		await expect(secondTab).toBeFocused();
		await expect(secondTab).toHaveAttribute('aria-selected', 'true');
		await secondTab.press('Home');
		await expect(firstTab).toBeFocused();
		await expect(first.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		await expect(second.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		await expect(panel.locator('details')).toHaveCount(0);
	});

	test('additional properties retain pitch units, native knobs and normalization', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
		const pitchDrawer = panel.locator('[data-clip-properties-drawer="pitch"]');
		await pitchDrawer.getByText('Pitch and tempo', { exact: true }).click();
		await pitchDrawer.getByRole('button', { name: 'Percent change', exact: true }).click();
		await commitInput(clipField(panel, 'pitchCents'), '100');
		await pitchDrawer.getByRole('button', { name: 'Semitones (half-steps)', exact: true }).click();
		await expect(clipField(panel, 'pitchCents')).toHaveValue('12.00');
		await pitchDrawer.locator('[data-clip-knob="pitchCents"]').getByRole('slider').press('ArrowLeft');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('11.99');
		await pitchDrawer.getByText('Pitch and tempo', { exact: true }).click();
		await panel.getByText('Normalize', { exact: true }).click();
		await expect(panel.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('opens from View and the clip menu, docks, resizes and restores its visibility', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = editor.locator(`[data-workspace-panel="${PANEL_ID}"]`);
		await expect(panel).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'Window', ['Clip properties']);
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
		await expect(closedEditor.locator(`[data-workspace-panel="${PANEL_ID}"]`).getByRole('textbox', { name: 'Clip name', exact: true })).toHaveValue(FIRST_TITLE);
		expect(errors).toEqual([]);
	});
});
