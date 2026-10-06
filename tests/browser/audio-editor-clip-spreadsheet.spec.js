/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, collectClientErrors, dockWorkspacePanel, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

const firstName = toneA.name.replace(/\.[^.]+$/u, '');
const secondName = toneB.name.replace(/\.[^.]+$/u, '');
const cell = (grid, row, column) => grid.getByRole('gridcell')
	.and(grid.locator(`[data-row="${row}"][data-column="${column}"]`));

async function openSpreadsheet(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	return editor.locator('[data-workspace-panel="clip-spreadsheet"]');
}

async function editCell(grid, row, column, label, value) {
	await cell(grid, row, column).dblclick();
	const input = grid.getByLabel(label, { exact: true });
	await input.fill(value);
	await input.press('Enter');
}

async function pasteText(page, text) {
	if (page.context().browser().browserType().name() !== 'chromium') {
		await clipboardEvent(page, 'paste', text);
		return;
	}
	await page.evaluate((value) => navigator.clipboard.writeText(value), text);
	await page.keyboard.press('ControlOrMeta+v');
}

async function copiedText(page) {
	if (page.context().browser().browserType().name() !== 'chromium') {
		return clipboardEvent(page, 'copy');
	}
	await page.keyboard.press('ControlOrMeta+c');
	return page.evaluate(() => navigator.clipboard.readText());
}

// Firefox and WebKit do not expose OS clipboard permissions through Playwright.
// Exercise their DOM clipboard events; Chromium retains the native keyboard path.
async function clipboardEvent(page, type, text = '') {
	return page.evaluate(({ eventType, value }) => {
		const event = new ClipboardEvent(eventType, {
			bubbles: true, cancelable: true, clipboardData: new DataTransfer(),
		});
		// Firefox creates its own transfer instead of retaining the constructor input.
		event.clipboardData.setData('text/plain', value);
		document.activeElement.dispatchEvent(event);
		return event.clipboardData.getData('text/plain');
	}, { eventType: type, value: text });
}

async function clearSelection(page, grid) {
	await page.keyboard.press('Escape');
	await expect(grid.getByRole('gridcell').and(grid.locator('[aria-selected="true"]'))).toHaveCount(0);
	await expect(grid).toBeFocused();
}

function referencedFilesDialog(page) {
	return page.getByRole('dialog', { name: 'Clip spreadsheet', exact: true });
}

