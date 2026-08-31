import { expect, test } from '@playwright/test';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

test.describe('shared audio editor dialog behavior', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('traps modal focus and supports Escape and outside dismissal', async ({ page }) => {
		const editor = await bootEditor(page);
		const { restoreTarget, queuedFrames } = await chooseCommandWithHeldInitialFocus(page, editor, 'Edit', 'Preferences');
		let dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await expect(dialog).toBeVisible();
		expect(queuedFrames).toBeGreaterThan(0);

		const resize = dialog.getByRole('button', { name: 'Resize: Editor preferences', exact: true });
		await expect(resize).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(dialog.getByRole('button', { name: 'Close', exact: true }).first()).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(restoreTarget).toBeFocused();

		await chooseCommand(page, editor, 'Edit', 'Preferences');
		dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const [dialogBounds, editorBounds] = await Promise.all([dialog.boundingBox(), editor.boundingBox()]);
		expect(dialogBounds).not.toBeNull();
		expect(editorBounds).not.toBeNull();
		await page.mouse.click(
			Math.max(editorBounds.x + 2, dialogBounds.x - 8),
			dialogBounds.y + dialogBounds.height / 2,
		);
		await expect(dialog).toBeHidden();
	});

	test('gives generator dialogs the same focus, resize, and Escape contract', async ({ page }) => {
		const editor = await bootEditor(page);
		await chooseCommand(page, editor, 'Generate', 'Tone');
		const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
		await expect(dialog).toBeVisible();

		const resize = dialog.getByRole('button', { name: 'Resize: Tone', exact: true });
		await resize.focus();
		await page.keyboard.press('Tab');
		await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	test('keeps workspace and search shortcuts behind an open modal dialog', async ({ page }) => {
		const editor = await bootEditor(page);
		await chooseCommand(page, editor, 'Edit', 'Preferences');
		const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const search = editor.locator('[data-editor-search-input]');
		const play = editor.locator('[data-transport="play"] button').first();
		await dialog.focus();
		await expect(dialog).toBeFocused();
		await expect(search).toHaveAttribute('aria-expanded', 'false');
		await expect(play).toHaveAttribute('aria-pressed', 'false');
		await play.focus();
		await expect(play).toBeFocused();
		await page.keyboard.press('Control+f');
		await expect(search, 'the modal owns shortcuts before its deferred focus lands')
			.toHaveAttribute('aria-expanded', 'false');

		for (const shortcut of ['Control+f', 'F3', 'Space']) {
			await dialog.focus();
			await page.keyboard.press(shortcut);
			await expect(dialog).toBeVisible();
			await expect(search, `${shortcut} must not open workspace search`)
				.toHaveAttribute('aria-expanded', 'false');
			await expect(play).toHaveAttribute('aria-pressed', 'false');
		}
	});

	test('keeps nonmodal effect settings draggable after their dock closes', async ({ page }) => {
		const editor = await bootEditor(page);
		const track = editor.locator('[data-track-row]').first();
		await track.getByRole('button', { name: 'Effects', exact: true }).click();
		const effectsPanel = editor.locator('[data-workspace-panel="effects"]');
		await expect(effectsPanel).toBeVisible();

		await effectsPanel.locator('[data-effect-rack]')
			.getByRole('button', { name: 'Effects', exact: true })
			.first()
			.click();
		const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
		await picker.getByRole('menuitem', { name: 'Reverb', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Reverb', exact: true });
		await expect(dialog).toBeVisible();

		await effectsPanel.getByRole('button', { name: 'Close: Effects', exact: true }).click();
		await expect(dialog).toBeVisible();
		const header = dialog.locator('.dialog-header');
		const [before, headerBounds] = await Promise.all([dialog.boundingBox(), header.boundingBox()]);
		expect(before).not.toBeNull();
		expect(headerBounds).not.toBeNull();

		await page.mouse.move(headerBounds.x + 24, headerBounds.y + headerBounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(headerBounds.x + 88, headerBounds.y + headerBounds.height / 2 + 40, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await dialog.boundingBox())?.x).toBeCloseTo(before.x + 64, 0);
		await expect.poll(async () => (await dialog.boundingBox())?.y).toBeCloseTo(before.y + 40, 0);
		const moved = await dialog.boundingBox();
		expect(moved).not.toBeNull();
		await page.mouse.move(headerBounds.x + 160, headerBounds.y + headerBounds.height / 2 + 80);
		const afterMouseUp = await dialog.boundingBox();
		expect(afterMouseUp.x).toBeCloseTo(moved.x, 0);
		expect(afterMouseUp.y).toBeCloseTo(moved.y, 0);

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	test('dismisses only the topmost dialog when modal and nonmodal dialogs are stacked', async ({ page }) => {
		const editor = await bootEditor(page);
		const track = editor.locator('[data-track-row]').first();
		await track.getByRole('button', { name: 'Effects', exact: true }).click();
		const effectsPanel = editor.locator('[data-workspace-panel="effects"]');
		await effectsPanel.locator('[data-effect-rack]')
			.getByRole('button', { name: 'Effects', exact: true })
			.first()
			.click();
		const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
		await picker.getByRole('menuitem', { name: 'Reverb', exact: true }).click();
		const reverb = page.getByRole('dialog', { name: 'Reverb', exact: true });
		await expect(reverb).toBeVisible();

		await chooseCommand(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await expect(preferences).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(preferences).toBeHidden();
		await expect(reverb).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(reverb).toBeHidden();
	});
});

async function bootEditor(page) {
	await page.goto('/embed/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

async function chooseCommand(page, editor, menuName, commandName) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
	const menu = page.getByRole('menu', { name: menuName, exact: true });
	await expect(menu).toBeVisible();
	const command = menu.getByRole('menuitem', { name: new RegExp(`^${commandName}(?:\\s|$)`) }).first();
	await command.focus();
	await page.keyboard.press('Enter');
}

async function chooseCommandWithHeldInitialFocus(page, editor, menuName, commandName) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	const restoreTarget = menubar.getByRole('menuitem', { name: menuName, exact: true });
	await restoreTarget.click();
	const menu = page.getByRole('menu', { name: menuName, exact: true });
	await expect(menu).toBeVisible();
	const command = menu.getByRole('menuitem', { name: new RegExp(`^${commandName}(?:\\s|$)`) }).first();
	await restoreTarget.focus();
	await page.evaluate(() => {
		const nativeRequestAnimationFrame = window.requestAnimationFrame;
		const nativeCancelAnimationFrame = window.cancelAnimationFrame;
		const heldFrames = new Map();
		let heldFrameId = -1;
		window.requestAnimationFrame = (callback) => {
			const frameId = heldFrameId;
			heldFrameId -= 1;
			heldFrames.set(frameId, callback);
			return frameId;
		};
		window.cancelAnimationFrame = (frameId) => {
			if (frameId < 0) heldFrames.delete(frameId);
			else nativeCancelAnimationFrame(frameId);
		};
		window.__releaseHeldDialogFrames = () => {
			window.requestAnimationFrame = nativeRequestAnimationFrame;
			window.cancelAnimationFrame = nativeCancelAnimationFrame;
			const frames = [...heldFrames.values()];
			for (const callback of frames) callback(performance.now());
			delete window.__releaseHeldDialogFrames;
			return frames.length;
		};
	});
	try {
		// A native click preserves a connected focus target for the restoration assertion.
		await command.evaluate((element) => element.click());
		const resize = page.locator('[role="dialog"] [data-resize-handle]').last();
		await expect(resize).toBeVisible();
		await resize.focus();
		const queuedFrames = await page.evaluate(() => window.__releaseHeldDialogFrames());
		await expect(resize).toBeFocused();
		return { restoreTarget, queuedFrames };
	} catch (error) {
		await page.evaluate(() => window.__releaseHeldDialogFrames?.());
		throw error;
	}
}
