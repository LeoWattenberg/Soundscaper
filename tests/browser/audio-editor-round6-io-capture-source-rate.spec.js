/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { expectCapturePhase, openRecordingSetup, selectSourceRoles } from './helpers/framescaper-capture-harness.js';

test.use({ launchOptions: { firefoxUserPrefs: {
	'media.navigator.streams.fake': true,
	'media.navigator.permission.disabled': true,
} } });

for (const sampleRate of [44_100, 48_000]) {
	test(`Recording setup monitors a native microphone requested at ${sampleRate} Hz`, async ({ page, browserName }) => {
		await page.addInitScript(({ rate, nativeMicrophone }) => {
			window.__nativeCaptureChunks = 0;
			const NativeAudioWorkletNode = AudioWorkletNode;
			window.AudioWorkletNode = class extends NativeAudioWorkletNode {
				constructor(context, name, options) {
					super(context, name, options);
					if (name !== 'kw-audio-recorder') return;
					window.__nativeCaptureGridRate = context.sampleRate;
					this.port.addEventListener('message', ({ data }) => {
						if (data.type === 'audio-chunk') window.__nativeCaptureChunks++;
					});
					this.port.start();
				}
			};
			const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
			Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
				configurable: true,
				value: async constraints => {
					if (nativeMicrophone) {
						const stream = await nativeGetUserMedia({ ...constraints, audio: {
							...(typeof constraints.audio === 'object' ? constraints.audio : {}),
							sampleRate: { exact: rate }, channelCount: { exact: 1 },
						} });
						window.__nativeCaptureSettings = stream.getAudioTracks()[0].getSettings();
						return stream;
					}
					const context = new AudioContext({ sampleRate: rate });
					const oscillator = context.createOscillator();
					const gain = context.createGain();
					const output = context.createMediaStreamDestination();
					oscillator.frequency.value = 220;
					gain.gain.value = 0.2;
					oscillator.connect(gain).connect(output);
					oscillator.start();
					await context.resume();
					window.__nativeCaptureMicrophone = { context, oscillator, gain, output };
					window.__nativeCaptureSettings = output.stream.getAudioTracks()[0].getSettings();
					return output.stream;
				},
			});
			Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
				configurable: true,
				value: async () => [{ deviceId: 'default', kind: 'audioinput', label: 'Microphone' }],
			});
		}, { rate: sampleRate, nativeMicrophone: browserName === 'firefox' });
		const editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		const panel = await openRecordingSetup(page, editor);
		if (!await page.evaluate(() => typeof navigator.mediaDevices?.getDisplayMedia === 'function')) {
			await expect(panel.getByRole('status')).toContainText('Capture is unavailable in this runtime');
			await expect(panel.getByRole('button', { name: 'Preview sources', exact: true })).toHaveCount(0);
			return;
		}
		await selectSourceRoles(panel, ['microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).click();
		await expectCapturePhase(panel, 'previewing');
		const nativeRate = await page.evaluate(() => window.__nativeCaptureSettings.sampleRate);
		if (browserName === 'firefox') expect(nativeRate).toBeUndefined();
		else expect(nativeRate).toBe(sampleRate);
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await panel.getByRole('checkbox', { name: 'Monitor microphone', exact: true }).check();
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).click();
		await expectCapturePhase(panel, 'armed');
		await panel.getByRole('button', { name: 'Start capture', exact: true }).click();
		await expectCapturePhase(panel, 'recording');
		await expect.poll(() => page.evaluate(() => window.__nativeCaptureChunks)).toBeGreaterThanOrEqual(3);
		await panel.getByRole('button', { name: 'Stop and import', exact: true }).click();
		await expectCapturePhase(panel, 'inactive', 30_000);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const saved = await page.evaluate(async ({ databaseName, id }) => {
			const read = request => new Promise((resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const database = await read(indexedDB.open(databaseName));
			try { return await read(database.transaction('projects', 'readonly').objectStore('projects').get(id)); }
			finally { database.close(); }
		}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
		expect(saved.sources).toHaveLength(1);
		const gridRate = await page.evaluate(() => window.__nativeCaptureGridRate);
		expect(saved.sources[0].sampleRate).toBe(gridRate);
		if (nativeRate !== undefined) expect(gridRate).toBe(nativeRate);
		expect(saved.sources[0].frameCount).toBeGreaterThan(4096);
		expect(saved.projectBin.clips).toHaveLength(1);
	});
}
