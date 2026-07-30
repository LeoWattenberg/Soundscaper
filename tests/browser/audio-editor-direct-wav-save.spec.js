import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	collectClientErrors,
	commitInput,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const CHANNEL_COUNT = 32;
const DURATION_SECONDS = 16.5;
const FRAME_COUNT = 792_000;
const SAMPLE_RATE = 48_000;
const RETAINED_PREFIX_BYTES = 2 * 1024;

test.describe('direct native PCM File System Access publication', () => {
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
		await installDirectPcmTarget(page, { fileName: 'direct-browser-mix.wav', pcmOffset: 44 });

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
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[0]?.closes || 0), {
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
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[1]?.totalBytes || 0), {
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

	test('streams and validates AIFF bytes without Blob fallback, then rolls back cancellation', async ({ page }) => {
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
		await installDirectPcmTarget(page, { fileName: 'direct-browser-mix.aiff', pcmOffset: 54 });

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'AIFF');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
		await expect(exportDialog.locator('[data-export-field="sampleRate"] input')).toHaveValue('48000');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="channelMapping"]'), 'Custom channel mapping');
		await exportDialog.getByRole('textbox', { name: /^Custom channel mapping JSON matrix/ })
			.fill(JSON.stringify(Array.from({ length: CHANNEL_COUNT }, () => 0)));
		await chooseDropdown(page, exportDialog.locator('[data-export-field="dither"]'), 'None');
		expect(FRAME_COUNT * CHANNEL_COUNT * 4).toBeGreaterThan(96 * 1024 ** 2);

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect(editor.getByText('Large project: rendering in realtime to conserve memory', { exact: true })).toBeVisible();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[0]?.closes || 0), {
			timeout: 45_000,
		}).toBe(1);
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible();
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();

		const saved = await inspectDirectAiffTarget(page, 0);
		expect(saved.opens).toBe(1);
		expect(saved.closes).toBe(1);
		expect(saved.aborts).toBe(0);
		expect(saved.maxConcurrentWrites).toBe(1);
		expect(saved.writeCalls).toBeGreaterThan(1);
		expect(saved.maximumWriteBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
		expect(saved.nonzeroPcmBytes).toBeGreaterThan(0);
		expect(saved.header).toMatchObject({
			bitsPerSample: 16,
			channelCount: CHANNEL_COUNT,
			commBytes: 18,
			commId: 'COMM',
			formId: 'FORM',
			offset: 0,
			blockSize: 0,
			sampleRateHex: '400ebb80000000000000',
			soundId: 'SSND',
			typeId: 'AIFF',
		});
		expect(saved.header.frameCount).toBeGreaterThanOrEqual(FRAME_COUNT - 1);
		expect(saved.header.frameCount).toBeLessThanOrEqual(FRAME_COUNT);
		const dataBytes = saved.header.frameCount * CHANNEL_COUNT * 2;
		expect(saved.header.soundBytes).toBe(dataBytes + 8);
		expect(saved.formBytes).toBe(saved.totalBytes);
		const trailingMetadataBytes = saved.totalBytes - 54 - dataBytes;
		expect(trailingMetadataBytes).toBeGreaterThanOrEqual(0);
		expect(trailingMetadataBytes).toBeLessThanOrEqual(64 * 1024);
		expect(trailingMetadataBytes % 2).toBe(0);
		expect(saved.header.frameCount * CHANNEL_COUNT * 4).toBeGreaterThan(96 * 1024 ** 2);
		expect(saved.pickerOptions.suggestedName).toMatch(/\.aiff$/iu);
		expect(saved.pickerOptions.types[0].accept['audio/aiff']).toEqual(['.aiff']);
		expect(saved.objectUrls).toEqual([]);
		expect(downloads).toBe(0);

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[1]?.totalBytes || 0), {
			timeout: 15_000,
		}).toBeGreaterThan(54);
		await exportDialog.getByRole('button', { name: 'Cancel export' }).click();
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible({ timeout: 15_000 });
		const cancelled = await inspectDirectAiffTarget(page, 1);
		expect(cancelled.opens).toBe(1);
		expect(cancelled.closes).toBe(0);
		expect(cancelled.aborts).toBe(1);
		expect(cancelled.totalBytes).toBeGreaterThan(54);
		expect(cancelled.totalBytes).toBeLessThan(saved.totalBytes);
		expect(cancelled.objectUrls).toEqual([]);
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();
		expect(downloads).toBe(0);
		expect(errors).toEqual([]);
	});

	test('streams authored BWF bytes without Blob fallback, then rolls back cancellation after PCM', async ({ page }) => {
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
		await installDirectPcmTarget(page, {
			fileName: 'direct-browser-broadcast-master.wav',
			pcmOffset: RETAINED_PREFIX_BYTES,
			prefixBytes: RETAINED_PREFIX_BYTES,
		});

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
		await expect(exportDialog.locator('[data-export-field="sampleRate"] input')).toHaveValue('48000');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="channelMapping"]'), 'Custom channel mapping');
		await exportDialog.getByRole('textbox', { name: /^Custom channel mapping JSON matrix/ })
			.fill(JSON.stringify(Array.from({ length: CHANNEL_COUNT }, () => 0)));
		await chooseDropdown(page, exportDialog.locator('[data-export-field="dither"]'), 'None');
		await authorBextMetadata(page, exportDialog);
		expect(FRAME_COUNT * CHANNEL_COUNT * 4).toBeGreaterThan(96 * 1024 ** 2);

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect(editor.getByText('Large project: rendering in realtime to conserve memory', { exact: true })).toBeVisible();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[0]?.closes || 0), {
			timeout: 45_000,
		}).toBe(1);
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible();
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();

		const saved = await inspectDirectBwfTarget(page, 0);
		expect(saved.opens).toBe(1);
		expect(saved.closes).toBe(1);
		expect(saved.commits).toBe(1);
		expect(saved.publications).toBe(1);
		expect(saved.aborts).toBe(0);
		expect(saved.maxConcurrentWrites).toBe(1);
		expect(saved.writeCalls).toBeGreaterThan(1);
		expect(saved.maximumWriteBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
		expect(saved.prefixCapacityBytes).toBe(RETAINED_PREFIX_BYTES);
		expect(saved.prefixBytes).toBe(RETAINED_PREFIX_BYTES);
		expect(saved.totalBytes).toBeGreaterThan(saved.prefixBytes);
		expect(saved.nonzeroPcmBytes).toBeGreaterThan(0);
		expect(saved.header).toMatchObject({
			bitsPerSample: 16,
			blockAlign: 64,
			byteRate: 3_072_000,
			channelCount: CHANNEL_COUNT,
			dataId: 'data',
			formatBytes: 40,
			formatId: 'fmt ',
			formatTag: 0xfffe,
			riffId: 'RIFF',
			sampleRate: SAMPLE_RATE,
			validBitsPerSample: 16,
			waveId: 'WAVE',
		});
		expect(saved.bext).toMatchObject({
			chunkId: 'bext',
			description: 'Direct browser broadcast master',
			timeReference: '9007199254740993',
			version: 2,
		});
		expect(saved.bext.codingHistory).toBe(
			'A=PCM,F=48000,W=16,M=multi,T=Browser fixture\r\n'
			+ 'A=PCM,F=48000,W=16,M=multi,T=Soundscaper\r\n',
		);
		expect(saved.formatOffset).toBe(20 + saved.bext.payloadBytes + (saved.bext.payloadBytes & 1));
		expect(saved.dataOffset).toBe(saved.formatOffset + 8 + saved.header.formatBytes);
		expect(saved.headerByteLength).toBe(saved.dataOffset + 8);
		const renderedFrames = saved.header.dataBytes / saved.header.blockAlign;
		expect(Number.isInteger(renderedFrames)).toBe(true);
		expect(renderedFrames).toBeGreaterThanOrEqual(FRAME_COUNT - 1);
		expect(renderedFrames).toBeLessThanOrEqual(FRAME_COUNT);
		expect(renderedFrames * CHANNEL_COUNT * 4).toBeGreaterThan(96 * 1024 ** 2);
		expect(saved.riffBytes).toBe(saved.totalBytes);
		expect(saved.trailingBytes).toBeGreaterThanOrEqual(0);
		expect(saved.trailingBytes).toBeLessThanOrEqual(64 * 1024);
		expect(saved.pickerOptions.suggestedName).toMatch(/\.wav$/iu);
		expect(saved.pickerOptions.types[0]).toEqual({
			description: 'Broadcast WAV (BWF) audio',
			accept: { 'audio/wav': ['.wav'] },
		});
		expect(saved.objectUrls).toEqual([]);
		expect(downloads).toBe(0);

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[1]?.nonzeroPcmBytes || 0), {
			timeout: 15_000,
		}).toBeGreaterThan(0);
		await exportDialog.getByRole('button', { name: 'Cancel export' }).click();
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible({ timeout: 15_000 });
		const cancelled = await inspectDirectBwfTarget(page, 1);
		expect(cancelled.opens).toBe(1);
		expect(cancelled.closes).toBe(0);
		expect(cancelled.commits).toBe(0);
		expect(cancelled.publications).toBe(0);
		expect(cancelled.aborts).toBe(1);
		expect(cancelled.nonzeroPcmBytes).toBeGreaterThan(0);
		expect(cancelled.totalBytes).toBeGreaterThan(RETAINED_PREFIX_BYTES);
		expect(cancelled.totalBytes).toBeLessThan(saved.totalBytes);
		expect(cancelled.objectUrls).toEqual([]);
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();
		expect(downloads).toBe(0);
		expect(errors).toEqual([]);
	});
});

