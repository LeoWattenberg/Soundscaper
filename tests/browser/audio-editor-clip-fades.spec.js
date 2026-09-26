import { expect, test, toneA, toneB, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors, importFiles, openClipProperties, registerAudioEditorHooks, setDocumentTheme, waitForEditor } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

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

async function dragShapeDown(page, handle, delta) {
	const bounds = await handle.boundingBox();
	expect(bounds).not.toBeNull();
	const x = bounds.x + bounds.width / 2;
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + delta, { steps: 5 });
	await page.mouse.up();
}

async function waveformImage(clip) {
	return clip.locator('canvas.clip-body__waveform').first().evaluate(canvas => canvas.toDataURL());
}

test.describe('non-destructive clip fade handles', () => {
	registerAudioEditorHooks();

	for (const fixture of [monoTone, toneA]) {
		test(`previews both fades, keeps curves after deselection and undoes one drag (${fixture.name})`, async ({ page }, testInfo) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [fixture]);
			const clip = clipByName(editor, fixture.name);
			await selectClip(clip);
			const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
			const fadeOut = clip.getByRole('slider', { name: 'Fade out', exact: true });
			await expect(fadeIn).toBeVisible();
			await expect(fadeOut).toBeVisible();
			await expect(fadeIn).toHaveAttribute('data-fade-handle', 'in');
			await expect(fadeOut).toHaveAttribute('data-fade-handle', 'out');
			const clipBounds = await clip.boundingBox();
			expect((await fadeIn.boundingBox()).y).toBeGreaterThanOrEqual(clipBounds.y + 20);
			expect((await fadeOut.boundingBox()).y).toBeGreaterThanOrEqual(clipBounds.y + 20);
			const placement = await clip.getAttribute('aria-label');
			const before = await waveformImage(clip);
			await beginFadeDrag(page, fadeIn, 30);
			await expect.poll(async () => Number(await fadeIn.getAttribute('aria-valuenow'))).toBeGreaterThan(0.002);
			await expect.poll(() => waveformImage(clip)).not.toBe(before);
			await expect(clip.locator('.audio-editor-clip-fade__curve')).toBeVisible();
			await page.mouse.up();
			await expect(clip).toHaveAttribute('aria-label', placement);
			const incoming = await fadeIn.getAttribute('aria-valuenow');
			await beginFadeDrag(page, fadeOut, -30);
			await expect.poll(async () => Number(await fadeOut.getAttribute('aria-valuenow'))).toBeGreaterThan(0.002);
			await page.mouse.up();
			await clip.screenshot({ path: testInfo.outputPath('clip-fades.png') });
			await setDocumentTheme(page, 'dark');
			await clip.screenshot({ path: testInfo.outputPath('clip-fades-dark.png') });
			await setDocumentTheme(page, 'light');
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(fadeOut).toHaveAttribute('aria-valuenow', '0.002');
			await expect(fadeIn).toHaveAttribute('aria-valuenow', incoming);
			await editor.getByRole('button', { name: 'Redo', exact: true }).click();
			await expect.poll(async () => Number(await fadeOut.getAttribute('aria-valuenow'))).toBeGreaterThan(0.002);
			await clip.click({ position: { x: 30, y: 50 } });
			await expect(clip.getByRole('slider')).toHaveCount(0);
			await expect(clip.locator('.audio-editor-clip-fade__curve')).toBeVisible();
			await expect(clip.locator('.audio-editor-clip-fade__curve polygon')).toHaveCount(0);
			expect(errors).toEqual([]);
		});
	}

	test('draws the design-system fade path without a filled area', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
		const fadeOut = clip.getByRole('slider', { name: 'Fade out', exact: true });
		await expect(fadeOut).not.toHaveAttribute('title');
		await fadeOut.hover();
		await expect(editor.locator('[data-audio-editor-button-tooltip]')).toHaveText('Fade out');
		await fadeIn.press('End');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0.8');
		const curves = clip.locator('.audio-editor-clip-fade__curve');
		await expect(curves.locator('polygon')).toHaveCount(0);
		await expect(curves.locator('path[data-fade-curve="in"]')).toHaveCount(1);
		await expect(curves.locator('path[data-fade-curve="in"]')).toHaveAttribute('fill', 'none');
		const curveBounds = await curves.boundingBox();
		expect(curveBounds).not.toBeNull();
		const lineBounds = await curves.locator('path[data-fade-curve="in"]').boundingBox();
		expect(lineBounds).not.toBeNull();
		expect(lineBounds.y).toBeGreaterThanOrEqual(curveBounds.y - 4);
		expect(lineBounds.y + lineBounds.height).toBeGreaterThan(curveBounds.y + curveBounds.height * 0.8);
		for (const handle of [fadeIn, clip.getByRole('slider', { name: 'Fade out', exact: true })]) {
			const bounds = await handle.boundingBox();
			expect(bounds).not.toBeNull();
			expect(bounds.y + bounds.height).toBeLessThan(curveBounds.y + curveBounds.height / 2);
		}
	});

	test('keeps the fade path continuous in Multi-view', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		const track = clip.locator('xpath=ancestor::div[@data-track-row]');
		await chooseTrackMenuAction(page, editor, track, ['Track visualization', 'Multi-view']);
		await expect(track).toHaveAttribute('data-display-mode', 'multiview');
		await selectClip(clip);
		const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
		await fadeIn.press('End');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0.8');
		const curves = clip.locator('.audio-editor-clip-fade__curve');
		await expect(curves.locator('polygon')).toHaveCount(0);
		await expect(curves.locator('path[data-fade-curve="in"]')).toHaveCount(1);
		const bounds = await curves.boundingBox();
		const pathBounds = await curves.locator('path[data-fade-curve="in"]').boundingBox();
		const handleBounds = await fadeIn.boundingBox();
		expect(pathBounds.y + pathBounds.height).toBeGreaterThan(bounds.y + bounds.height * 0.8);
		expect(handleBounds.y + handleBounds.height).toBeLessThan(bounds.y + bounds.height / 2);
	});

	test('keeps the design-system fade grip squares inside the clip outline at both edges', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
		const fadeOut = clip.getByRole('slider', { name: 'Fade out', exact: true });
		await fadeIn.press('Home');
		await fadeOut.press('Home');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0');
		await expect(fadeOut).toHaveAttribute('aria-valuenow', '0');
		const outline = await clip.locator('.clip-display__inner').boundingBox();
		const incoming = await fadeIn.locator('svg path').first().boundingBox();
		const outgoing = await fadeOut.locator('svg path').first().boundingBox();
		expect(outline).not.toBeNull();
		expect(incoming).not.toBeNull();
		expect(outgoing).not.toBeNull();
		expect(incoming.x).toBeGreaterThanOrEqual(outline.x + 2);
		expect(outgoing.x + outgoing.width).toBeLessThanOrEqual(outline.x + outline.width - 2);
	});

	test('shape handles appear with fades, can be hidden in View, and save curve drags', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		let clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
		await fadeIn.press('End');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0.8');
		await expect(clip.getByRole('slider', { name: 'Fade in shape', exact: true })).toBeVisible();
		await chooseCommandAction(page, editor, 'View', 'Fade shape handles');
		await expect(clip.locator('[data-clip-fade-shape-handle]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Fade shape handles');
		let shape = clip.getByRole('slider', { name: 'Fade in shape', exact: true });
		await expect(shape).toBeVisible();
		await expect(shape).toHaveAttribute('aria-valuenow', '1');
		await expect(shape).not.toHaveAttribute('title');
		await clip.focus();
		await clip.press('Tab');
		await expect(fadeIn).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(shape).toBeFocused();
		const before = await waveformImage(clip);
		await dragShapeDown(page, shape, 15);
		await expect.poll(async () => Number(await shape.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0.8');
		await expect.poll(() => waveformImage(clip)).not.toBe(before);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(shape).toHaveAttribute('aria-valuenow', '1');
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(async () => Number(await shape.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restored = await waitForEditor(page);
		clip = clipByName(restored, toneA.name);
		await selectClip(clip);
		shape = clip.getByRole('slider', { name: 'Fade in shape', exact: true });
		await expect(shape).toBeVisible();
		await expect.poll(async () => Number(await shape.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
		await shape.press('Home');
		await expect(shape).toHaveAttribute('aria-valuenow', '0.15');
		await shape.press('End');
		await expect(shape).toHaveAttribute('aria-valuenow', '6');
	});

	test('Clip properties edits both fade shapes with sliders', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		await clip.getByRole('slider', { name: 'Fade in', exact: true }).press('End');
		await clip.getByRole('slider', { name: 'Fade out', exact: true }).press('End');
		const dialog = await openClipProperties(page, editor, clip);
		const incoming = dialog.getByRole('slider', { name: 'Fade in shape', exact: true });
		const outgoing = dialog.getByRole('slider', { name: 'Fade out shape', exact: true });
		await expect(incoming).toHaveValue('1');
		await expect(outgoing).toHaveValue('1');
		await incoming.focus();
		await incoming.press('End');
		await expect(incoming).toHaveValue('6');
		await outgoing.focus();
		await outgoing.press('Home');
		await expect(outgoing).toHaveValue('0.15');
		await dialog.getByRole('button', { name: 'Done', exact: true }).click();
		await expect(clip.getByRole('slider', { name: 'Fade in shape', exact: true })).toHaveAttribute('aria-valuenow', '6');
		await expect(clip.getByRole('slider', { name: 'Fade out shape', exact: true })).toHaveAttribute('aria-valuenow', '0.15');
	});

	test('both shape dots remain draggable when the two authored fades overlap', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		await clip.getByRole('slider', { name: 'Fade in', exact: true }).press('End');
		await clip.getByRole('slider', { name: 'Fade out', exact: true }).press('End');
		const incoming = clip.getByRole('slider', { name: 'Fade in shape', exact: true });
		const outgoing = clip.getByRole('slider', { name: 'Fade out shape', exact: true });
		const inBounds = await incoming.boundingBox();
		const outBounds = await outgoing.boundingBox();
		expect(inBounds).not.toBeNull();
		expect(outBounds).not.toBeNull();
		expect(outBounds.x - inBounds.x).toBeGreaterThanOrEqual(16);
		await dragShapeDown(page, incoming, 10);
		await expect.poll(async () => Number(await incoming.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
		await expect(outgoing).toHaveAttribute('aria-valuenow', '1');
		await dragShapeDown(page, outgoing, 10);
		await expect.poll(async () => Number(await outgoing.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
	});

	test('another pointer losing capture does not cancel a fade shape drag', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		await clip.getByRole('slider', { name: 'Fade in', exact: true }).press('End');
		const shape = clip.getByRole('slider', { name: 'Fade in shape', exact: true });
		const bounds = await shape.boundingBox();
		expect(bounds).not.toBeNull();
		const x = bounds.x + bounds.width / 2;
		const y = bounds.y + bounds.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 12, { steps: 4 });
		await expect.poll(async () => Number(await shape.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
		await page.evaluate(() => window.dispatchEvent(new PointerEvent('lostpointercapture', {
			pointerId: 999_999,
			bubbles: true,
		})));
		await expect.poll(async () => Number(await shape.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
		await page.mouse.up();
		await expect.poll(async () => Number(await shape.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
	});

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
		await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(0.002);
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await expect(fade).toHaveAttribute('aria-valuenow', '0.002');
		const pointerId = await beginFadeDrag(page, fade, 25);
		await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(0.002);
		await fade.dispatchEvent('pointercancel', { pointerId, pointerType: 'mouse' });
		await page.mouse.up();
		await expect(fade).toHaveAttribute('aria-valuenow', '0.002');
		await fade.press('ArrowRight');
		await expect(fade).toHaveAttribute('aria-valuenow', '0.012');
		await fade.press('Shift+ArrowRight');
		await expect(fade).toHaveAttribute('aria-valuenow', '0.112');
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
		await expect.poll(async () => Number(await firstFade.getAttribute('aria-valuenow'))).toBeGreaterThan(0.002);
		await expect(secondFade).toHaveAttribute('aria-valuenow', '0.002');
	});

	test('both design-system grips remain reachable when fades overlap', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
		const fadeOut = clip.getByRole('slider', { name: 'Fade out', exact: true });
		await fadeIn.press('Home');
		await fadeOut.press('Home');
		for (let step = 0; step < 5; step += 1) {
			await fadeIn.press('Shift+ArrowRight');
			await fadeOut.press('Shift+ArrowRight');
		}
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0.5');
		await expect(fadeOut).toHaveAttribute('aria-valuenow', '0.5');
		const inBounds = await fadeIn.boundingBox();
		const outBounds = await fadeOut.boundingBox();
		expect(inBounds).not.toBeNull();
		expect(outBounds).not.toBeNull();
		expect(inBounds.x + inBounds.width <= outBounds.x
			|| outBounds.x + outBounds.width <= inBounds.x).toBe(true);
		await beginFadeDrag(page, fadeIn, -10);
		await page.mouse.up();
		await expect.poll(async () => Number(await fadeIn.getAttribute('aria-valuenow'))).toBeLessThan(0.5);
		await expect(fadeOut).toHaveAttribute('aria-valuenow', '0.5');
		await beginFadeDrag(page, fadeOut, 10);
		await page.mouse.up();
		await expect.poll(async () => Number(await fadeOut.getAttribute('aria-valuenow'))).toBeLessThan(0.5);
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
		await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(0.002);
		await beginFadeDrag(page, fade, 0);
		await page.mouse.up();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(fade).toHaveAttribute('aria-valuenow', '0.002');
	});

	test('new clips use microfades until the editing preference is turned off', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const first = clipByName(editor, toneA.name);
		await selectClip(first);
		await expect(first.getByRole('slider', { name: 'Fade in' })).toHaveAttribute('aria-valuenow', '0.002');
		await expect(first.getByRole('slider', { name: 'Fade out' })).toHaveAttribute('aria-valuenow', '0.002');

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Editing$/u }).click();
		await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' }).uncheck();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await importFiles(editor, [toneB]);
		const second = clipByName(editor, toneB.name);
		await selectClip(second);
		await expect(second.getByRole('slider', { name: 'Fade in' })).toHaveAttribute('aria-valuenow', '0');
		await expect(second.getByRole('slider', { name: 'Fade out' })).toHaveAttribute('aria-valuenow', '0');
	});
});
