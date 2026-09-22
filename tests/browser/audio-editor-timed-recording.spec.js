import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	getMenuItem,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('audio editor timed recording', () => {
	registerAudioEditorHooks();

	test('offers linked duration and end-date controls in a reachable workflow', async ({ page }) => {
		await page.addInitScript(() => {
			globalThis.__timedInputRequests = 0;
			globalThis.__timedInputTrackStopped = false;
			let readyState = 'live';
			const track = new EventTarget();
			Object.defineProperties(track, {
				kind: { value: 'audio' },
				readyState: { get: () => readyState },
				getSettings: { value: () => ({ channelCount: 1, sampleRate: 48_000 }) },
				stop: { value: () => {
					if (readyState === 'ended') return;
					readyState = 'ended';
					globalThis.__timedInputTrackStopped = true;
					track.dispatchEvent(new Event('ended'));
				} },
			});
			const stream = {
				getAudioTracks: () => [track],
				getTracks: () => [track],
			};
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					enumerateDevices: async () => [],
					getUserMedia: () => {
						globalThis.__timedInputRequests += 1;
						return new Promise((resolve) => {
							globalThis.__resolveTimedInput = () => resolve(stream);
						});
					},
				},
			});
		});
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await getMenuItem(
			page.getByRole('menu', { name: 'Record options', exact: true }),
			'Set up timed recording',
		).click();
		const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).not.toContainText('opens the recording input immediately');
		const dateTimes = dialog.locator('input[type="datetime-local"]');
		await expect(dateTimes).toHaveCount(2);
		await expect(dateTimes.first()).toHaveValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/);
		const duration = dialog.getByRole('radio', { name: 'Duration', exact: true });
		const endDate = dialog.getByRole('radio', { name: 'End date and time', exact: true });
		const durationInput = dialog.locator('[data-timecode-input="seconds"]');
		const headingStyle = async (name) => dialog.getByText(name, { exact: true }).evaluate((element) => {
			const style = getComputedStyle(element);
			return [style.fontSize, style.fontWeight, style.color];
		});
		await expect(await headingStyle('Recording start')).toEqual(await headingStyle('Recording end'));
		const controlStyle = async (locator) => locator.evaluate((element) => {
			const style = getComputedStyle(element);
			const bounds = element.getBoundingClientRect();
			return { height: bounds.height, background: style.backgroundColor, border: style.borderColor,
				radius: style.borderRadius };
		});
		await expect(await controlStyle(dateTimes.first())).toEqual(await controlStyle(dateTimes.nth(1)));
		await expect(await controlStyle(dateTimes.nth(1))).toEqual(await controlStyle(durationInput));
		const valueStyle = async (locator) => locator.evaluate((element) => {
			const style = getComputedStyle(element);
			return [style.backgroundColor, style.color, style.fontSize];
		});
		await expect(await valueStyle(durationInput.locator('.timecode-digit').first()))
			.toEqual(await valueStyle(dateTimes.first()));
		await expect(duration).toBeChecked();
		await expect(endDate).not.toBeChecked();
		await expect(durationInput).toBeVisible();
		await expect(dateTimes.nth(1)).toBeDisabled();
		await endDate.check();
		await expect(dateTimes.nth(1)).toBeEnabled();
		await expect(durationInput.locator('[data-timecode-direct-entry="true"]')).toBeDisabled();
		await dialog.getByRole('button', { name: 'Schedule recording', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__timedInputRequests)).toBe(1);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor.locator('[data-status]')).toContainText('Scheduled recording cancelled');
		await page.evaluate(() => globalThis.__resolveTimedInput());
		await expect.poll(() => page.evaluate(() => globalThis.__timedInputTrackStopped)).toBe(true);
		await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button')).toHaveAttribute('aria-pressed', 'false');
	});
});
