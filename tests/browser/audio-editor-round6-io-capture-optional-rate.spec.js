/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { expectCapturePhase, openRecordingSetup, selectSourceRoles } from './helpers/framescaper-capture-harness.js';

test.use({ launchOptions: { firefoxUserPrefs: {
	'media.navigator.streams.fake': true,
	'media.navigator.permission.disabled': true,
} } });

test('Recording setup captures native microphones with an optional hardware sample rate', async ({ page, browserName }) => {
	await page.addInitScript(({ nativeMicrophone }) => {
		window.__nativeMicrophonePcm = { frames: 0, chunks: 0, peak: 0, sampleRate: null };
		const NativeAudioWorkletNode = AudioWorkletNode;
		window.AudioWorkletNode = class extends NativeAudioWorkletNode {
			constructor(context, name, options) {
				super(context, name, options);
				if (name !== 'kw-audio-recorder') return;
				window.__nativeMicrophonePcm.sampleRate = context.sampleRate;
				this.port.addEventListener('message', ({ data }) => {
					if (data.type !== 'audio-chunk') return;
					const capture = window.__nativeMicrophonePcm;
					capture.frames += data.frames;
					capture.chunks++;
					for (const value of new Float32Array(data.channels[0])) capture.peak = Math.max(capture.peak, Math.abs(value));
				});
				this.port.start();
			}
		};
		const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
			let stream;
			if (nativeMicrophone) stream = await nativeGetUserMedia(constraints);
			else {
				const context = new AudioContext({ sampleRate: 48_000 });
				const oscillator = context.createOscillator();
				const output = context.createMediaStreamDestination();
				oscillator.frequency.value = 220;
				oscillator.connect(output);
				oscillator.start();
				await context.resume();
				window.__nativeMicrophoneSource = { context, oscillator, output };
				stream = output.stream;
			}
			window.__nativeMicrophoneSettings = stream.getAudioTracks()[0].getSettings();
			return stream;
		} });
	}, { nativeMicrophone: browserName === 'firefox' });
	const editor = await bootEditor(page, '/framescaper/en/');
	const projectId = await editor.getAttribute('data-project-id');
	const panel = await openRecordingSetup(page, editor);
	if (!await page.evaluate(() => typeof navigator.mediaDevices?.getDisplayMedia === 'function')) {
		// The existing capture policy explicitly requires the full video stack.
		await expect(panel.getByRole('status')).toContainText('Capture is unavailable in this runtime');
		await expect(panel.getByRole('button', { name: 'Preview sources', exact: true })).toHaveCount(0);
		return;
	}
	await selectSourceRoles(panel, ['microphone']);
	await panel.getByRole('button', { name: 'Preview sources', exact: true }).click();
	await expectCapturePhase(panel, 'previewing');
	const settings = await page.evaluate(() => window.__nativeMicrophoneSettings);
	if (browserName === 'firefox') {
		expect(settings.sampleRate).toBeUndefined();
		expect(settings.channelCount).toBe(1);
	} else expect(settings.sampleRate).toBe(48_000);
	await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
	await panel.getByRole('checkbox', { name: 'Monitor microphone', exact: true }).check();
	await panel.getByRole('button', { name: 'Arm capture', exact: true }).click();
	await expectCapturePhase(panel, 'armed');
	await panel.getByRole('button', { name: 'Start capture', exact: true }).click();
	await expectCapturePhase(panel, 'recording');
	await expect.poll(() => page.evaluate(() => window.__nativeMicrophonePcm.chunks)).toBeGreaterThanOrEqual(3);
	await panel.getByRole('button', { name: 'Stop and import', exact: true }).click();
	await expectCapturePhase(panel, 'inactive', 30_000);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const capture = await page.evaluate(() => window.__nativeMicrophonePcm);
	expect(capture.peak).toBeGreaterThan(.01);
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
	expect(saved.sources[0].sampleRate).toBe(capture.sampleRate);
	expect(saved.sources[0].channelCount).toBe(settings.channelCount);
	expect(saved.sources[0].frameCount).toBe(capture.frames);
	expect(saved.projectBin.clips).toHaveLength(1);
});
