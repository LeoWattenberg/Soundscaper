import { darkTheme } from '../../vendor/audacity-design-system/tokens/src/themes/dark.v2.ts';
import { lightTheme } from '../../vendor/audacity-design-system/tokens/src/themes/light.v2.ts';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect,
	bootEditor,
	chooseNestedCommandAction,
	importFiles,
	openEffectsForTrack,
	openExportDialog,
	registerAudioEditorHooks,
	setDocumentTheme,
	waitForResponsiveEditorLayout,
} from './audio-editor-test-helpers.js';

// Visual baselines for vendored components and the editor adapters around them.
// Dropdown exercises a body portal; the button tooltip exercises a Flyout.
const THEMES = ['light', 'dark'];
const SCREENSHOT_OPTIONS = {
	animations: 'disabled',
	caret: 'hide',
	maxDiffPixelRatio: 0.015,
};

function skipUnlessCanonicalBaselineRun(testInfo) {
	test.skip(
		process.platform !== 'linux' || testInfo.project.name !== 'chromium',
		'The canonical visual baselines are maintained by the Ubuntu CI Chromium run.',
	);
}

async function bootStableEditor(page) {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const editor = await bootEditor(page, '/embed/en/');
	await waitForResponsiveEditorLayout(editor);
	await page.evaluate(() => document.fonts.ready);
	await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
	return editor;
}