test.describe('clip spreadsheet', () => {
	test.beforeEach(async ({ browserName, context }) => {
		if (browserName === 'chromium') {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		}
	});

	test('opens from Window for an empty project and closes through panel controls', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-workspace-panel="clip-spreadsheet"]')).toHaveCount(0);
		const panel = await openSpreadsheet(page, editor);
		const surface = panel.locator('[data-clip-spreadsheet]');
		await expect(surface.getByRole('grid')).toBeVisible();
		await expect(surface.locator('p')).toHaveCount(0);
		await expect(surface.locator('button:not(table button)')).toHaveCount(0);
		await expect(surface.locator('tfoot')).toHaveCount(0);
		await expect(surface.getByRole('columnheader')).toHaveCount(14);
		await expect(surface.getByRole('button', { name: 'Sample rate (Hz)', exact: true })).toHaveCount(0);
		await expect(surface.getByRole('button', { name: 'Channels', exact: true })).toHaveCount(0);
		await closeWorkspacePanel(editor, 'clip-spreadsheet');
		await expect(panel).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('shows every clip and edits properties in place with undo and redo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 1, 'name')).toHaveText(secondName);
		await expect(grid.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
		const source = project.sources.find(({ name }) => name === toneA.name);
		await expect(cell(grid, 0, 'source')).toHaveText(source.id);
		await expect(cell(grid, 0, 'source')).toHaveAttribute('aria-readonly', 'false');
		await editCell(grid, 0, 'name', 'Name', 'Spreadsheet edit');
		await expect(cell(grid, 0, 'name')).toHaveText('Spreadsheet edit');
		await editCell(grid, 0, 'position', 'Position (s)', '1.25');
		await expect.poll(async () => Number(await cell(grid, 0, 'position').textContent())).toBe(1.25);
		await cell(grid, 0, 'gain').click();
		await page.keyboard.press('Enter');
		const gain = grid.getByLabel('Gain (dB)', { exact: true });
		await gain.fill('-6');
		await gain.press('Enter');
		await expect.poll(async () => Number(await cell(grid, 0, 'gain').textContent())).toBeCloseTo(-6);
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(async () => Number(await cell(grid, 0, 'gain').textContent())).toBe(0);
		await page.keyboard.press('ControlOrMeta+Shift+z');
		await expect.poll(async () => Number(await cell(grid, 0, 'gain').textContent())).toBeCloseTo(-6);
		await closeWorkspacePanel(editor, 'clip-spreadsheet');
		await expect(panel).toBeHidden();
		await openSpreadsheet(page, editor);
		await expect(panel.getByRole('grid')).toBeFocused();
		await expect(cell(panel.getByRole('grid'), 0, 'name')).toHaveText('Spreadsheet edit');
		expect(errors).toEqual([]);
	});

	test('moves clips using track IDs and replaces sources using IDs or disk references', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const projectId = await editor.getAttribute('data-project-id');
		const project = await persistedProject(page, projectId);
		const clipId = project.clips.find(({ title }) => title === firstName).id;
		const originalTrackId = await cell(grid, 0, 'track').textContent();
		const targetTrackId = await cell(grid, 1, 'track').textContent();
		const originalSourceId = await cell(grid, 0, 'source').textContent();
		const targetSourceId = await cell(grid, 1, 'source').textContent();
		await expect(cell(grid, 0, 'track')).toHaveAttribute('aria-readonly', 'false');
		await expect(editor.locator(`[data-track-row][data-track-id="${originalTrackId}"] [data-clip-id="${clipId}"]`)).toBeVisible();
		await editCell(grid, 0, 'track', 'Track', targetTrackId);
		await expect(cell(grid, 0, 'track')).toHaveText(targetTrackId);
		await expect(editor.locator(`[data-track-row][data-track-id="${targetTrackId}"] [data-clip-id="${clipId}"]`)).toBeVisible();
		await expect(editor.locator(`[data-track-row][data-track-id="${originalTrackId}"] [data-clip-id="${clipId}"]`)).toHaveCount(0);
		await page.keyboard.press('ControlOrMeta+z');
		await expect(cell(grid, 0, 'track')).toHaveText(originalTrackId);

		await editCell(grid, 0, 'source', 'Source file', targetSourceId);
		await expect(cell(grid, 0, 'source')).toHaveText(targetSourceId);
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await page.keyboard.press('ControlOrMeta+z');
		await expect(cell(grid, 0, 'source')).toHaveText(originalSourceId);

		const reference = `/recordings/${toneB.name}`;
		await editCell(grid, 0, 'source', 'Source file', reference);
		const dialog = referencedFilesDialog(page);
		await expect(dialog.getByText(reference, { exact: true })).toBeVisible();
		await expect(cell(grid, 0, 'source')).toHaveText(originalSourceId);
		const choose = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
		await (await choose).setFiles(toneB);
		await expect(dialog).toHaveCount(0);
		await expect(cell(grid, 0, 'source')).not.toHaveText(originalSourceId);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const updated = await persistedProject(page, projectId);
		const replacementId = updated.clips.find(({ id }) => id === clipId).sourceId;
		await expect(cell(grid, 0, 'source')).toHaveText(replacementId);
		expect(updated.sources.find(({ id }) => id === replacementId).name).toBe(toneB.name);
		await expect(cell(grid, 0, 'source')).toBeFocused();
		await page.keyboard.press('r');
		const sourceInput = grid.getByLabel('Source file', { exact: true });
		await expect(sourceInput).toHaveValue('r');
		await sourceInput.press('Escape');
		await expect(cell(grid, 0, 'source')).toHaveText(replacementId);
		await page.keyboard.press('ControlOrMeta+z');
		await expect(cell(grid, 0, 'source')).toHaveText(originalSourceId);
		expect(errors).toEqual([]);
	});

	test('shows boolean cells as checkboxes and copies and pastes their text values', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		const reversed = cell(grid, 0, 'reversed').getByRole('checkbox');
		const inverted = cell(grid, 0, 'inverted').getByRole('checkbox');
		await expect(reversed).not.toBeChecked();
		await expect(inverted).not.toBeChecked();
		await expect(cell(grid, 0, 'reversed')).toHaveText('');
		await expect(cell(grid, 0, 'inverted')).toHaveText('');
		await reversed.check();
		await cell(grid, 0, 'reversed').click({ position: { x: 5, y: 5 } });
		expect(await copiedText(page)).toBe('true');
		await pasteText(page, 'false');
		await expect(reversed).not.toBeChecked();
		await page.keyboard.press('ControlOrMeta+z');
		await expect(reversed).toBeChecked();
		await cell(grid, 0, 'reversed').click({ position: { x: 5, y: 5 } });
		await cell(grid, 1, 'inverted').click({ position: { x: 5, y: 5 }, modifiers: ['Shift'] });
		await pasteText(page, 'true\tfalse\nfalse\ttrue');
		await expect(reversed).toBeChecked();
		await expect(inverted).not.toBeChecked();
		await expect(cell(grid, 1, 'reversed').getByRole('checkbox')).not.toBeChecked();
		await expect(cell(grid, 1, 'inverted').getByRole('checkbox')).toBeChecked();
		expect(await copiedText(page)).toBe('true\tfalse\r\nfalse\ttrue');
		expect(errors).toEqual([]);
	});

	test('docks, floats, resizes and restores its saved panel placement', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		await expect(editor.locator('[data-panel-dock="bottom"] [data-workspace-panel="clip-spreadsheet"]')).toBeVisible();
		await dockWorkspacePanel(editor, 'clip-spreadsheet', 'right');
		await dockWorkspacePanel(editor, 'clip-spreadsheet', 'floating');
		const width = Number(await panel.getAttribute('data-workspace-panel-width'));
		await panel.locator('[data-floating-panel-resize-handle="clip-spreadsheet"]').press('Shift+ArrowLeft');
		await expect(panel).toHaveAttribute('data-workspace-panel-width', String(width - 48));
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restoredEditor = await waitForEditor(page);
		const restored = restoredEditor.locator('[data-panel-dock="floating"] [data-workspace-panel="clip-spreadsheet"]');
		await expect(restored).toBeVisible();
		await expect(restored).toHaveAttribute('data-workspace-panel-width', String(width - 48));
		await expect(cell(restored.getByRole('grid'), 0, 'name')).toHaveText(firstName);
		expect(errors).toEqual([]);
	});

	test('cancels drafts, keeps typed characters and commits each edit as one undo step', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		const name = cell(grid, 0, 'name');
		await name.click();
		await page.keyboard.press('r');
		const input = grid.getByLabel('Name', { exact: true });
		await expect(input).toHaveValue('r');
		await input.pressSequentially('ename');
		await expect(input).toHaveValue('rename');
		await input.press('Escape');
		await expect(name).toHaveText(firstName);
		await expect(panel).toBeVisible();

		await editCell(grid, 0, 'name', 'Name', 'Committed with Enter');
		await expect(name).toHaveText('Committed with Enter');
		await page.keyboard.press('ControlOrMeta+z');
		await expect(name).toHaveText(firstName);

		await name.dblclick();
		await input.fill('Committed by leaving the cell');
		await cell(grid, 0, 'gain').click();
		await expect(name).toHaveText('Committed by leaving the cell');
		await page.keyboard.press('ControlOrMeta+z');
		await expect(name).toHaveText(firstName);
		await name.dblclick();
		await input.fill('Committed with Tab');
		await input.press('Tab');
		await expect(name).toHaveText('Committed with Tab');
		await page.keyboard.press('ControlOrMeta+z');
		await expect(name).toHaveText(firstName);
		await name.click();
		await page.keyboard.press('Shift+Tab');
		await expect(name).not.toBeFocused();
		await expect(panel).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('discards an active draft when pasting a row requiring a source import', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		const originalSourceId = await cell(grid, 0, 'source').textContent();
		await grid.getByRole('button', { name: 'Select row 1', exact: true }).click();
		const row = (await copiedText(page)).split('\t');
		row[0] = 'Pasted while editing';
		row[3] = `/recordings/${toneB.name}`;
		await cell(grid, 0, 'name').dblclick();
		await grid.getByLabel('Name', { exact: true }).fill('Discard this draft');
		await pasteText(page, row.join('\t'));
		const dialog = referencedFilesDialog(page);
		await expect(dialog).toBeVisible();
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		const choose = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
		await (await choose).setFiles(toneB);
		await expect(cell(grid, 0, 'name')).toHaveText('Pasted while editing');
		await expect(cell(grid, 0, 'source')).not.toHaveText(originalSourceId);
		await page.keyboard.press('ControlOrMeta+z');
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 0, 'source')).toHaveText(originalSourceId);
		await page.keyboard.press('ControlOrMeta+z');
		await expect(cell(grid, 0, 'name')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('copies and pastes cells, rectangular ranges, columns and full rows as spreadsheet text', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await cell(grid, 0, 'name').click();
		expect(await copiedText(page)).toBe(firstName);
		await pasteText(page, 'Renamed in a spreadsheet');
		await expect(cell(grid, 0, 'name')).toHaveText('Renamed in a spreadsheet');

		await cell(grid, 0, 'pitch').click();
		await cell(grid, 1, 'speed').click({ modifiers: ['Shift'] });
		await pasteText(page, '2\t1.5\r\n-3\t0.75\r\n');
		await expect.poll(async () => Number(await cell(grid, 0, 'pitch').textContent())).toBe(2);
		await expect.poll(async () => Number(await cell(grid, 1, 'pitch').textContent())).toBe(-3);
		await expect.poll(async () => Number(await cell(grid, 0, 'speed').textContent())).toBe(1.5);
		await expect.poll(async () => Number(await cell(grid, 1, 'speed').textContent())).toBe(0.75);
		expect((await copiedText(page)).trim().split(/\r?\n/u).map((row) => row.split('\t').map(Number)))
			.toEqual([[2, 1.5], [-3, 0.75]]);
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(async () => Number(await cell(grid, 0, 'pitch').textContent())).toBe(0);
		await expect.poll(async () => Number(await cell(grid, 1, 'speed').textContent())).toBe(1);

		await grid.getByRole('button', { name: 'Name', exact: true }).click();
		expect((await copiedText(page)).trim().split(/\r?\n/u)).toEqual(['Renamed in a spreadsheet', secondName]);
		await pasteText(page, 'First spreadsheet row\nSecond spreadsheet row');
		await expect(cell(grid, 0, 'name')).toHaveText('First spreadsheet row');
		await expect(cell(grid, 1, 'name')).toHaveText('Second spreadsheet row');

		await grid.getByRole('button', { name: 'Select row 1', exact: true }).click();
		await expect(cell(grid, 0, 'name')).toBeInViewport();
		const rowText = await copiedText(page);
		expect(rowText).toContain(await cell(grid, 0, 'source').textContent());
		expect(rowText.split('\t').length).toBe(13);
		await pasteText(page, rowText.replace('First spreadsheet row', 'Full row round trip'));
		await expect(cell(grid, 0, 'name')).toHaveText('Full row round trip');
		expect(errors).toEqual([]);
	});

	test('rejects a whole invalid paste without changing valid cells in the same range', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await grid.getByRole('button', { name: 'Speed (×)', exact: true }).click();
		await pasteText(page, '1.5\n0');
		await expect(page.getByRole('alert')).toBeVisible();
		await expect.poll(async () => Number(await cell(grid, 0, 'speed').textContent())).toBe(1);
		await expect.poll(async () => Number(await cell(grid, 1, 'speed').textContent())).toBe(1);
		expect(errors).toEqual([]);
	});

	test('pastes new rows without a selection and restores them with keyboard history', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		const trackId = await cell(grid, 0, 'track').textContent();
		const sourceId = await cell(grid, 0, 'source').textContent();
		const row = ['New clip', trackId, '2', sourceId, '0.05', '0.1', '3', '1.5', '-6', '0.01', '0.02', 'true', 'false'];
		await expect(grid).toBeFocused();
		await pasteText(page, row.join('\t'));
		await expect(cell(grid, 1, 'name')).toHaveText('New clip');
		await expect(cell(grid, 1, 'track')).toHaveText(trackId);
		await expect(cell(grid, 1, 'position')).toHaveText('2');
		await expect(cell(grid, 1, 'offset')).toHaveText('0.05');
		await expect(cell(grid, 1, 'duration')).toHaveText('0.1');
		await expect(cell(grid, 1, 'pitch')).toHaveText('3');
		await expect(cell(grid, 1, 'speed')).toHaveText('1.5');
		await expect(cell(grid, 1, 'gain')).toHaveText('-6');
		await expect(cell(grid, 1, 'reversed').getByRole('checkbox')).toBeChecked();
		await expect(cell(grid, 1, 'inverted').getByRole('checkbox')).not.toBeChecked();
		await page.keyboard.press('ControlOrMeta+z');
		await expect(cell(grid, 1, 'name')).toHaveCount(0);
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await page.keyboard.press('ControlOrMeta+Shift+z');
		await expect(cell(grid, 1, 'name')).toHaveText('New clip');
		await dockWorkspacePanel(editor, 'clip-spreadsheet', 'right');
		await cell(grid, 0, 'name').click();
		const scroll = panel.locator('.audio-editor-clip-spreadsheet__scroll');
		const bounds = await scroll.boundingBox();
		const gridBounds = await grid.boundingBox();
		expect(bounds.width).toBeLessThanOrEqual((await panel.boundingBox()).width);
		expect(bounds.height).toBeGreaterThan(gridBounds.height + 48);
		await scroll.click({ position: { x: 60, y: gridBounds.y + gridBounds.height - bounds.y + 24 } });
		await expect(grid.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);
		await expect(grid).toBeFocused();
		await expect(panel).toBeVisible();
		row[0] = 'Another clip';
		row[2] = '4';
		await pasteText(page, row.join('\t'));
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 1, 'name')).toHaveText('New clip');
		await expect(cell(grid, 2, 'name')).toHaveText('Another clip');
		expect(errors).toEqual([]);
	});

	test('loads a missing disk source for pasted rows in an empty project and rejects invalid media bounds atomically', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		const row = ['From disk', 'Imported row', '3', `/recordings/${toneA.name}`, '0.05', '0.1', '-2', '2'];
		await expect(grid).toBeFocused();
		await pasteText(page, row.join('\t'));
		const dialog = referencedFilesDialog(page);
		await expect(dialog.getByText(`/recordings/${toneA.name}`, { exact: true })).toBeVisible();
		const choose = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
		await (await choose).setFiles(toneA);
		await expect(cell(grid, 0, 'name')).toHaveText('From disk');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
		await expect(cell(grid, 0, 'source')).toHaveText(project.sources.find(({ name }) => name === toneA.name).id);
		await expect(cell(grid, 0, 'position')).toHaveText('3');
		await expect(cell(grid, 0, 'pitch')).toHaveText('-2');
		await page.keyboard.press('ControlOrMeta+z');
		await expect(cell(grid, 0, 'name')).toHaveCount(0);
		row[5] = '999';
		await expect(grid).toBeFocused();
		await pasteText(page, row.join('\t'));
		const invalidChoose = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
		await (await invalidChoose).setFiles(toneA);
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(cell(grid, 0, 'name')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('rejects a selected paste extending beyond the existing rows atomically', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await grid.getByRole('button', { name: 'Select row 1', exact: true }).click();
		const original = await copiedText(page);
		const first = original.split('\t');
		first[0] = 'Updated row';
		const second = [...first];
		second[0] = 'Added row';
		second[2] = '2';
		await pasteText(page, `${first.join('\t')}\n${second.join('\t')}`);
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 1, 'name')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('keeps missing-source pastes pending after a mismatched file and allows cancellation', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await expect(grid).toBeFocused();
		await pasteText(page, ['Pending', 'New track', '0', toneA.name].join('\t'));
		const dialog = referencedFilesDialog(page);
		const choose = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
		await (await choose).setFiles(toneB);
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(panel.getByRole('gridcell')).toHaveCount(0);
		await dialog.getByRole('button', { name: 'Cancel paste', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(page.getByRole('alert')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('paste appends safely when clipboard reading is unavailable', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await grid.getByRole('button', { name: 'Select row 1', exact: true }).click();
		const row = (await copiedText(page)).split('\t');
		row[0] = 'Keyboard append';
		row[2] = '2';
		await page.evaluate(() => {
			Object.defineProperty(navigator.clipboard, 'readText', { configurable: true,
				value: () => Promise.reject(new DOMException('Clipboard permission denied', 'NotAllowedError')) });
		});
		await clearSelection(page, grid);
		await pasteText(page, row.join('\t'));
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 1, 'name')).toHaveText('Keyboard append');
		row[0] = 'Second keyboard append';
		row[2] = '4';
		await expect(grid).toHaveAttribute('aria-busy', 'false');
		await expect(grid).toHaveAttribute('aria-readonly', 'false');
		await expect(grid).toBeFocused();
		await pasteText(page, row.join('\t'));
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 1, 'name')).toHaveText('Keyboard append');
		await expect(cell(grid, 2, 'name')).toHaveText('Second keyboard append');
		expect(errors).toEqual([]);
	});
});
