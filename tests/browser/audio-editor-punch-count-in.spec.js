import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Soundscaper punch and count-in recording', () => {
	registerAudioEditorHooks();

	test('uses the compound-meter map for an exact undoable punch', async ({ page }) => {
		test.setTimeout(45_000);
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
		await editor.getByRole('spinbutton', { name: 'Time signature: denominator', exact: true }).fill('8');

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
		const leadIn = page.getByRole('menu', { name: 'Record options', exact: true })
			.getByRole('menuitem', { name: 'Enable lead-in time', exact: true });
		await expect(leadIn).toBeVisible();
		await leadIn.click();

		const record = editor.getByRole('button', { name: 'Record onto the active track', exact: true });
		await record.click();
		await expect.poll(() => page.evaluate(() => globalThis.__soundscaperRecorderSchedule)).not.toBeNull();
		const observed = await page.evaluate(() => ({
			recorder: globalThis.__soundscaperRecorderSchedule,
			bufferStarts: globalThis.__soundscaperBufferStarts,
		}));
		const scheduledCaptureFrames = observed.recorder.stopFrame - observed.recorder.startFrame;
		expect(scheduledCaptureFrames).toBeGreaterThanOrEqual(observed.recorder.sampleRate);
		expect(scheduledCaptureFrames).toBeLessThanOrEqual(observed.recorder.sampleRate * 1.25);
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
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-clip-id]')).toContainText(longTone.name);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await expect.poll(() => persistedAudioClips(page)).toEqual(originalClips);
		expect(errors).toEqual([]);
	});
});

async function persistedAudioClips(page) {
	return page.evaluate(() => new Promise((resolve, reject) => {
		const open = indexedDB.open('kw-media-audio-editor');
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
	}));
}
