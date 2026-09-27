import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	closeDialog,
	collectClientErrors,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test.describe('Soundscaper punch and count-in recording', () => {
	registerAudioEditorHooks();

	test('uses the compound-meter map for an exact undoable punch', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		await page.addInitScript(() => {
			globalThis.__soundscaperRecorderSchedule = null;
			globalThis.__soundscaperBufferStarts = [];
			const nativeBufferStart = AudioBufferSourceNode.prototype.start;
			AudioBufferSourceNode.prototype.start = function observedBufferStart(when, ...rest) {
				globalThis.__soundscaperBufferStarts.push({
					when: Number(when) || 0,
					sampleRate: this.context.sampleRate,
				});
				return nativeBufferStart.call(this, when, ...rest);
			};
			const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
			Object.defineProperty(globalThis, 'AudioWorkletNode', {
				configurable: true,
				value: new Proxy(NativeAudioWorkletNode, {
					construct(Target, argumentsList) {
						const node = Reflect.construct(Target, argumentsList, Target);
						const [context, processorName] = argumentsList;
						if (processorName === 'kw-audio-recorder') {
							const nativePostMessage = node.port.postMessage.bind(node.port);
							node.port.postMessage = (message, transfer) => {
								if (message?.type === 'start') {
									globalThis.__soundscaperRecorderSchedule = {
										startFrame: message.startFrame,
										stopFrame: message.stopFrame,
										sampleRate: context.sampleRate,
									};
								}
								return transfer === undefined
									? nativePostMessage(message)
									: nativePostMessage(message, transfer);
							};
						}
						return node;
					},
				}),
			});
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					async getUserMedia() {
						const context = new AudioContext({ sampleRate: 48_000 });
						const oscillator = context.createOscillator();
						const gain = context.createGain();
						const destination = context.createMediaStreamDestination();
						oscillator.frequency.value = 440;
						gain.gain.value = 0.1;
						oscillator.connect(gain).connect(destination);
						oscillator.start();
						await context.resume();
						const [track] = destination.stream.getAudioTracks();
						const getSettings = track.getSettings.bind(track);
						Object.defineProperty(track, 'getSettings', {
							configurable: true,
							value: () => ({ ...getSettings(), channelCount: 1, sampleRate: 48_000, latency: 0 }),
						});
						return destination.stream;
					},
				},
			});
		});

		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/');
		await importFiles(editor, [longTone]);
		await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
		await editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true }).fill('120');
		await editor.getByRole('spinbutton', { name: 'Time signature: numerator', exact: true }).fill('6');
		const signatureDenominator = editor
			.getByRole('spinbutton', { name: 'Time signature: denominator', exact: true });
		await signatureDenominator.fill('8');
		// The toolbar fields commit their draft when focus leaves them.
		await signatureDenominator.blur();

		await chooseCommandAction(page, editor, 'Select', 'Select all');
		const timecodes = editor.locator('[data-selection-toolbar] .timecode');
		await timecodes.nth(0).locator('.timecode-digit').nth(5).click();
		await page.keyboard.press('3');
		await page.keyboard.press('Enter');
		await timecodes.nth(1).locator('.timecode-digit').nth(5).click();
		await page.keyboard.press('4');
		await timecodes.nth(1).locator('.timecode-digit').nth(6).click();
		await page.keyboard.type('000');
		await page.keyboard.press('Enter');
		await expect(timecodes.nth(0)).toContainText('03.000');
		await expect(timecodes.nth(1)).toContainText('04.000');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		const originalClips = await persistedAudioClips(page);
		expect(originalClips).toHaveLength(1);

		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		const leadIn = page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('checkbox', { name: 'Lead-in time', exact: true });
		await expect(leadIn).toBeVisible();
		await leadIn.check();
		await page.keyboard.press('Escape');

		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await record.click();
		await expect.poll(() => page.evaluate(() => globalThis.__soundscaperRecorderSchedule)).not.toBeNull();
		const observed = await page.evaluate(() => ({
			recorder: globalThis.__soundscaperRecorderSchedule,
			bufferStarts: globalThis.__soundscaperBufferStarts,
		}));
		const scheduledCaptureFrames = observed.recorder.stopFrame - observed.recorder.startFrame;
		// Capture includes browser-reported automatic I/O latency, which can vary
		// substantially under concurrent headless load. The persisted split below
		// proves that compensation is consumed without extending the exact punch.
		expect(scheduledCaptureFrames).toBeGreaterThanOrEqual(observed.recorder.sampleRate);
		const countInOffsets = observed.bufferStarts.map(({ when, sampleRate }) => (
			observed.recorder.startFrame - Math.ceil(when * sampleRate)
		));
		const compoundBarFrames = Math.round(observed.recorder.sampleRate * 1.5);
		// Firefox may clamp an AudioBufferSource start by one render quantum when
		// the main thread reaches the already-scheduled boundary.
		expect(countInOffsets.some((frames) => Math.abs(frames - compoundBarFrames) <= 128)).toBe(true);

		await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await expect.poll(() => persistedAudioClips(page)).toMatchObject([
			{ timelineStartFrame: 0, durationFrames: 144_000 },
			{ timelineStartFrame: 144_000, durationFrames: 48_000 },
			{ timelineStartFrame: 192_000 },
		]);
		const rendered = await exportWav(page, editor);
		expect(rendered.sampleRate).toBe(48_000);
		const beforePunch = measureWindow(rendered.samples, rendered.sampleRate, 2.0, 2.5);
		const insidePunch = measureWindow(rendered.samples, rendered.sampleRate, 3.25, 3.75);
		const afterPunch = measureWindow(rendered.samples, rendered.sampleRate, 4.5, 5.0);
		const signalEvidence = JSON.stringify({ beforePunch, insidePunch, afterPunch });
		for (const original of [beforePunch, afterPunch]) {
			expect(original.rms, signalEvidence).toBeGreaterThan(0.15);
			expect(original.at220Hz, signalEvidence).toBeGreaterThan(0.2);
			expect(original.at220Hz, signalEvidence).toBeGreaterThan(original.at440Hz * 20);
		}
		expect(insidePunch.rms, signalEvidence).toBeGreaterThan(0.04);
		expect(insidePunch.at440Hz, signalEvidence).toBeGreaterThan(0.06);
		expect(insidePunch.at440Hz, signalEvidence).toBeGreaterThan(insidePunch.at220Hz * 20);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-clip-id]')).toContainText(longTone.name);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await expect.poll(() => persistedAudioClips(page)).toEqual(originalClips);
		expect(errors).toEqual([]);
	});
});

