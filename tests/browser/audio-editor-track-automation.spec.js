/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	chooseNestedCommandAction,
	importFiles,
	registerAudioEditorHooks,
	setDocumentTheme,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test.describe('Soundscaper inline track automation', () => {
	registerAudioEditorHooks();

	test('opts in per track, edits over clips, and yields every hit to clip gain', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		const row = clip.locator('xpath=ancestor::div[@data-track-row]');

		await expect(row.locator('[data-track-automation-controls]')).toHaveCount(0);
		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		const controls = row.locator('[data-track-automation-controls]');
		await expect(controls).toBeVisible();
		await expect(controls.getByRole('combobox', { name: 'Automation parameter' })).toHaveValue(/gain/u);

		const overlay = row.locator('[data-track-automation-overlay]');
		await expect(overlay).toBeVisible();
		const curveHit = overlay.locator('[data-automation-insert-point]').first();
		await curveHit.focus();
		await page.keyboard.press('i');
		await expect(overlay.locator('[data-automation-point-id]')).not.toHaveCount(0);
		await openFirstSegmentMenu(curveHit);
		const curveMenu = overlay.getByRole('menu', { name: 'Automation curve', exact: true });
		await curveMenu.getByRole('menuitemradio', { name: 'Bézier', exact: true }).click();
		await expect(overlay.locator('[data-automation-bezier-control]')).toHaveCount(2);
		await openFirstSegmentMenu(curveHit);
		await curveMenu.getByRole('menuitem', { name: 'Delete automation lane', exact: true }).click();
		await expect(overlay.locator('[data-automation-point-id]')).toHaveCount(0);
		await curveHit.focus();
		await page.keyboard.press('Enter');
		await expect(overlay.locator('[data-automation-point-id]')).not.toHaveCount(0);
		const themedCurve = overlay.locator('.audio-editor-track-automation-curve').first();
		await setDocumentTheme(page, 'light');
		const lightStroke = await themedCurve.evaluate((element) => getComputedStyle(element).stroke);
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await setDocumentTheme(page, 'dark');
		const darkStroke = await themedCurve.evaluate((element) => getComputedStyle(element).stroke);
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		expect(lightStroke).not.toBe('none');
		expect(darkStroke).not.toBe('none');

		const mode = controls.getByRole('combobox', { name: 'Automation mode' });
		await mode.selectOption('touch');
		await expect(mode).toHaveValue('touch');

		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		const history = editor.locator('[data-workspace-panel="history"]');
		await expect(history).toBeVisible();
		const historyBeforeControlGesture = await history.locator('[data-history-list] > li').count();
		const volume = row.getByRole('slider', { name: 'Volume', exact: true });
		const staticVolume = await volume.inputValue();
		const curveBeforeControlGesture = await themedCurve.getAttribute('d');
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await volume.focus();
		await page.keyboard.press('ArrowDown');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(history.locator('[data-history-list] > li'))
			.toHaveCount(historyBeforeControlGesture + 1);
		await expect(volume).toHaveValue(staticVolume);
		await expect(themedCurve).not.toHaveAttribute('d', curveBeforeControlGesture);

		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		await expect(controls).toHaveCount(0);
		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		await expect(controls.getByRole('combobox', { name: 'Automation mode' })).toHaveValue('read');

		await clip.locator('.clip-header').click();
		await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
		await expect(overlay).toHaveAttribute('data-clip-gain-precedence', 'true');
		const coexistenceCurve = overlay.locator('.audio-editor-track-automation-curve');
		await expect(coexistenceCurve).toHaveCount(1);
		const coexistenceStyle = await coexistenceCurve.evaluate((element) => ({
			stroke: getComputedStyle(element).stroke,
			opacity: getComputedStyle(element.ownerSVGElement).opacity,
		}));
		expect(coexistenceStyle.stroke).not.toBe('none');
		expect(Number(coexistenceStyle.opacity)).toBeGreaterThan(0);
		await expect(overlay.locator('[data-automation-insert-point]')).toHaveCount(0);
		await expect(overlay.locator('[data-track-automation-interactive]')).toHaveCount(0);

		expect(clientErrors).toEqual([]);
	});

	test('persists a pointer-edited lane while keeping its controls session-only', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		let row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');

		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		let overlay = row.locator('[data-track-automation-overlay]');
		const curveHit = overlay.locator('[data-automation-insert-point]').first();
		await expect(curveHit).toHaveAttribute('data-track-automation-interactive', 'true');
		const flatCurve = await overlay.locator('.audio-editor-track-automation-curve').first()
			.getAttribute('d');
		await dragAutomationCurvePoint(page, curveHit);

		let points = overlay.locator('[data-automation-point-id]');
		await expect(points).toHaveCount(2);
		const editedPointIds = await points.evaluateAll((elements) => (
			elements.map((element) => element.getAttribute('data-automation-point-id'))
		));
		const editedCurve = await overlay.locator('.audio-editor-track-automation-curve').first()
			.getAttribute('d');
		expect(editedCurve).not.toBe(flatCurve);

		await clickHistory(editor, 'Undo');
		await expect(points).toHaveCount(0);
		await expect(overlay.locator('.audio-editor-track-automation-curve').first())
			.toHaveAttribute('d', flatCurve);
		await clickHistory(editor, 'Redo');
		await expect(points).toHaveCount(2);
		await expect(overlay.locator('.audio-editor-track-automation-curve').first())
			.toHaveAttribute('d', editedCurve);

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
		await expect(row.locator('[data-track-automation-controls]')).toHaveCount(0);
		await expect(row.locator('[data-track-automation-overlay]')).toHaveCount(0);

		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		overlay = row.locator('[data-track-automation-overlay]');
		points = overlay.locator('[data-automation-point-id]');
		await expect(points).toHaveCount(2);
		expect(await points.evaluateAll((elements) => (
			elements.map((element) => element.getAttribute('data-automation-point-id'))
		))).toEqual(editedPointIds);
		await expect(overlay.locator('.audio-editor-track-automation-curve').first())
			.toHaveAttribute('d', editedCurve);

		expect(clientErrors).toEqual([]);
	});
});

async function clickHistory(editor, label) {
	const button = editor.getByRole('button', { name: label, exact: true });
	await expect(button).toBeEnabled();
	await button.click();
}

async function dragAutomationCurvePoint(page, curve) {
	const start = await curve.evaluate((element) => {
		const point = element.getPointAtLength(element.getTotalLength() * 0.6);
		const matrix = element.getScreenCTM();
		if (!matrix) return null;
		const clientPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
		return { x: clientPoint.x, y: clientPoint.y };
	});
	expect(start).not.toBeNull();
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 18, start.y - 18, { steps: 4 });
	await page.mouse.up();
}

async function openFirstSegmentMenu(curve) {
	await curve.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		element.dispatchEvent(new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			button: 2,
			clientX: bounds.left + bounds.width * 0.25,
			clientY: bounds.top + bounds.height * 0.5,
		}));
	});
}
