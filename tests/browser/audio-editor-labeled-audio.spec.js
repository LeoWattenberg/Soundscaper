import {
	expect,
	test,
	toneA,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	collectClientErrors,
	getMenuItem,
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

test.describe('labeled audio', () => {
	registerAudioEditorHooks();

	test('a labelled region splits the audio it covers from the Edit menu', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		await labelTheSelection(page, editor);

		const labeled = await openNestedCommandMenu(page, editor, 'Edit', ['Labeled audio']);
		for (const row of LABELED_ROWS) await expect(getMenuItem(labeled, row)).toBeEnabled();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');

		await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Split']);
		// Both label boundaries fall inside the clip, so it becomes three.
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		expect(errors).toEqual([]);
	});

	test('the submenu stays inert until a whole label sits inside the selection', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const edit = await openNestedCommandMenu(page, editor, 'Edit', []);
		const submenu = getMenuItem(edit, 'Labeled audio');
		await expect(submenu).toBeVisible();
		await submenu.press('ArrowRight');
		for (const row of LABELED_ROWS) {
			await expect(submenu.getByRole('menu').getByRole('menuitem', { name: row, exact: true }))
				.toHaveAttribute('aria-disabled', 'true');
		}
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		expect(errors).toEqual([]);
	});
});