async function exportWav(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '24-bit PCM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const downloadPromise = page.waitForEvent('download');
	await link.click();
	const rendered = readPcm24Wav(await downloadBytes(await downloadPromise));
	await closeDialog(dialog);
	return rendered;
}

function readPcm24Wav(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	expect(new TextDecoder('ascii').decode(bytes.subarray(0, 4))).toBe('RIFF');
	expect(new TextDecoder('ascii').decode(bytes.subarray(8, 12))).toBe('WAVE');
	let format = null;
	let audio = null;
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const id = new TextDecoder('ascii').decode(bytes.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		if (id === 'fmt ') format = bytes.subarray(offset + 8, offset + 8 + size);
		if (id === 'data') audio = bytes.subarray(offset + 8, offset + 8 + size);
		offset += 8 + size + (size & 1);
	}
	expect(format).not.toBeNull();
	expect(audio).not.toBeNull();
	const formatView = new DataView(format.buffer, format.byteOffset, format.byteLength);
	expect(formatView.getUint16(0, true)).toBe(1);
	const channelCount = formatView.getUint16(2, true);
	const sampleRate = formatView.getUint32(4, true);
	expect(formatView.getUint16(14, true)).toBe(24);
	const frameCount = audio.byteLength / (channelCount * 3);
	const samples = new Float32Array(frameCount);
	for (let frame = 0; frame < frameCount; frame += 1) {
		const offset = frame * channelCount * 3;
		let value = audio[offset] | (audio[offset + 1] << 8) | (audio[offset + 2] << 16);
		if (value & 0x80_0000) value |= 0xff00_0000;
		samples[frame] = value / 0x80_0000;
	}
	return { sampleRate, samples };
}

function measureWindow(samples, sampleRate, startSeconds, endSeconds) {
	const window = samples.subarray(
		Math.round(startSeconds * sampleRate),
		Math.round(endSeconds * sampleRate),
	);
	let squareSum = 0;
	for (const sample of window) squareSum += sample * sample;
	return {
		rms: Math.sqrt(squareSum / window.length),
		at220Hz: toneAmplitude(window, 220, sampleRate),
		at440Hz: toneAmplitude(window, 440, sampleRate),
	};
}

function toneAmplitude(samples, frequency, sampleRate) {
	let cosine = 0;
	let sine = 0;
	for (let frame = 0; frame < samples.length; frame += 1) {
		const angle = 2 * Math.PI * frequency * frame / sampleRate;
		cosine += samples[frame] * Math.cos(angle);
		sine += samples[frame] * Math.sin(angle);
	}
	return 2 * Math.hypot(cosine, sine) / samples.length;
}

async function persistedAudioClips(page) {
	return page.evaluate((databaseName) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction('projects', 'readonly').objectStore('projects').getAll();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				database.close();
				resolve((request.result[0]?.clips || [])
					.filter((clip) => clip.kind !== 'video')
					.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame));
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}