async function authorBextMetadata(page, exportDialog) {
	await exportDialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
	await metadataDialog.getByRole('tab', { name: 'BEXT', exact: true }).click();
	await commitInput(metadataDialog.locator('input[name="description"]'), 'Direct browser broadcast master');
	await commitInput(metadataDialog.locator('input[name="timeReference"]'), '9007199254740993');
	await commitInput(
		metadataDialog.locator('textarea[name="codingHistory"]'),
		'A=PCM,F=48000,W=16,M=multi,T=Browser fixture',
	);
	await metadataDialog.getByRole('button', { name: /^Done\.?$/u }).click();
}

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

async function installDirectPcmTarget(page, options) {
	await page.evaluate((configuration) => {
		const createObjectUrl = URL.createObjectURL.bind(URL);
		globalThis.__directPcmSave = {
			objectUrls: [],
			pickerOptions: null,
			sessions: [],
		};
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value(blob) {
				globalThis.__directPcmSave.objectUrls.push({ size: blob.size, type: blob.type });
				return createObjectUrl(blob);
			},
		});
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async (options) => {
				globalThis.__directPcmSave.pickerOptions = options;
				return {
					name: configuration.fileName,
					async createWritable() {
						const session = {
							aborts: 0,
							activeWrites: 0,
							closes: 0,
							commits: 0,
							maxConcurrentWrites: 0,
							maximumWriteBytes: 0,
							nonzeroPcmBytes: 0,
							opens: 1,
							prefix: new Uint8Array(configuration.prefixBytes || 2 * 1024),
							prefixBytes: 0,
							publications: 0,
							totalBytes: 0,
							writeCalls: 0,
						};
						globalThis.__directPcmSave.sessions.push(session);
						return {
							async write(chunk) {
								if (!(chunk instanceof Uint8Array)) throw new TypeError('Expected PCM container bytes.');
								session.activeWrites += 1;
								session.maxConcurrentWrites = Math.max(session.maxConcurrentWrites, session.activeWrites);
								session.maximumWriteBytes = Math.max(session.maximumWriteBytes, chunk.byteLength);
								session.writeCalls += 1;
								const prefixBytes = Math.min(chunk.byteLength, session.prefix.length - session.prefixBytes);
								if (prefixBytes > 0) {
									session.prefix.set(chunk.subarray(0, prefixBytes), session.prefixBytes);
									session.prefixBytes += prefixBytes;
								}
								for (let index = Math.max(0, configuration.pcmOffset - session.totalBytes); index < chunk.byteLength; index += 1) {
									if (chunk[index] !== 0) session.nonzeroPcmBytes += 1;
								}
								session.totalBytes += chunk.byteLength;
								await Promise.resolve();
								session.activeWrites -= 1;
							},
							async close() {
								session.closes += 1;
								session.commits += 1;
								session.publications += 1;
							},
							async abort() { session.aborts += 1; },
						};
					},
				};
			},
		});
	}, options);
}

