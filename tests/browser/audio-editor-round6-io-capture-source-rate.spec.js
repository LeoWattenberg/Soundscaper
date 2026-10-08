/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { expectCapturePhase, openRecordingSetup, selectSourceRoles } from './helpers/framescaper-capture-harness.js';

for (const sampleRate of [44_100, 48_000]) {
	test(`Recording setup monitors and captures a native ${sampleRate} Hz microphone`, async ({ page }) => {
		await page.addInitScript(({ rate }) => {
			window.__nativeCaptureChunks = 0;
			const NativeAudioWorkletNode = AudioWorkletNode;
			window.AudioWorkletNode = class extends NativeAudioWorkletNode {
				constructor(context, name, options) {
					super(context, name, options);
					if (name !== 'kw-audio-recorder') return;
					this.port.addEventListener('message', ({ data }) => {
						if (data.type === 'audio-chunk') window.__nativeCaptureChunks++;
					});
					this.port.start();
				}
			};
			Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
				configurable: true,
				value: async () => {
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
		}, { rate: sampleRate });
		const editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		const panel = await openRecordingSetup(page, editor);
		await selectSourceRoles(panel, ['microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).click();
		await expectCapturePhase(panel, 'previewing');
		expect(await page.evaluate(() => window.__nativeCaptureSettings.sampleRate)).toBe(sampleRate);
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
		expect(saved.sources[0].sampleRate).toBe(sampleRate);
		expect(saved.sources[0].frameCount).toBeGreaterThan(4096);
		expect(saved.projectBin.clips).toHaveLength(1);
	});
}
