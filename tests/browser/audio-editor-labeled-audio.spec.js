import {
	expect,
	test,
	toneA,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const LABELED_ROWS = [
	'Cut', 'Delete', 'Cut and leave gap', 'Delete and leave gap', 'Silence audio',
	'Copy', 'Split', 'Join', 'Detach at silences',
];

/** Drag a time selection across the ruler and label it, as Audacity's Ctrl+B does. */
async function labelTheSelection(page, editor) {
	const ruler = editor.locator('[data-ruler]');
	const rulerBox = await ruler.boundingBox();
	expect(rulerBox).not.toBeNull();
	await page.mouse.move(rulerBox.x + 24, rulerBox.y + 26);
	await page.mouse.down();
	await page.mouse.move(rulerBox.x + 96, rulerBox.y + 26, { steps: 4 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).toBeVisible();
	await page.keyboard.press('Control+b');
	await expect(editor.locator('[data-label-track] .audio-editor-label-marker')).toHaveCount(1);
}

/** The submenu's rows in Audacity's order, addressed by position rather than name. */
async function labeledRows(page, editor) {
	const submenu = await openNestedCommandMenu(page, editor, 'Edit', ['Labeled audio']);
	const items = submenu.getByRole('menuitem');
	await expect(items).toHaveCount(LABELED_ROWS.length);
	return items;
}

test.describe('labeled audio', () => {
	registerAudioEditorHooks();

	test('a labelled region splits the audio it covers from the Edit menu', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		await labelTheSelection(page, editor);

		const rows = await labeledRows(page, editor);
		for (const [index, row] of LABELED_ROWS.entries()) {
			await expect(rows.nth(index)).toContainText(row);
			await expect(rows.nth(index)).toBeEnabled();
		}
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');

		await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Split']);
		// Both label boundaries fall inside the clip, so it becomes three.
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		expect(errors).toEqual([]);
	});

	test('silencing a labelled region replaces exactly the audio it covers', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await labelTheSelection(page, editor);

		await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Silence audio']);

		// The clip either side of the label survives, and one silent clip fills
		// the label. The empty track beside it gains nothing: upstream silences
		// samples, and there are none there to silence.
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		expect(errors).toEqual([]);
	});

	test('cutting a labelled region closes the gap and fills the clipboard', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await labelTheSelection(page, editor);

		await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Cut']);

		await expect(editor).toHaveAttribute('data-clip-count', '2');
		const edit = await openNestedCommandMenu(page, editor, 'Edit', ['Paste']);
		await expect(edit.getByRole('menuitem').first()).toBeEnabled();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		expect(errors).toEqual([]);
	});

	test('the submenu stays inert until a whole label sits inside the selection', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const rows = await labeledRows(page, editor);
		for (const [index, row] of LABELED_ROWS.entries()) {
			await expect(rows.nth(index)).toContainText(row);
			await expect(rows.nth(index)).toHaveAttribute('aria-disabled', 'true');
		}
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		expect(errors).toEqual([]);
	});
});
