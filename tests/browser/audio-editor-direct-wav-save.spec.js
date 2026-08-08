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
import { installDirectPcmTarget } from './helpers/direct-pcm-save-target.js';

const CHANNEL_COUNT = 32;
const BW64_FRAME_COUNT = 1_588_800;
const BW64_SAMPLE_RATE = 384_000;
const FRAME_COUNT = 792_000;
const SAMPLE_RATE = 48_000;
// Realtime capture consumes project-rate frames at wall-clock speed. Leave
// four render durations for shared-CI scheduling and 384 kHz output encoding.
const BW64_COMPLETION_TIMEOUT_MS = Math.ceil(BW64_FRAME_COUNT / SAMPLE_RATE * 4_000);
const RETAINED_PREFIX_BYTES = 2 * 1024;
const RETAINED_SUFFIX_BYTES = 8 * 1024;

test.describe('direct native PCM File System Access publication', () => {
	registerAudioEditorHooks();

	test('streams WAV bytes, rolls back before commit, and preserves an admitted commit', async ({ page }) => {
		test.setTimeout(120_000);
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
			fileName: 'direct-browser-mix.wav',
			pcmOffset: 44,
			stallCommitSession: 2,
		});

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

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[2]?.commitStarted || 0), {
			timeout: 45_000,
		}).toBe(1);
		await exportDialog.getByRole('button', { name: 'Cancel export' }).click();
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible({ timeout: 15_000 });
		const cancelledStatus = await inspectEditorStatus(editor);
		const cancelledOutput = await inspectExportOutput(exportDialog);
		expect(cancelledStatus.state).not.toBe('success');
		expect(cancelledOutput).toMatchObject({ download: '', href: '#' });
		expect(cancelledOutput.text).not.toBe('direct-browser-mix.wav');
		const beforeRelease = await inspectDirectWavTarget(page, 2);
		expect(beforeRelease).toMatchObject({ aborts: 0, closes: 0, commitStarted: 1, commits: 0, publications: 0 });
		await page.evaluate(() => {
			const state = globalThis.__directPcmSave;
			state.publicationMutations = [];
			const observer = new MutationObserver((mutations) => {
				state.publicationMutations.push(...mutations.map((mutation) => mutation.attributeName || mutation.type));
			});
			observer.observe(document.querySelector('[data-audio-editor] [data-status]'), { attributes: true, childList: true, characterData: true, subtree: true });
			observer.observe(document.querySelector('[data-export-download]'), { attributes: true, childList: true, characterData: true, subtree: true });
			Object.defineProperty(state, 'publicationObserver', { configurable: true, value: observer });
		});
		await page.evaluate((sessionIndex) => {
			const release = globalThis.__directPcmSave.commitReleases?.[sessionIndex];
			if (typeof release !== 'function') throw new Error('The selected direct PCM commit is not stalled.');
			release();
		}, 2);
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[2]?.closes || 0), {
			timeout: 15_000,
		}).toBe(1);
		const admitted = await inspectDirectWavTarget(page, 2);
		expect(admitted).toMatchObject({
			aborts: 0,
			closes: 1,
			commits: 1,
			publications: 1,
			totalBytes: saved.totalBytes,
		});
		expect(admitted.header).toEqual(saved.header);
		expect(admitted.nonzeroPcmBytes).toBeGreaterThan(0);
		expect(admitted.riffBytes).toBe(admitted.totalBytes);
		expect(await page.evaluate(() => globalThis.__directPcmSave.sessions.length)).toBe(3);
		const publicationMutations = await page.evaluate(async () => {
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			globalThis.__directPcmSave.publicationObserver.disconnect();
			return globalThis.__directPcmSave.publicationMutations;
		});
		expect(publicationMutations).toEqual([]);
		expect(await inspectEditorStatus(editor)).toEqual(cancelledStatus);
		expect(await inspectExportOutput(exportDialog)).toEqual(cancelledOutput);
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

	test('streams authored BW64 bytes without Blob fallback, then rolls back cancellation after PCM', async ({ page }) => {
		test.setTimeout(BW64_COMPLETION_TIMEOUT_MS + 60_000);
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
		await importFiles(editor, [createThresholdTone(BW64_FRAME_COUNT)]);
		await installDirectPcmTarget(page, {
			fileName: 'direct-browser-adm-master.wav',
			pcmOffset: RETAINED_PREFIX_BYTES,
			prefixBytes: RETAINED_PREFIX_BYTES,
			suffixBytes: RETAINED_SUFFIX_BYTES,
		});

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
		await commitInput(exportDialog.locator('[data-export-field="sampleRate"] input'), String(BW64_SAMPLE_RATE));
		await chooseDropdown(page, exportDialog.locator('[data-export-field="dither"]'), 'None');
		await authorBw64Metadata(page, exportDialog);
		const outputFrames = BW64_FRAME_COUNT * BW64_SAMPLE_RATE / SAMPLE_RATE;
		expect(outputFrames * 2 * 4).toBeGreaterThan(96 * 1024 ** 2);

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect(editor.getByText('Large project: rendering in realtime to conserve memory', { exact: true })).toBeVisible();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[0]?.closes || 0), {
			timeout: BW64_COMPLETION_TIMEOUT_MS,
		}).toBe(1);
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible();
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();

		const saved = await inspectDirectBw64Target(page, 0);
		expect(saved).toMatchObject({
			aborts: 0,
			closes: 1,
			commits: 1,
			maxConcurrentWrites: 1,
			opens: 1,
			publications: 1,
			prefixCapacityBytes: RETAINED_PREFIX_BYTES,
			prefixBytes: RETAINED_PREFIX_BYTES,
			suffixCapacityBytes: RETAINED_SUFFIX_BYTES,
			suffixBytes: RETAINED_SUFFIX_BYTES,
		});
		expect(saved.writeCalls).toBeGreaterThan(1);
		expect(saved.maximumWriteBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
		expect(saved.header).toEqual({
			bitsPerSample: 16,
			blockAlign: 4,
			byteRate: 1_536_000,
			channelCount: 2,
			dataBytes32: 0xffff_ffff,
			formatBytes: 16,
			formatTag: 1,
			riffBytes32: 0xffff_ffff,
			riffId: 'BW64',
			sampleRate: BW64_SAMPLE_RATE,
			waveId: 'WAVE',
		});
		expect(saved.chunkOrder).toEqual(['bext', 'fmt ', 'chna', 'data']);
		expect(saved.ds64).toMatchObject({
			chunkId: 'ds64',
			chunkBytes: 28,
			riffBytes: saved.totalBytes - 8,
			sampleCount: 0,
			tableLength: 0,
		});
		const renderedFrames = saved.ds64.dataBytes / saved.header.blockAlign;
		expect(Number.isInteger(renderedFrames)).toBe(true);
		expect(renderedFrames).toBeGreaterThanOrEqual(outputFrames - BW64_SAMPLE_RATE / SAMPLE_RATE);
		expect(renderedFrames).toBeLessThanOrEqual(outputFrames);
		expect(renderedFrames * 2 * 4).toBeGreaterThan(96 * 1024 ** 2);
		expect(saved.bext).toMatchObject({
			description: 'Direct browser ADM master',
			timeReference: '72057594037927944',
			version: 2,
		});
		expect(saved.chna).toEqual({
			entries: [
				{ packRef: 'AP_00010002', trackIndex: 1, trackRef: 'AC_00010001_00', uid: 'ATU_00000001' },
				{ packRef: 'AP_00010002', trackIndex: 2, trackRef: 'AC_00010002_00', uid: 'ATU_00000002' },
			],
			numTracks: 2,
			numUids: 2,
		});
		expect(saved.axml.xml).toContain('audioProgrammeName="Direct browser programme"');
		expect(saved.axml.xml).toContain('audioContentName="Direct browser content"');
		expect(saved.axml.xml).toContain('audioObjectName="Direct browser stereo bed"');
		expect(saved.axml.xml).toContain('audioPackFormatIDRef>AP_00010002</audioPackFormatIDRef>');
		expect(saved.axml.offset).toBe(saved.dataOffset + 8 + saved.ds64.dataBytes);
		expect(saved.axml.offset + saved.axml.chunkBytes).toBeLessThan(saved.totalBytes);
		expect(saved.pickerOptions.types[0]).toEqual({
			description: 'BW64 / ADM audio',
			accept: { 'audio/wav': ['.wav'] },
		});
		expect(saved.pickerOptions.suggestedName).toMatch(/\.wav$/iu);
		expect(saved.objectUrls).toEqual([]);
		expect(downloads).toBe(0);

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[1]?.nonzeroPcmBytes || 0), {
			timeout: 15_000,
		}).toBeGreaterThan(0);
		await exportDialog.getByRole('button', { name: 'Cancel export' }).click();
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible({ timeout: 15_000 });
		const cancelled = await inspectDirectBw64Target(page, 1);
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