async function inspectDirectWavTarget(page, sessionIndex) {
	return page.evaluate((index) => {
		const state = globalThis.__directPcmSave;
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

async function inspectDirectAiffTarget(page, sessionIndex) {
	return page.evaluate((index) => {
		const state = globalThis.__directPcmSave;
		const session = state.sessions[index];
		const prefix = session.prefix.subarray(0, session.prefixBytes);
		const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
		const ascii = (offset) => String.fromCharCode(...prefix.subarray(offset, offset + 4));
		const hex = (offset, length) => [...prefix.subarray(offset, offset + length)]
			.map((byte) => byte.toString(16).padStart(2, '0')).join('');
		return {
			...session,
			formBytes: view.getUint32(4, false) + 8,
			header: {
				formId: ascii(0),
				typeId: ascii(8),
				commId: ascii(12),
				commBytes: view.getUint32(16, false),
				channelCount: view.getUint16(20, false),
				frameCount: view.getUint32(22, false),
				bitsPerSample: view.getUint16(26, false),
				sampleRateHex: hex(28, 10),
				soundId: ascii(38),
				soundBytes: view.getUint32(42, false),
				offset: view.getUint32(46, false),
				blockSize: view.getUint32(50, false),
			},
			objectUrls: state.objectUrls,
			pickerOptions: state.pickerOptions,
			prefix: undefined,
		};
	}, sessionIndex);
}

async function inspectDirectBwfTarget(page, sessionIndex) {
	return page.evaluate((index) => {
		const state = globalThis.__directPcmSave;
		const session = state.sessions[index];
		const prefix = session.prefix.subarray(0, session.prefixBytes);
		const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
		const ascii = (offset, length = 4) => new TextDecoder('ascii')
			.decode(prefix.subarray(offset, offset + length));
		const bextOffset = 12;
		const bextPayloadOffset = bextOffset + 8;
		const bextPayloadBytes = view.getUint32(bextOffset + 4, true);
		const formatOffset = bextPayloadOffset + bextPayloadBytes + (bextPayloadBytes & 1);
		const formatBytes = view.getUint32(formatOffset + 4, true);
		const dataOffset = formatOffset + 8 + formatBytes;
		const dataBytes = view.getUint32(dataOffset + 4, true);
		const dataEnd = dataOffset + 8 + dataBytes + (dataBytes & 1);
		const low = BigInt(view.getUint32(bextPayloadOffset + 338, true));
		const high = BigInt(view.getUint32(bextPayloadOffset + 342, true));
		return {
			...session,
			bext: {
				chunkId: ascii(bextOffset),
				payloadBytes: bextPayloadBytes,
				description: ascii(bextPayloadOffset, 256).replace(/\0.*$/u, ''),
				timeReference: (low + (high << 32n)).toString(),
				version: view.getUint16(bextPayloadOffset + 346, true),
				codingHistory: ascii(bextPayloadOffset + 602, Math.max(0, bextPayloadBytes - 602)),
			},
			dataOffset,
			formatOffset,
			header: {
				riffId: ascii(0),
				waveId: ascii(8),
				formatId: ascii(formatOffset),
				formatBytes,
				formatTag: view.getUint16(formatOffset + 8, true),
				channelCount: view.getUint16(formatOffset + 10, true),
				sampleRate: view.getUint32(formatOffset + 12, true),
				byteRate: view.getUint32(formatOffset + 16, true),
				blockAlign: view.getUint16(formatOffset + 20, true),
				bitsPerSample: view.getUint16(formatOffset + 22, true),
				validBitsPerSample: view.getUint16(formatOffset + 26, true),
				dataId: ascii(dataOffset),
				dataBytes,
			},
			headerByteLength: dataOffset + 8,
			objectUrls: state.objectUrls,
			pickerOptions: state.pickerOptions,
			prefix: undefined,
			prefixCapacityBytes: session.prefix.byteLength,
			riffBytes: view.getUint32(4, true) + 8,
			trailingBytes: session.totalBytes - dataEnd,
		};
	}, sessionIndex);
}
