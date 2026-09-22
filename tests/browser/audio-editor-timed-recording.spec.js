import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('audio editor timed recording', () => {
	registerAudioEditorHooks();

	test('offers linked duration and end-date controls in a reachable workflow', async ({ page }) => {
		await page.addInitScript(() => {
			globalThis.__timedInputRequests = 0;
			globalThis.__timedInputTrackStopped = false;
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					enumerateDevices: async () => [],
					getUserMedia: () => {
						globalThis.__timedInputRequests += 1;
						const context = new AudioContext();
						const destination = context.createMediaStreamDestination();
						const oscillator = context.createOscillator();
						oscillator.connect(destination);
						oscillator.start();
						void context.resume().catch(() => undefined);
						const [track] = destination.stream.getAudioTracks();
						const nativeStop = track.stop.bind(track);
						const nativeGetSettings = track.getSettings.bind(track);
						Object.defineProperties(track, {
							getSettings: { configurable: true, value: () => ({ ...nativeGetSettings(),
								channelCount: destination.channelCount, sampleRate: context.sampleRate }) },
							stop: { configurable: true, value: () => {
								if (track.readyState === 'ended') return;
								globalThis.__timedInputTrackStopped = true;
								nativeStop();
								oscillator.stop();
								void context.close().catch(() => undefined);
							} },
						});
						return new Promise((resolve) => {
							globalThis.__resolveTimedInput = () => resolve(destination.stream);
						});
					},
				},
			});
		});
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Timed recording', exact: true }).click();
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
		await page.evaluate(() => globalThis.__resolveTimedInput());
		await expect(dialog).toBeHidden();
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Timed recording', exact: true }).click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel scheduled recording', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor.locator('[data-status]')).toContainText('Scheduled recording cancelled');
		await expect.poll(() => page.evaluate(() => globalThis.__timedInputTrackStopped)).toBe(true);
		await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button')).toHaveAttribute('aria-pressed', 'false');
	});
});
