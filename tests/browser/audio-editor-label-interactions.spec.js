import { expect, longTone, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

async function selectTimeRange(page, editor, startX = 24, endX = 96) {
	const box = await editor.locator('[data-ruler]').boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + startX, box.y + 26);
	await page.mouse.down();
	await page.mouse.move(box.x + endX, box.y + 26, { steps: 4 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).toBeVisible();
}

test.describe('label interactions', () => {
	registerAudioEditorHooks();

	test('Ctrl+B and Add label immediately edit the new label, and F2 renames it', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await editor.getByRole('slider', { name: 'Playhead' }).focus();
		await page.keyboard.press('Control+b');
		const title = editor.getByRole('textbox', { name: /^Edit labels:/ });
		await expect(title).toBeFocused();
		await title.fill('Intro');
		await title.press('Enter');
		const label = editor.getByRole('group', { name: 'Edit labels: Intro', exact: true });
		await expect(label).toBeVisible();
		await expect(label).toBeFocused();
		await editor.getByRole('slider', { name: 'Playhead' }).focus();
		await page.keyboard.press('F2');
		await expect(title).toBeFocused();
		await title.fill('Opening');
		await title.press('Enter');
		const renamed = editor.getByRole('group', { name: 'Edit labels: Opening', exact: true });
		await expect(renamed).toBeVisible();
		await renamed.focus();
		await page.keyboard.press('F2');
		await expect(title).toBeFocused();
		await title.press('Escape');
		await chooseCommandAction(page, editor, 'Edit', 'Add label');
		await expect(title).toBeFocused();
		await title.fill('Verse');
		await title.press('Enter');
		await expect(editor.getByRole('group', { name: 'Edit labels: Verse', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('adding during playback creates a point at the live playhead despite the old range', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await selectTimeRange(page, editor, 24, 480);
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(48000);
		const before = await editor.locator('[data-playhead] .playhead-cursor__line').boundingBox();
		await page.keyboard.press('Control+b');
		const title = editor.getByRole('textbox', { name: /^Edit labels:/ });
		await expect(title).toBeFocused();
		await title.fill('Live cue');
		await title.press('Enter');
		const label = editor.getByRole('group', { name: 'Edit labels: Live cue', exact: true });
		await expect(label).toHaveAttribute('data-point-label', 'true');
		const stalk = await label.locator('.label-marker__stalk-line').boundingBox();
		expect(before).not.toBeNull();
		expect(stalk).not.toBeNull();
		expect(stalk.x).toBeGreaterThanOrEqual(before.x - 2);
		expect(stalk.x - before.x).toBeLessThan(48);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(errors).toEqual([]);
	});

	test('a label context menu renames and exposes all labeled audio edit variants', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await selectTimeRange(page, editor);
		await page.keyboard.press('Control+b');
		const title = editor.getByRole('textbox', { name: /^Edit labels:/ });
		await title.fill('Section');
		await title.press('Enter');
		const label = editor.getByRole('group', { name: 'Edit labels: Section', exact: true });
		await label.click({ button: 'right', position: { x: 12, y: 8 } });
		await page.getByRole('menuitem', { name: /^Edit labels/ }).click();
		await expect(title).toBeFocused();
		await title.fill('Edited section');
		await title.press('Enter');
		await editor.getByRole('slider', { name: 'Playhead' }).focus();
		await page.keyboard.press('F2');
		await expect(title).toBeFocused();
		await title.press('Escape');
		await editor.getByRole('group', { name: 'Edit labels: Edited section', exact: true })
			.click({ button: 'right', position: { x: 12, y: 8 } });
		await expect(page.getByRole('menuitem', { name: 'Delete label', exact: true })).toBeVisible();
		await page.getByRole('menuitem', { name: /^Labeled audio(?:\s|$)/ }).hover();
		for (const name of ['Cut', 'Delete', 'Cut and leave gap', 'Delete and leave gap', 'Silence audio', 'Copy', 'Split', 'Join', 'Detach at silences']) {
			await expect(page.getByRole('menuitem', { name, exact: true })).toBeEnabled();
		}
		await page.getByRole('menuitem', { name: 'Split', exact: true }).press('Enter');
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		await expect(editor.getByRole('textbox', { name: /^Edit labels:/ })).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('Add label remains available during recording and labels the live recording cursor', async ({ page }) => {
		await page.addInitScript(() => {
			const mediaDevices = {
				enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', groupId: 'fixture', label: 'Fixture microphone' }],
				getUserMedia: async () => {
					const context = new AudioContext();
					const destination = context.createMediaStreamDestination();
					const oscillator = context.createOscillator();
					oscillator.connect(destination);
					oscillator.start();
					await context.resume();
					const [track] = destination.stream.getAudioTracks();
					const getSettings = track.getSettings.bind(track);
					Object.defineProperty(track, 'getSettings', {
						configurable: true,
						value: () => ({ ...getSettings(), channelCount: destination.channelCount, sampleRate: context.sampleRate }),
					});
					return destination.stream;
				},
			};
			Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await selectTimeRange(page, editor, 24, 480);
		await page.keyboard.press('r');
		const record = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(48000);
		const liveFrame = Number(await playhead.getAttribute('aria-valuenow'));
		await chooseCommandAction(page, editor, 'Edit', 'Add label');
		const title = editor.getByRole('textbox', { name: /^Edit labels:/ });
		await expect(title).toBeFocused();
		await title.fill('Recording cue');
		await title.press('Enter');
		const label = editor.getByRole('group', { name: 'Edit labels: Recording cue', exact: true });
		await expect(label).toHaveAttribute('data-point-label', 'true');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(record).toHaveAttribute('aria-pressed', 'false');
		await expect(label).toBeVisible();
		await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
		const panel = editor.locator('[data-workspace-panel="labels"]');
		const cue = panel.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Delete label: Recording cue', exact: true }) });
		const startSeconds = Number(await cue.locator('[data-timecode-direct-entry]').first().inputValue());
		expect(startSeconds).toBeGreaterThanOrEqual(liveFrame / 48000 - 0.002);
		expect(errors).toEqual([]);
	});
});
