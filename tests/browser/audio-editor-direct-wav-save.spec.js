import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	collectClientErrors,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const CHANNEL_COUNT = 32;
const DURATION_SECONDS = 16.5;
const FRAME_COUNT = 792_000;
const SAMPLE_RATE = 48_000;

test.describe('direct WAV File System Access publication', () => {
	registerAudioEditorHooks();

	test('streams and validates WAV bytes without Blob fallback, then rolls back cancellation', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectClientErrors(page);
		let downloads = 0;
		page.on('download', () => { downloads += 1; });
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'userAgentData', {
				configurable: true,
				value: Object.freeze({ mobile: true }),
			});
		});
		const editor = await bootEditor(page, '/embed/en/');
		expect(await page.evaluate(() => navigator.userAgentData?.mobile)).toBe(true);
		await importFiles(editor, [createThresholdTone()]);
		await installDirectWavTarget(page);

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
		await expect(exportDialog.locator('[data-export-field="sampleRate"] input')).toHaveValue('48000');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="channelMapping"]'), 'Custom channel mapping');
		await exportDialog.getByRole('textbox', { name: /^Custom channel mapping JSON matrix/ })
			.fill(JSON.stringify(Array.from({ length: CHANNEL_COUNT }, () => 0)));
		await chooseDropdown(page, exportDialog.locator('[data-export-field="dither"]'), 'None');
		expect(FRAME_COUNT * CHANNEL_COUNT * 4).toBeGreaterThan(96 * 1024 ** 2);

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect(editor.getByText('Large project: rendering in realtime to conserve memory', { exact: true })).toBeVisible();
		await expect.poll(() => page.evaluate(() => globalThis.__directWavSave.sessions[0]?.closes || 0), {
			timeout: 45_000,
		}).toBe(1);
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible();
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();

		const saved = await inspectDirectWavTarget(page, 0);
		expect(saved.opens).toBe(1);
		expect(saved.closes).toBe(1);
		expect(saved.aborts).toBe(0);
		expect(saved.maxConcurrentWrites).toBe(1);
		expect(saved.writeCalls).toBeGreaterThan(1);
		expect(saved.maximumWriteBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
		expect(saved.nonzeroPcmBytes).toBeGreaterThan(0);
		expect(saved.header).toMatchObject({
			bitsPerSample: 16,
			blockAlign: 64,
			byteRate: 3_072_000,
			channelCount: CHANNEL_COUNT,
			dataId: 'data',
			formatBytes: 16,
			formatId: 'fmt ',
			formatTag: 1,
			riffId: 'RIFF',
			sampleRate: SAMPLE_RATE,
			waveId: 'WAVE',
		});
		const renderedFrames = saved.header.dataBytes / saved.header.blockAlign;
		expect(Number.isInteger(renderedFrames)).toBe(true);
		expect(renderedFrames).toBeGreaterThanOrEqual(FRAME_COUNT - 1);
		expect(renderedFrames).toBeLessThanOrEqual(FRAME_COUNT);
		expect(renderedFrames * CHANNEL_COUNT * 4).toBeGreaterThan(96 * 1024 ** 2);
		expect(saved.riffBytes).toBe(saved.totalBytes);
		expect(saved.totalBytes).toBeGreaterThanOrEqual(44 + saved.header.dataBytes);
		expect(saved.pickerOptions.suggestedName).toMatch(/\.wav$/iu);
		expect(saved.pickerOptions.types[0].accept['audio/wav']).toEqual(['.wav']);
		expect(saved.objectUrls).toEqual([]);
		expect(downloads).toBe(0);

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__directWavSave.sessions[1]?.totalBytes || 0), {
			timeout: 15_000,
		}).toBeGreaterThan(44);
		await exportDialog.getByRole('button', { name: 'Cancel export' }).click();
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible({ timeout: 15_000 });
		const cancelled = await inspectDirectWavTarget(page, 1);
		expect(cancelled.opens).toBe(1);
		expect(cancelled.closes).toBe(0);
		expect(cancelled.aborts).toBe(1);
		expect(cancelled.totalBytes).toBeGreaterThan(44);
		expect(cancelled.totalBytes).toBeLessThan(saved.totalBytes);
		expect(cancelled.objectUrls).toEqual([]);
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();
		expect(downloads).toBe(0);
		expect(errors).toEqual([]);
	});
});