async function inspectEditorStatus(editor) {
	return editor.locator('[data-status]').evaluate((status) => ({
		state: status.getAttribute('data-state'),
		text: status.textContent,
	}));
}

async function inspectExportOutput(exportDialog) {
	return exportDialog.locator('[data-export-download]').evaluate((output) => ({
		download: output.getAttribute('download'),
		href: output.getAttribute('href'),
		text: output.textContent,
	}));
}

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

async function authorBw64Metadata(page, exportDialog) {
	await exportDialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
	await metadataDialog.getByRole('tab', { name: 'BEXT', exact: true }).click();
	await commitInput(metadataDialog.locator('input[name="description"]'), 'Direct browser ADM master');
	await commitInput(metadataDialog.locator('input[name="timeReference"]'), '9007199254740993');
	await metadataDialog.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadataDialog.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await commitInput(metadataDialog.locator('input[name="adm-programme-name"]'), 'Direct browser programme');
	await commitInput(metadataDialog.locator('input[name="adm-content-name"]'), 'Direct browser content');
	await commitInput(metadataDialog.locator('input[name="adm-bed-name"]'), 'Direct browser stereo bed');
	await metadataDialog.getByRole('button', { name: /^Done\.?$/u }).click();
}

function createThresholdTone(frameCount = FRAME_COUNT) {
	const channelCount = 2;
	const bytesPerSample = 2;
	const dataBytes = frameCount * channelCount * bytesPerSample;
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
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const sample = Math.sin(2 * Math.PI * 220 * frame / SAMPLE_RATE + channel * Math.PI / 3) * 0.3;
			buffer.writeInt16LE(Math.round(sample * 32767), 44 + (frame * channelCount + channel) * bytesPerSample);
		}
	}
	return { name: `direct-threshold-${frameCount / SAMPLE_RATE}.wav`, mimeType: 'audio/wav', buffer };
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