function cssColor(hex) {
	return `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
}

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('floating controls use the elevated surface and original checkbox styling in both themes', async ({ page }) => {
		const editor = await bootStableEditor(page);
		for (const theme of THEMES) {
			await setDocumentTheme(page, theme);
			const palette = theme === 'dark' ? darkTheme : lightTheme;
			await editor.getByRole('button', { name: 'Record level', exact: true }).click();
			const flyout = editor.getByRole('dialog', { name: 'Record level', exact: true });
			await expect(flyout).toBeVisible();
			await expect(flyout).toHaveCSS('background-color', cssColor(palette.background.surface.elevated));
			await expect(flyout.locator('.flyout__arrow')).toHaveCSS('border-bottom-color', cssColor(palette.background.surface.elevated));
			const checkbox = flyout.getByRole('checkbox', { name: 'Show mic metering when not recording', exact: true });
			await page.mouse.move(0, 0);
			await expect(checkbox).toHaveCSS('border-top-width', '0px');
			await expect(checkbox).toHaveCSS('background-color', cssColor(palette.background.control.checkbox.idle));
			await checkbox.hover();
			await expect(checkbox).toHaveCSS('background-color', cssColor(palette.background.control.checkbox.hover));
			await expect(checkbox).toHaveCSS('border-top-width', '0px');
			await page.mouse.move(0, 0);
			await page.keyboard.press('Tab');
			await checkbox.focus();
			await expect(checkbox).not.toHaveCSS('box-shadow', 'none');
			await page.keyboard.press('Escape');
			await expect(flyout).toBeHidden();

			await editor.getByRole('button', { name: 'Play options', exact: true }).click();
			const playOptions = editor.getByRole('menu', { name: 'Play options', exact: true });
			await expect(playOptions).toHaveCSS('background-color', cssColor(palette.background.surface.elevated));
			await expect(playOptions.locator('.flyout__arrow')).toHaveCSS('border-bottom-color', cssColor(palette.background.surface.elevated));
			const preservePitch = playOptions.getByRole('menuitem', { name: 'Preserve pitch', exact: true });
			await expect(preservePitch.locator('.context-menu-item-checkmark')).toHaveCSS('border-top-width', '0px');
			await page.keyboard.press('Escape');
			await expect(playOptions).toBeHidden();
		}
	});

	test('matches the mixer panel with a sends footer row in light and dark themes', async ({ page }, testInfo) => {
		skipUnlessCanonicalBaselineRun(testInfo);
		test.setTimeout(60_000);
		const editor = await bootStableEditor(page);

		const mixerPanel = editor.locator('[data-workspace-panel="mixer"]');
		if (!await mixerPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixerPanel).toBeVisible();
		const mixer = editor.locator('[data-mixer-panel]');
		await expect(mixer.locator('.mixer-channel')).toHaveCount(2);

		// A send bus makes MixerPanel render its sends footer row with the send
		// knob and target selector on the track channel strip.
		await mixer.getByRole('button', { name: 'Add send bus', exact: true }).click();
		await expect(mixer.locator('.kw-audio-editor__mixer-channel--send')).toHaveCount(1);
		await expect(mixer.locator('.mixer-panel__row-label').filter({ hasText: 'Sends' })).toHaveCount(1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

		for (const theme of THEMES) {
			await setDocumentTheme(page, theme);
			await expect(mixerPanel).toHaveScreenshot(`audio-editor-mixer-panel-${theme}.png`, SCREENSHOT_OPTIONS);
		}
	});

	test('matches the effects panel with a populated stack in light and dark themes', async ({ page }, testInfo) => {
		skipUnlessCanonicalBaselineRun(testInfo);
		test.setTimeout(60_000);
		const editor = await bootStableEditor(page);

		const effectsPanel = await openEffectsForTrack(editor, 0);
		// Invert has no parameters, so adding it populates the track rack without
		// opening an effect dialog over the panel.
		await addRackEffect(page, effectsPanel, 'track', 'Invert');
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('button', { name: 'Effect stack options', exact: true })).toHaveCount(2);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

		for (const theme of THEMES) {
			await setDocumentTheme(page, theme);
			await expect(effectsPanel).toHaveScreenshot(`audio-editor-effects-panel-${theme}.png`, SCREENSHOT_OPTIONS);
		}
	});

	test('matches an open body-portal dropdown menu in light and dark themes', async ({ page }, testInfo) => {
		skipUnlessCanonicalBaselineRun(testInfo);
		test.setTimeout(60_000);
		const editor = await bootStableEditor(page);
		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

		const exportDialog = await openExportDialog(page, editor);
		await exportDialog.locator('[data-export-field="format"]').getByRole('button').click();
		const menu = page.getByRole('listbox');
		await expect(menu).toHaveCount(1);
		await expect(menu).toBeVisible();
		await expect(menu.getByRole('option', { name: 'WAV', exact: true })).toBeVisible();
		// The component must carry its theme into document.body without an
		// application palette overriding the active theme.
		expect(await menu.evaluate((element) => Boolean(element.closest('[data-audio-editor]')))).toBe(false);

		for (const theme of THEMES) {
			await setDocumentTheme(page, theme);
			await expect(menu).toBeVisible();
			const palette = theme === 'dark' ? darkTheme : lightTheme;
			await expect(menu).toHaveCSS('--dropdown-menu-bg', palette.background.control.input.idle);
			await expect(menu).toHaveCSS('--dropdown-text', palette.foreground.text.primary);
			await expect(menu).toHaveCSS('--dropdown-border', palette.border.input.idle);
			// Capture the viewport rather than the menu element so the baseline
			// records the portal together with the dialog dropdown trigger it
			// belongs to.
			await expect(page).toHaveScreenshot(`audio-editor-dropdown-portal-${theme}.png`, SCREENSHOT_OPTIONS);
		}
	});

	test('matches a visible button tooltip flyout in light and dark themes', async ({ page }, testInfo) => {
		skipUnlessCanonicalBaselineRun(testInfo);
		test.setTimeout(60_000);
		const editor = await bootStableEditor(page);

		// The transport Play button reliably raises the shared Flyout tooltip on
		// hover, and the pointer stays put between screenshots so it never hides.
		await editor.getByRole('button', { name: 'Play', exact: true }).hover();
		const tooltip = page.locator('.kw-audio-editor__button-tooltip');
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toHaveAttribute('role', 'tooltip');
		await expect(tooltip.locator('[data-audio-editor-button-tooltip]')).toHaveText('Play');
		// Unlike the dropdown menu, this Flyout mounts inside the editor root
		// rather than as a document.body portal, so it is pinned here as the
		// floating tooltip surface instead of as a second portal baseline.
		expect(await tooltip.evaluate((element) => Boolean(element.closest('[data-audio-editor]')))).toBe(true);

		for (const theme of THEMES) {
			await setDocumentTheme(page, theme);
			await expect(tooltip).toBeVisible();
			const palette = theme === 'dark' ? darkTheme : lightTheme;
			await expect(tooltip).toHaveCSS('background-color', cssColor(palette.background.surface.elevated));
			await expect(tooltip.locator('.flyout__arrow')).toHaveCSS('border-bottom-color', cssColor(palette.background.surface.elevated));
			const box = await tooltip.boundingBox();
			expect(box).not.toBeNull();
			// Clip a padded region around the tooltip so the baseline keeps the
			// flyout arrow, which the element's own box would crop away.
			await expect(page).toHaveScreenshot(`audio-editor-button-tooltip-${theme}.png`, {
				...SCREENSHOT_OPTIONS,
				// The label is asserted semantically above. Allow the small Linux
				// Chromium glyph-antialiasing variance while retaining the tooltip's
				// complete geometry, arrow, surface, and theme baseline.
				maxDiffPixelRatio: 0.04,
				clip: {
					x: Math.max(0, box.x - 16),
					y: Math.max(0, box.y - 16),
					width: box.width + 32,
					height: box.height + 32,
				},
			});
		}
	});
});
