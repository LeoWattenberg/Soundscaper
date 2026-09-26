import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('audio editor timed recording', () => {
	registerAudioEditorHooks();

	test('keeps a countdown toast through the scheduled and active recording phases', async ({ page }) => {
		test.setTimeout(40_000);
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					enumerateDevices: async () => [],
					getUserMedia: async () => {
						const context = new AudioContext({ sampleRate: 48_000 });
						const source = context.createOscillator();
						const destination = context.createMediaStreamDestination();
						source.connect(destination);
						source.start();
						await context.resume();
						globalThis.__timedInputContext = context;
						return destination.stream;
					},
				},
			});
		});
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Timed recording', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
		const dateTimes = dialog.locator('input[type="datetime-local"]');
		const start = new Date(Date.now() + 12_000);
		const localInputValue = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
			.toISOString().slice(0, 19).replace(/:00$/, '');
		await dateTimes.first().fill(localInputValue(start));
		await dialog.getByRole('radio', { name: 'End date and time', exact: true }).check();
		await dateTimes.nth(1).fill(localInputValue(new Date(start.getTime() + 8_000)));
		await dialog.getByRole('button', { name: 'Schedule recording', exact: true }).click();
		const scheduled = editor.getByRole('region', { name: /Recording is scheduled for/u });
		await expect(scheduled).toBeVisible();
		await expect(dialog).toBeHidden();
		await expect(scheduled.getByRole('timer')).toContainText('Recording start:');
		await expect(scheduled.getByRole('button', { name: 'Cancel scheduled recording' })).toBeVisible();
		await expect(editor.locator('[data-status]')).not.toContainText('Recording scheduled');
		const firstCountdown = await scheduled.getByRole('timer').textContent();
		await expect.poll(() => scheduled.getByRole('timer').textContent()).not.toBe(firstCountdown);
		const active = editor.getByRole('region', { name: 'Recording', exact: true });
		await expect(active).toBeVisible({ timeout: 20_000 });
		await expect(active.getByRole('timer')).toContainText('Recording end:');
		await expect(scheduled).toBeHidden();
		await expect(active).toBeHidden({ timeout: 15_000 });
	});

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
