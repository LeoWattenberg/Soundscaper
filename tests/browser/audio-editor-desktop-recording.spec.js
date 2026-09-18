import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

async function installDesktopCapture(page) {
	await page.addInitScript(() => {
		window.__desktopMicrophoneRequests = 0;
		window.__desktopDisplayRequests = 0;
		window.__desktopDisplayConstraints = null;
		window.__desktopCaptureOutcome = 'audio';
		Object.defineProperty(window, 'CaptureController', {
			configurable: true,
			value: class {
				setFocusBehavior(behavior) { this.focusBehavior = behavior; }
			},
		});
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: {
				enumerateDevices: async () => [],
				getUserMedia: async () => {
					window.__desktopMicrophoneRequests += 1;
					throw new DOMException('Microphone access denied', 'NotAllowedError');
				},
				getDisplayMedia: async (options) => {
					window.__desktopDisplayRequests += 1;
					window.__desktopDisplayConstraints = options;
					window.__desktopFocusBehavior = options.controller?.focusBehavior;
					window.dispatchEvent(new Event('blur'));
					await new Promise((resolve) => setTimeout(resolve, 20));
					if (window.__desktopCaptureOutcome === 'failure') {
						throw new DOMException('Could not start audio source', 'NotReadableError');
					}
					const context = new AudioContext();
					const destination = context.createMediaStreamDestination();
					const merger = context.createChannelMerger(2);
					for (let channel = 0; channel < 2; channel += 1) {
						const oscillator = context.createOscillator();
						const gain = context.createGain();
						oscillator.frequency.value = 330 + channel * 220;
						gain.gain.value = 0.2;
						oscillator.connect(gain).connect(merger, 0, channel);
						oscillator.start();
					}
					merger.connect(destination);
					const canvas = document.createElement('canvas');
					canvas.getContext('2d').fillRect(0, 0, 1, 1);
					const [video] = canvas.captureStream().getVideoTracks();
					destination.stream.addTrack(video);
					await context.resume();
					if (window.__desktopCaptureOutcome === 'video-only') {
						for (const audio of destination.stream.getAudioTracks()) {
							destination.stream.removeTrack(audio);
							audio.stop();
						}
					}
					window.__desktopStream = destination.stream;
					return destination.stream;
				},
			},
		});
	});
}

test.describe('desktop audio recording', () => {
	registerAudioEditorHooks();

	test('records stereo desktop audio from Audio setup without microphone access', async ({ page }) => {
		await installDesktopCapture(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
		const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		await setup.getByRole('combobox', { name: 'Microphone', exact: true }).selectOption('display');
		expect(await page.evaluate(() => window.__desktopDisplayRequests)).toBe(0);
		await setup.getByRole('button', { name: 'Choose display source', exact: true }).click();
		await expect(setup.getByRole('button', { name: 'Choose a different display source', exact: true })).toBeVisible();
		await setup.getByRole('radio', { name: 'Stereo', exact: true }).check();
		await page.keyboard.press('Escape');
		const record = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(async () => Number(await editor.getByRole('meter', { name: 'Input level', exact: true })
			.getAttribute('aria-valuenow'))).toBeGreaterThan(-40);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(record).toHaveAttribute('aria-pressed', 'false');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		expect(await page.evaluate(() => window.__desktopDisplayConstraints)).toMatchObject({
			audio: true,
			video: true,
			selfBrowserSurface: 'exclude',
			systemAudio: 'include',
			windowAudio: 'system',
		});
		await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
		const reopenedSetup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		const releaseInputButton = reopenedSetup.getByRole('button', { name: 'Disable microphones', exact: true });
		await releaseInputButton.click();
		await expect(releaseInputButton).toHaveCount(0);
		expect(await page.evaluate(() => window.__desktopStream.getTracks()
		.every((track) => track.readyState === 'ended'))).toBe(true);
		expect(await page.evaluate(() => window.__desktopMicrophoneRequests)).toBe(0);
		expect(await page.evaluate(() => window.__desktopDisplayRequests)).toBe(1);
	});

	test('Record requests desktop sharing and starts after the permission handoff', async ({ page }) => {
		await installDesktopCapture(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
		const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		await setup.getByRole('combobox', { name: 'Microphone', exact: true }).selectOption('display');
		await setup.getByRole('radio', { name: 'Stereo', exact: true }).check();
		await page.keyboard.press('Escape');
		const record = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		expect(await page.evaluate(() => window.__desktopFocusBehavior)).toBe('no-focus-change');
		await expect.poll(async () => Number(await editor.getByRole('meter', { name: 'Input level', exact: true })
			.getAttribute('aria-valuenow'))).toBeGreaterThan(-40);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		expect(await page.evaluate(() => window.__desktopMicrophoneRequests)).toBe(0);
		expect(await page.evaluate(() => window.__desktopDisplayRequests)).toBe(1);
	});

	for (const outcome of ['failure', 'video-only']) {
		test(`desktop sharing reports ${outcome} and can retry recording`, async ({ page }) => {
			await installDesktopCapture(page);
			const editor = await bootEditor(page, '/embed/en/');
			await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
			const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
			await setup.getByRole('combobox', { name: 'Microphone', exact: true }).selectOption('display');
			await page.keyboard.press('Escape');
			await page.evaluate((next) => { window.__desktopCaptureOutcome = next; }, outcome);
			const record = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
			await record.click();
			await expect(editor.locator('[data-editor-toast="workspace-error"]')
				.getByText(outcome === 'failure'
				? 'The action failed: Could not start audio source'
				: 'The action failed: Display capture did not provide an audio track. Firefox does not support browser audio capture; use Chrome or Edge and enable Share audio.', { exact: true })).toBeVisible();
			await expect(record).toHaveAttribute('aria-pressed', 'false');
			await expect(editor).toHaveAttribute('data-clip-count', '0');
			if (outcome === 'video-only') {
				expect(await page.evaluate(() => window.__desktopStream.getTracks()
					.every((track) => track.readyState === 'ended'))).toBe(true);
			}
			await page.evaluate(() => { window.__desktopCaptureOutcome = 'audio'; });
			await record.click();
			await expect(record).toHaveAttribute('aria-pressed', 'true');
			await expect.poll(async () => Number(await editor.getByRole('meter', { name: 'Input level', exact: true })
				.getAttribute('aria-valuenow'))).toBeGreaterThan(-40);
			await editor.getByRole('button', { name: 'Stop', exact: true }).click();
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			expect(await page.evaluate(() => window.__desktopMicrophoneRequests)).toBe(0);
			expect(await page.evaluate(() => window.__desktopDisplayRequests)).toBe(2);
		});
	}

});
