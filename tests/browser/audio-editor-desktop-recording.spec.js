import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('desktop audio recording', () => {
	registerAudioEditorHooks();

	test('records stereo desktop audio from Audio setup without microphone access', async ({ page }) => {
		await page.addInitScript(() => {
			window.__desktopMicrophoneRequests = 0;
			window.__desktopDisplayRequests = 0;
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					enumerateDevices: async () => [],
					getUserMedia: async () => {
						window.__desktopMicrophoneRequests += 1;
						throw new DOMException('Microphone access denied', 'NotAllowedError');
					},
					getDisplayMedia: async () => {
						window.__desktopDisplayRequests += 1;
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
						return destination.stream;
					},
				},
			});
		});
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
		expect(await page.evaluate(() => window.__desktopMicrophoneRequests)).toBe(0);
		expect(await page.evaluate(() => window.__desktopDisplayRequests)).toBe(1);
	});
});
