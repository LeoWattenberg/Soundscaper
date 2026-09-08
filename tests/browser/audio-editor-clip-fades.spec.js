import { expect, test, toneA, toneB, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles, registerAudioEditorHooks, setDocumentTheme, waitForEditor } from './audio-editor-test-helpers.js';

async function selectClip(clip) {
	await clip.focus();
	await clip.press('Enter');
}

async function beginFadeDrag(page, handle, delta) {
	const bounds = await handle.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 5);
	await handle.evaluate(element => {
		window.addEventListener('pointerdown', event => {
			element.setAttribute('data-test-pointer-id', String(event.pointerId));
		}, { capture: true, once: true });
	});
	await page.mouse.down();
	const pointer = await handle.evaluate(element => {
		const id = element.getAttribute('data-test-pointer-id');
		element.removeAttribute('data-test-pointer-id');
		if (id === null) throw new Error('The fade handle did not receive a pointer press.');
		return Number(id);
	});
	await page.mouse.move(bounds.x + bounds.width / 2 + delta, bounds.y + 5, { steps: 5 });
	return pointer;
}

async function waveformImage(clip) {
	return clip.locator('canvas.clip-body__waveform').first().evaluate(canvas => canvas.toDataURL());
}

test.describe('non-destructive clip fade handles', () => {
	registerAudioEditorHooks();

	for (const fixture of [monoTone, toneA]) {
		test(`previews both fades, keeps shading after deselection and undoes one drag (${fixture.name})`, async ({ page }, testInfo) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [fixture]);
			const clip = clipByName(editor, fixture.name);
			await selectClip(clip);
			const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
			const fadeOut = clip.getByRole('slider', { name: 'Fade out', exact: true });
			await expect(fadeIn).toBeVisible();
			await expect(fadeOut).toBeVisible();
			const clipBounds = await clip.boundingBox();
			expect((await fadeIn.boundingBox()).y).toBeGreaterThanOrEqual(clipBounds.y + 20);
			expect((await fadeOut.boundingBox()).y).toBeGreaterThanOrEqual(clipBounds.y + 20);
			const placement = await clip.getAttribute('aria-label');
			const before = await waveformImage(clip);
			await beginFadeDrag(page, fadeIn, 30);
			await expect.poll(async () => Number(await fadeIn.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
			await expect.poll(() => waveformImage(clip)).not.toBe(before);
			await expect(clip.locator('.audio-editor-clip-fade__shade')).toBeVisible();
			await page.mouse.up();
			await expect(clip).toHaveAttribute('aria-label', placement);
			const incoming = await fadeIn.getAttribute('aria-valuenow');
			await beginFadeDrag(page, fadeOut, -30);
			await expect.poll(async () => Number(await fadeOut.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
			await page.mouse.up();
			await clip.screenshot({ path: testInfo.outputPath('clip-fades.png') });
			await setDocumentTheme(page, 'dark');
			await clip.screenshot({ path: testInfo.outputPath('clip-fades-dark.png') });
			await setDocumentTheme(page, 'light');
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(fadeOut).toHaveAttribute('aria-valuenow', '0');
			await expect(fadeIn).toHaveAttribute('aria-valuenow', incoming);
			await editor.getByRole('button', { name: 'Redo', exact: true }).click();
			await expect.poll(async () => Number(await fadeOut.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
			await clip.click({ position: { x: 30, y: 50 } });
			await expect(clip.getByRole('slider')).toHaveCount(0);
			await expect(clip.locator('.audio-editor-clip-fade__shade')).toBeVisible();
			expect(errors).toEqual([]);
		});
	}

	test('Escape and pointer cancellation discard a preview, while keyboard edits persist after reload', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		let clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		let fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
		await clip.press('Tab');
		await expect(fade).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(clip.getByRole('slider', { name: 'Fade out', exact: true })).toBeFocused();
		await beginFadeDrag(page, fade, 25);
		await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await expect(fade).toHaveAttribute('aria-valuenow', '0');
		const pointerId = await beginFadeDrag(page, fade, 25);
		await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await fade.dispatchEvent('pointercancel', { pointerId, pointerType: 'mouse' });
		await page.mouse.up();
		await expect(fade).toHaveAttribute('aria-valuenow', '0');
		await fade.press('ArrowRight');
		await expect(fade).toHaveAttribute('aria-valuenow', '0.01');
		await fade.press('Shift+ArrowRight');
		await expect(fade).toHaveAttribute('aria-valuenow', '0.11');
		await fade.press('End');
		await expect(fade).toHaveAttribute('aria-valuenow', '0.8');
		await fade.press('Home');
		await expect(fade).toHaveAttribute('aria-valuenow', '0');
		await fade.press('Shift+ArrowRight');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restored = await waitForEditor(page);
		clip = clipByName(restored, toneA.name);
		await selectClip(clip);
		fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
		await expect(fade).toHaveAttribute('aria-valuenow', '0.1');
	});

	test('a handle affects only its own clip when multiple clips are selected', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const first = clipByName(editor, toneA.name);
		const second = clipByName(editor, toneB.name);
		await selectClip(first);
		await second.focus();
		await second.press('Shift+Enter');
		const firstFade = first.getByRole('slider', { name: 'Fade in', exact: true });
		const secondFade = second.getByRole('slider', { name: 'Fade in', exact: true });
		await expect(firstFade).toBeVisible();
		await expect(secondFade).toBeVisible();
		await beginFadeDrag(page, firstFade, 30);
		await page.mouse.up();
		await expect.poll(async () => Number(await firstFade.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await expect(secondFade).toHaveAttribute('aria-valuenow', '0');
	});

	test('handles take precedence over the split tool and an unchanged drag adds no undo entry', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
		const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
		await beginFadeDrag(page, fade, 30);
		await page.mouse.up();
		await expect(clip).toHaveCount(1);
		await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await beginFadeDrag(page, fade, 0);
		await page.mouse.up();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(fade).toHaveAttribute('aria-valuenow', '0');
	});
});
