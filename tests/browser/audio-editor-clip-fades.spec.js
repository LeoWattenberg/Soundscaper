import { expect, test, toneA, toneB, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors, importFiles, registerAudioEditorHooks, setDocumentTheme, waitForEditor } from './audio-editor-test-helpers.js';
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

async function waveformImage(clip) {
	return clip.locator('canvas.clip-body__waveform').first().evaluate(canvas => canvas.toDataURL());
}

async function shadedPoints(shade, coordinates) {
	return shade.evaluate((svg, points) => {
		const bounds = svg.getBoundingClientRect();
		const polygons = [...svg.querySelectorAll('polygon')];
		return points.map(([x, y]) => polygons.some(polygon => {
			const matrix = polygon.getScreenCTM();
			if (!matrix) return false;
			const point = new DOMPoint(bounds.left + x * bounds.width, bounds.top + y * bounds.height)
				.matrixTransform(matrix.inverse());
			return polygon.isPointInFill(point);
		}));
	}, coordinates);
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
			await expect.poll(async () => Number(await fadeIn.getAttribute('aria-valuenow'))).toBeGreaterThan(0.002);
			await expect.poll(() => waveformImage(clip)).not.toBe(before);
			await expect(clip.locator('.audio-editor-clip-fade__shade')).toBeVisible();
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
			await expect(clip.locator('.audio-editor-clip-fade__shade')).toBeVisible();
			expect(errors).toEqual([]);
		});
	}

	test('shades both stereo channels around their center lines while keeping handles at the top', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await selectClip(clip);
		const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
		await fadeIn.press('End');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0.8');
		const shade = clip.locator('.audio-editor-clip-fade__shade');
		await expect(shade.locator('polygon')).toHaveCount(2);
		await expect(shade.locator('polyline')).toHaveCount(2);
		const painted = await shadedPoints(shade, [0.1, 0.3, 0.5, 0.7, 0.9].map(y => [0.25, y]));
		expect(painted).toEqual([true, false, false, false, true]);
		const shadeBounds = await shade.boundingBox();
		expect(shadeBounds).not.toBeNull();
		const lineBounds = await shade.locator('polyline').evaluateAll(lines => lines.map(line => {
			const bounds = line.getBoundingClientRect();
			return { top: bounds.top, bottom: bounds.bottom };
		}));
		const channelDivider = shadeBounds.y + shadeBounds.height / 2;
		expect(lineBounds[0].bottom).toBeLessThan(channelDivider);
		expect(lineBounds[1].top).toBeGreaterThan(channelDivider);
		for (const handle of [fadeIn, clip.getByRole('slider', { name: 'Fade out', exact: true })]) {
			const bounds = await handle.boundingBox();
			expect(bounds).not.toBeNull();
			expect(bounds.y + bounds.height).toBeLessThan(channelDivider);
		}
	});

	test('aligns stereo fade shading with both channel pairs in Multi-view', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		const track = clip.locator('xpath=ancestor::div[@data-track-row]');
		await chooseTrackMenuAction(page, editor, track, ['Display', 'Multi-view']);
		await expect(track).toHaveAttribute('data-display-mode', 'multiview');
		await selectClip(clip);
		const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
		await fadeIn.press('End');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0.8');
		const shade = clip.locator('.audio-editor-clip-fade__shade');
		await expect(shade.locator('polygon')).toHaveCount(4);
		await expect(shade.locator('polyline')).toHaveCount(4);
		const painted = await shadedPoints(shade, [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]
			.map(y => [0.25, y]));
		expect(painted).toEqual([true, false, false, false, true, true, false, false, false, true]);
		const channelCenters = await shade.locator('polyline').evaluateAll(lines => {
			const bounds = lines[0].ownerSVGElement.getBoundingClientRect();
			return lines.map(line => {
				const first = line.points.getItem(0);
				const screen = new DOMPoint(first.x, first.y).matrixTransform(line.getScreenCTM());
				return (screen.y - bounds.top) / bounds.height;
			});
		});
		for (const [index, center] of [0.125, 0.375, 0.625, 0.875].entries()) {
			expect(channelCenters[index]).toBeCloseTo(center, 2);
		}
		const bounds = await shade.boundingBox();
		const handleBounds = await fadeIn.boundingBox();
		expect(handleBounds.y + handleBounds.height).toBeLessThan(bounds.y + bounds.height / 2);
	});

	test('keeps fade marker triangles inside the clip outline at both edges', async ({ page }) => {
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
		const incoming = await fadeIn.locator('svg').boundingBox();
		const outgoing = await fadeOut.locator('svg').boundingBox();
		expect(outline).not.toBeNull();
		expect(incoming).not.toBeNull();
		expect(outgoing).not.toBeNull();
		expect(incoming.x).toBeGreaterThanOrEqual(outline.x + 2);
		expect(outgoing.x + outgoing.width).toBeLessThanOrEqual(outline.x + outline.width - 2);
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
