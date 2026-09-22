import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	clipByName,
	clipField,
	closeDialog,
	collectClientErrors,
	importFiles,
	openClipProperties,
	registerAudioEditorHooks,
	showToolbarButton,
} from './audio-editor-test-helpers.js';

const ANCHOR_START_FRAME = 48_000;
const SNAPPED_MOVING_START_FRAME = 9_600;
const NEAR_BOUNDARY_PIXELS = 2.5;

async function setupBoundaryClips(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	await showToolbarButton(page, editor, 'Snap');
	await expect(editor.getByRole('checkbox', { name: 'Snap', exact: true }))
		.toHaveAttribute('aria-checked', 'false');
	const anchor = clipByName(editor, toneA.name);
	const properties = await openClipProperties(page, editor, anchor);
	await clipField(properties, 'startFrame').fill(String(ANCHOR_START_FRAME));
	await clipField(properties, 'startFrame').press('Tab');
	await closeDialog(properties);
	await expect.poll(async () => (await anchor.boundingBox())?.x ?? 0).toBeGreaterThan(250);
	return { editor, anchor, moving: clipByName(editor, toneB.name) };
}

async function startFrame(page, editor, clip) {
	const properties = await openClipProperties(page, editor, clip);
	const frame = Number(await clipField(properties, 'startFrame').inputValue());
	await closeDialog(properties);
	return frame;
}

async function resetMovingClip(page, editor, moving) {
	const properties = await openClipProperties(page, editor, moving);
	await clipField(properties, 'startFrame').fill('0');
	await clipField(properties, 'startFrame').press('Tab');
	await closeDialog(properties);
}

async function beginNearBoundaryClipDrag(page, anchor, moving, targetAnchorTrack = false) {
	const anchorBox = await anchor.boundingBox();
	const movingBox = await moving.boundingBox();
	expect(anchorBox).not.toBeNull();
	expect(movingBox).not.toBeNull();
	const x = movingBox.x + 30;
	const y = movingBox.y + 10;
	const targetY = targetAnchorTrack ? anchorBox.y + 10 : y;
	const targetX = x + anchorBox.x - (movingBox.x + movingBox.width) - NEAR_BOUNDARY_PIXELS;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(targetX, targetY, { steps: 6 });
	return { anchorBox, targetX, y };
}

async function expectYellowGuide(editor) {
	const guide = editor.locator('[data-smart-snap-guide]');
	await expect(guide).toBeVisible();
	await expect(guide).toHaveAttribute('data-smart-snap-frame', String(ANCHOR_START_FRAME));
	const [red, green, blue] = await guide.evaluate((element) => (
		getComputedStyle(element).backgroundColor.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? []
	));
	expect(red).toBeGreaterThanOrEqual(190);
	expect(green).toBeGreaterThanOrEqual(140);
	expect(blue).toBeLessThan(130);
}