async function inspectDirectBw64Target(page, sessionIndex) {
	return page.evaluate((index) => {
		const state = globalThis.__directPcmSave;
		const session = state.sessions[index];
		const prefix = session.prefix.subarray(0, session.prefixBytes);
		const suffix = session.suffix.subarray(0, session.suffixBytes);
		const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
		const suffixView = new DataView(suffix.buffer, suffix.byteOffset, suffix.byteLength);
		const ascii = (bytes, offset, length = 4) => new TextDecoder('ascii')
			.decode(bytes.subarray(offset, offset + length));
		const fixedAscii = (bytes, offset, length) => ascii(bytes, offset, length).replace(/\0.*$/u, '');
		const chunks = [];
		let chunkOffset = 48;
		while (chunkOffset + 8 <= prefix.byteLength) {
			const id = ascii(prefix, chunkOffset);
			const payloadBytes = view.getUint32(chunkOffset + 4, true);
			chunks.push({ id, offset: chunkOffset, payloadBytes });
			if (id === 'data') break;
			chunkOffset += 8 + payloadBytes + (payloadBytes & 1);
		}
		const chunk = (id) => chunks.find((candidate) => candidate.id === id);
		const bext = chunk('bext');
		const format = chunk('fmt ');
		const chna = chunk('chna');
		const data = chunk('data');
		const bextPayloadOffset = bext.offset + 8;
		const low = BigInt(view.getUint32(bextPayloadOffset + 338, true));
		const high = BigInt(view.getUint32(bextPayloadOffset + 342, true));
		const chnaPayloadOffset = chna.offset + 8;
		const numUids = view.getUint16(chnaPayloadOffset + 2, true);
		const entries = Array.from({ length: numUids }, (_, entryIndex) => {
			const offset = chnaPayloadOffset + 4 + entryIndex * 40;
			return {
				trackIndex: view.getUint16(offset, true),
				uid: fixedAscii(prefix, offset + 2, 12),
				trackRef: fixedAscii(prefix, offset + 14, 14),
				packRef: fixedAscii(prefix, offset + 28, 11),
			};
		});
		const dataBytes = Number(view.getBigUint64(28, true));
		const expectedAxmlOffset = data.offset + 8 + dataBytes + (dataBytes & 1);
		const axmlOffsetInSuffix = expectedAxmlOffset - (session.totalBytes - session.suffixBytes);
		const hasAxml = axmlOffsetInSuffix >= 0
			&& axmlOffsetInSuffix + 8 <= suffix.byteLength
			&& ascii(suffix, axmlOffsetInSuffix) === 'axml';
		const axmlPayloadBytes = hasAxml ? suffixView.getUint32(axmlOffsetInSuffix + 4, true) : 0;
		const axml = !hasAxml ? null : {
			chunkBytes: 8 + axmlPayloadBytes + (axmlPayloadBytes & 1),
			offset: expectedAxmlOffset,
			xml: new TextDecoder().decode(suffix.subarray(
				axmlOffsetInSuffix + 8,
				axmlOffsetInSuffix + 8 + axmlPayloadBytes,
			)),
		};
		return {
			...session,
			axml,
			bext: {
				description: fixedAscii(prefix, bextPayloadOffset, 256),
				timeReference: (low + (high << 32n)).toString(),
				version: view.getUint16(bextPayloadOffset + 346, true),
			},
			chna: {
				entries,
				numTracks: view.getUint16(chnaPayloadOffset, true),
				numUids,
			},
			chunkOrder: chunks.map(({ id }) => id),
			dataOffset: data.offset,
			ds64: {
				chunkId: ascii(prefix, 12),
				chunkBytes: view.getUint32(16, true),
				riffBytes: Number(view.getBigUint64(20, true)),
				dataBytes,
				sampleCount: Number(view.getBigUint64(36, true)),
				tableLength: view.getUint32(44, true),
			},
			header: {
				riffId: ascii(prefix, 0),
				riffBytes32: view.getUint32(4, true),
				waveId: ascii(prefix, 8),
				formatBytes: format.payloadBytes,
				formatTag: view.getUint16(format.offset + 8, true),
				channelCount: view.getUint16(format.offset + 10, true),
				sampleRate: view.getUint32(format.offset + 12, true),
				byteRate: view.getUint32(format.offset + 16, true),
				blockAlign: view.getUint16(format.offset + 20, true),
				bitsPerSample: view.getUint16(format.offset + 22, true),
				dataBytes32: view.getUint32(data.offset + 4, true),
			},
			objectUrls: state.objectUrls,
			pickerOptions: state.pickerOptions,
			prefix: undefined,
			prefixCapacityBytes: session.prefix.byteLength,
			suffix: undefined,
			suffixCapacityBytes: session.suffix.byteLength,
		};
	}, sessionIndex);
}
