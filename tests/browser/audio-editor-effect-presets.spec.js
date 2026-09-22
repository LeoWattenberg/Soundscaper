import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect,
	bootEditor,
	closeDialog,
	collectClientErrors,
	importFiles,
	openEffectsForTrack,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('effect presets Audacity ships', () => {
	registerAudioEditorHooks();

	test('offers a shipped reverb preset in the effect dialog and applies its settings', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		await page.keyboard.press('Control+k');
		await editor.locator('[data-editor-search-input]').fill('Reverb');
		const reverb = editor.locator('[data-editor-search-popup] [data-editor-search-key="command:audacity-reverb"]');
		await expect(reverb).toBeVisible();
		await reverb.click();

		const dialog = page.locator('[data-selection-effects-dialog]');
		await expect(dialog).toBeVisible();
		const presets = dialog.getByRole('button', { name: 'Preset', exact: true });
		await expect(presets).toContainText('Default preset');
		await presets.click();

		// The list carries Audacity's own presets, and none of them is marked as
		// a preset this project saved.
		const cathedral = page.getByRole('option', { name: 'Cathedral', exact: true });
		await expect(page.getByRole('option', { name: 'Vocal I', exact: true })).toBeVisible();
		await expect(cathedral).toBeVisible();
		await cathedral.click();

		await expect(presets).toContainText('Cathedral');
		await expect(presets).not.toContainText('custom');
		await expect(dialog.locator('[data-effect-param="roomSize"] input')).toHaveValue('90');
		await expect(dialog.locator('[data-effect-param="reverberance"] input')).toHaveValue('90');
		await expect(dialog.locator('[data-effect-param="toneHigh"] input')).toHaveValue('0');
		await expect(dialog.locator('[data-effect-param="dryGainDb"] input')).toHaveValue('-20');

		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('imports an Audacity text preset through the existing preset option', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		await page.keyboard.press('Control+k');
		await editor.locator('[data-editor-search-input]').fill('Reverb');
		await editor.locator('[data-editor-search-popup] [data-editor-search-key="command:audacity-reverb"]').click();
		const dialog = page.locator('[data-selection-effects-dialog]');
		await expect(dialog).toBeVisible();

		const chooserPromise = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'More options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
		const chooser = await chooserPromise;
		await chooser.setFiles({
			name: 'Vocal room.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from([
				'Reverb:Delay="17" DryGain="-4" HfDamping="63" Reverberance="71"',
				'RoomSize="82" StereoWidth="91" ToneHigh="76" ToneLow="44" WetGain="-2" WetOnly="0"',
			].join(' ')),
		});

		const presets = dialog.getByRole('button', { name: 'Preset', exact: true });
		await presets.click();
		const imported = page.getByRole('option', { name: 'Vocal room (custom)', exact: true });
		await expect(imported).toBeVisible();
		await imported.click();
		await expect(dialog.locator('[data-effect-param="roomSize"] input')).toHaveValue('82');
		await expect(dialog.locator('[data-effect-param="preDelay"] input')).toHaveValue('17');

		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('opens effect details from both preset overflow menus', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await page.keyboard.press('Control+k');
		await editor.locator('[data-editor-search-input]').fill('Reverb');
		await editor.locator('[data-editor-search-popup] [data-editor-search-key="command:audacity-reverb"]').click();
		const selection = page.locator('[data-selection-effects-dialog]');
		await selection.getByRole('button', { name: 'More options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'About', exact: true }).click();
		const about = page.locator('[data-effect-about-dialog]');
		await expect(about).toBeVisible();
		await expect(about).toContainText('Reverb');
		await expect(about).toContainText('Plugin format');
		await expect(about).toContainText('License');
		await expect(about).toContainText('Category');
		await closeDialog(about);
		await expect(selection).toBeVisible();
		await closeDialog(selection);

		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Noise gate');
		const rack = page.getByRole('dialog', { name: 'Noise gate', exact: true });
		await rack.getByRole('button', { name: 'More options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'About', exact: true }).click();
		await expect(about).toBeVisible();
		await expect(about).toContainText('Noise gate');
		await expect(about).toContainText('Soundscaper');
		await closeDialog(about);
		await expect(rack).toBeVisible();
		await closeDialog(rack);
		expect(errors).toEqual([]);
	});

	test('keeps preset menus clickable after dragging an effect dialog and preserves its skin', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/?useskin=sakura');
		await importFiles(editor, [toneA]);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Noise gate');
		const dialog = page.getByRole('dialog', { name: 'Noise gate', exact: true });
		await expect(dialog).toBeVisible();
		const before = await dialog.boundingBox();
		const header = await dialog.locator('.dialog-header').boundingBox();
		expect(before).not.toBeNull();
		expect(header).not.toBeNull();
		await page.mouse.move(header.x + 24, header.y + header.height / 2);
		await page.mouse.down();
		await page.mouse.move(header.x + 224, header.y + header.height / 2 + 40, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await dialog.boundingBox())?.x).toBeCloseTo(before.x + 200, 0);
		// Exercise the inherited direction independently of the menu's React theme.
		await dialog.evaluate(node => node.setAttribute('dir', 'rtl'));
		const more = dialog.getByRole('button', { name: 'More options', exact: true });
		await more.click();
		const advanced = page.getByRole('menuitem', { name: 'Advanced settings', exact: true });
		await expect(advanced).toBeFocused();
		const options = advanced.locator('..');
		await expect(options).toHaveCSS('direction', 'rtl');
		await expect(options).toHaveCSS('background-color', 'rgb(255, 245, 245)');
		await expect(advanced).toHaveCSS('font-family', /Nunito Sans/u);
		await expect(options).toHaveCSS('border-radius', '7px');
		await menuWithinViewport(options);
		await page.keyboard.press('Escape');
		await expect(options).toBeHidden();
		await expect(more).toBeFocused();
		await expect(dialog).toBeVisible();

		await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
		const saveAs = page.getByRole('menuitem', { name: 'Save as new preset', exact: true });
		await menuWithinViewport(saveAs.locator('..'));
		await saveAs.click();
		const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
		await expect(prompt).toBeVisible();
		await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeVisible();
		await more.click();
		await advanced.click();
		await expect(dialog.getByRole('spinbutton', { name: 'Lookahead', exact: true })).toBeVisible();
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});
});

async function menuWithinViewport(menu) {
	await expect(menu).toBeVisible();
	await expect.poll(() => menu.evaluate(node => {
		const box = node.getBoundingClientRect();
		return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
	})).toBe(true);
}