test.describe('Audacity 3 boundary snapping', () => {
	registerAudioEditorHooks();

	test('clip ends align to another clip start with grid Snap off; Escape releases this drag only', async ({ page }) => {
		const errors = collectClientErrors(page);
		const { editor, anchor, moving } = await setupBoundaryClips(page);

		let drag = await beginNearBoundaryClipDrag(page, anchor, moving);
		await expectYellowGuide(editor);
		await expect.poll(async () => {
			const box = await moving.boundingBox();
			return box ? Math.abs(box.x + box.width - drag.anchorBox.x) : Infinity;
		}).toBeLessThan(1);
		await page.keyboard.press('Escape');
		await expect(editor.locator('[data-smart-snap-guide]')).toHaveCount(0);
		await page.mouse.move(drag.targetX + 0.1, drag.y);
		await expect.poll(async () => {
			const box = await moving.boundingBox();
			return box ? Math.abs(box.x + box.width - drag.anchorBox.x) : 0;
		}).toBeGreaterThan(1.5);
		await page.mouse.up();
		expect(await startFrame(page, editor, moving)).not.toBe(SNAPPED_MOVING_START_FRAME);

		await resetMovingClip(page, editor, moving);
		drag = await beginNearBoundaryClipDrag(page, anchor, moving);
		await expectYellowGuide(editor);
		await page.mouse.up();
		expect(await startFrame(page, editor, moving)).toBe(SNAPPED_MOVING_START_FRAME);
		expect(errors).toEqual([]);
	});

	test('clip boundary alignment stays exact when time-grid Snap is on', async ({ page }) => {
		const { editor, anchor, moving } = await setupBoundaryClips(page);
		await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
		await expect(editor.getByRole('checkbox', { name: 'Snap', exact: true }))
			.toHaveAttribute('aria-checked', 'true');
		await beginNearBoundaryClipDrag(page, anchor, moving);
		await expectYellowGuide(editor);
		await page.mouse.up();
		expect(await startFrame(page, editor, moving)).toBe(SNAPPED_MOVING_START_FRAME);
	});

	test('same-track audio edges overlap by 2 ms only while microfades are enabled', async ({ page }) => {
		const { editor, anchor, moving } = await setupBoundaryClips(page);
		await beginNearBoundaryClipDrag(page, anchor, moving, true);
		await expectYellowGuide(editor);
		await page.mouse.up();
		expect(await startFrame(page, editor, moving)).toBe(SNAPPED_MOVING_START_FRAME + 96);
		await expect(editor.locator('[data-automatic-crossfade="true"]')).toHaveCount(0);

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Editing$/u }).click();
		await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' }).uncheck();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await resetMovingClip(page, editor, moving);
		await beginNearBoundaryClipDrag(page, anchor, moving);
		await expectYellowGuide(editor);
		await page.mouse.up();
		expect(await startFrame(page, editor, moving)).toBe(SNAPPED_MOVING_START_FRAME);
	});

	test('selection end aligns to a clip start and Escape restores free placement for this drag', async ({ page }) => {
		const errors = collectClientErrors(page);
		const { editor, anchor } = await setupBoundaryClips(page);
		const anchorBox = await anchor.boundingBox();
		const laneBox = await editor.locator('.audio-editor-track-lane[data-track-lane]').first().boundingBox();
		expect(anchorBox).not.toBeNull();
		expect(laneBox).not.toBeNull();
		const y = laneBox.y + laneBox.height / 2;
		const startX = anchorBox.x - 60;
		const nearX = anchorBox.x - NEAR_BOUNDARY_PIXELS;
		const band = editor.locator('[data-time-selection-overlay]').first();

		await page.mouse.move(startX, y);
		await page.mouse.down();
		await page.mouse.move(nearX, y, { steps: 6 });
		await expectYellowGuide(editor);
		await expect.poll(async () => {
			const box = await band.boundingBox();
			return box ? Math.abs(box.x + box.width - anchorBox.x) : Infinity;
		}).toBeLessThan(1);
		await page.keyboard.press('Escape');
		await expect(editor.locator('[data-smart-snap-guide]')).toHaveCount(0);
		await page.mouse.move(nearX + 0.1, y);
		await page.mouse.up();
		await expect.poll(async () => {
			const box = await band.boundingBox();
			return box ? Math.abs(box.x + box.width - anchorBox.x) : 0;
		}).toBeGreaterThan(1.5);

		await page.mouse.move(startX, y);
		await page.mouse.down();
		await page.mouse.move(nearX, y, { steps: 6 });
		await expectYellowGuide(editor);
		await page.mouse.up();
		await expect.poll(async () => {
			const box = await band.boundingBox();
			return box ? Math.abs(box.x + box.width - anchorBox.x) : Infinity;
		}).toBeLessThan(1);
		expect(errors).toEqual([]);
	});

	test('selection boundary alignment remains available with time-grid Snap on', async ({ page }) => {
		const { editor, anchor } = await setupBoundaryClips(page);
		await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
		const anchorBox = await anchor.boundingBox();
		const laneBox = await editor.locator('.audio-editor-track-lane[data-track-lane]').first().boundingBox();
		expect(anchorBox).not.toBeNull();
		expect(laneBox).not.toBeNull();
		const y = laneBox.y + laneBox.height / 2;
		await page.mouse.move(anchorBox.x - 60, y);
		await page.mouse.down();
		await page.mouse.move(anchorBox.x - NEAR_BOUNDARY_PIXELS, y, { steps: 6 });
		await expectYellowGuide(editor);
		await page.mouse.up();
		await expect.poll(async () => {
			const box = await editor.locator('[data-time-selection-overlay]').first().boundingBox();
			return box ? Math.abs(box.x + box.width - anchorBox.x) : Infinity;
		}).toBeLessThan(1);
	});

	test('selection start aligns to another clip end', async ({ page }) => {
		const { editor, moving } = await setupBoundaryClips(page);
		const movingBox = await moving.boundingBox();
		const laneBox = await editor.locator('.audio-editor-track-lane[data-track-lane]').first().boundingBox();
		expect(movingBox).not.toBeNull();
		expect(laneBox).not.toBeNull();
		const y = laneBox.y + laneBox.height / 2;
		const clipEndX = movingBox.x + movingBox.width;
		await page.mouse.move(clipEndX + NEAR_BOUNDARY_PIXELS, y);
		await page.mouse.down();
		await page.mouse.move(clipEndX + 70, y, { steps: 6 });
		await expect(editor.locator('[data-smart-snap-guide]')).toHaveAttribute('data-smart-snap-frame', '38400');
		await page.mouse.up();
		await expect.poll(async () => {
			const box = await editor.locator('[data-time-selection-overlay]').first().boundingBox();
			return box ? Math.abs(box.x - clipEndX) : Infinity;
		}).toBeLessThan(1);
	});
});