function createThresholdTone() {
	const channelCount = 2;
	const bytesPerSample = 2;
	const dataBytes = FRAME_COUNT * channelCount * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataBytes);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataBytes, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(SAMPLE_RATE, 24);
	buffer.writeUInt32LE(SAMPLE_RATE * channelCount * bytesPerSample, 28);
	buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataBytes, 40);
	for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const sample = Math.sin(2 * Math.PI * 220 * frame / SAMPLE_RATE + channel * Math.PI / 3) * 0.3;
			buffer.writeInt16LE(Math.round(sample * 32767), 44 + (frame * channelCount + channel) * bytesPerSample);
		}
	}
	return { name: `direct-threshold-${DURATION_SECONDS}.wav`, mimeType: 'audio/wav', buffer };
}

async function installDirectWavTarget(page) {
	await page.evaluate(() => {
		const createObjectUrl = URL.createObjectURL.bind(URL);
		globalThis.__directWavSave = {
			objectUrls: [],
			pickerOptions: null,
			sessions: [],
		};
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value(blob) {
				globalThis.__directWavSave.objectUrls.push({ size: blob.size, type: blob.type });
				return createObjectUrl(blob);
			},
		});
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async (options) => {
				globalThis.__directWavSave.pickerOptions = options;
				return {
					name: 'direct-browser-mix.wav',
					async createWritable() {
						const session = {
							aborts: 0,
							activeWrites: 0,
							closes: 0,
							maxConcurrentWrites: 0,
							maximumWriteBytes: 0,
							nonzeroPcmBytes: 0,
							opens: 1,
							prefix: new Uint8Array(128),
							prefixBytes: 0,
							totalBytes: 0,
							writeCalls: 0,
						};
						globalThis.__directWavSave.sessions.push(session);
						return {
							async write(chunk) {
								if (!(chunk instanceof Uint8Array)) throw new TypeError('Expected WAV bytes.');
								session.activeWrites += 1;
								session.maxConcurrentWrites = Math.max(session.maxConcurrentWrites, session.activeWrites);
								session.maximumWriteBytes = Math.max(session.maximumWriteBytes, chunk.byteLength);
								session.writeCalls += 1;
								const prefixBytes = Math.min(chunk.byteLength, session.prefix.length - session.prefixBytes);
								if (prefixBytes > 0) {
									session.prefix.set(chunk.subarray(0, prefixBytes), session.prefixBytes);
									session.prefixBytes += prefixBytes;
								}
								for (let index = Math.max(0, 44 - session.totalBytes); index < chunk.byteLength; index += 1) {
									if (chunk[index] !== 0) session.nonzeroPcmBytes += 1;
								}
								session.totalBytes += chunk.byteLength;
								await Promise.resolve();
								session.activeWrites -= 1;
							},
							async close() { session.closes += 1; },
							async abort() { session.aborts += 1; },
						};
					},
				};
			},
		});
	});
}

async function inspectDirectWavTarget(page, sessionIndex) {
	return page.evaluate((index) => {
		const state = globalThis.__directWavSave;
		const session = state.sessions[index];
		const prefix = session.prefix.subarray(0, session.prefixBytes);
		const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
		const ascii = (offset) => String.fromCharCode(...prefix.subarray(offset, offset + 4));
		return {
			...session,
			header: {
				riffId: ascii(0),
				waveId: ascii(8),
				formatId: ascii(12),
				formatBytes: view.getUint32(16, true),
				formatTag: view.getUint16(20, true),
				channelCount: view.getUint16(22, true),
				sampleRate: view.getUint32(24, true),
				byteRate: view.getUint32(28, true),
				blockAlign: view.getUint16(32, true),
				bitsPerSample: view.getUint16(34, true),
				dataId: ascii(36),
				dataBytes: view.getUint32(40, true),
			},
			objectUrls: state.objectUrls,
			pickerOptions: state.pickerOptions,
			riffBytes: view.getUint32(4, true) + 8,
			prefix: undefined,
		};
	}, sessionIndex);
}
