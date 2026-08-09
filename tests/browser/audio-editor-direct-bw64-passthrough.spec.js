import { createAdmChna, encodeChnaPayload, generateAdmAxml } from '../../src/common/editor/adm-metadata.ts';
import { createRiffBextChunk, normalizeBextMetadata } from '../../src/common/editor/broadcast-wave.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	collectClientErrors,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { installDirectPcmTarget } from './helpers/direct-pcm-save-target.js';

const BLOCK_FRAMES = 16_384;
const PCM_BLOCKS = 257;
const FRAME_COUNT = BLOCK_FRAMES * PCM_BLOCKS;
const CHANNEL_COUNT = 6;
const SAMPLE_RATE = 48_000;
const BYTES_PER_SAMPLE = 2;
const DATA_BYTES = FRAME_COUNT * CHANNEL_COUNT * BYTES_PER_SAMPLE;
const FLOAT_PLAN_BYTES = FRAME_COUNT * CHANNEL_COUNT * 4;
const PASSTHROUGH_COMPLETION_TIMEOUT_MS = Math.ceil(FRAME_COUNT / SAMPLE_RATE * 2_000);
const PREFIX_BYTES = 2 * 1024;
const SUFFIX_BYTES = 4 * 1024;
const UINT32_SENTINEL = 0xffff_ffff;

test.describe('direct pristine BW64 passthrough publication', () => {
	registerAudioEditorHooks();

	test('imports, preserves, streams, and cancels a current pristine BW64 sequence', async ({ page }) => {
		test.setTimeout(240_000);
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
		const source = createPristineBw64Fixture();
		await importLazyBw64(page, editor, source);
		expect(FLOAT_PLAN_BYTES).toBe(96 * 1024 ** 2 + 384 * 1024);

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
		await expect(exportDialog.locator('[data-export-field="range"] button')).toBeDisabled();
		await expect(exportDialog.locator('[data-export-field="range"] button')).toContainText('Entire project');
		await expect(exportDialog.locator('[data-export-field="bitDepth"] button')).toBeDisabled();
		await expect(exportDialog.locator('[data-export-field="bitDepth"] button')).toContainText('16-bit PCM');
		await expect(exportDialog.locator('[data-export-field="sampleRate"] input')).toHaveValue(String(SAMPLE_RATE));
		await expect(exportDialog.locator('[data-export-field="sampleRate"] input')).toBeDisabled();
		await expect(exportDialog.locator('[data-export-field="channelMapping"] button')).toBeDisabled();
		await expect(exportDialog.locator('[data-export-field="dither"] button')).toBeDisabled();
		await expect(exportDialog.locator('[data-export-field="dither"] button')).toContainText('None');
		const tails = exportDialog.getByRole('checkbox', { name: 'Include effect tails up to 10 seconds', exact: true });
		await expect(tails).toHaveClass(/checkbox--disabled/u);
		await expect(tails).toHaveAttribute('aria-checked', 'false');

		await exportDialog.getByRole('button', { name: 'Metadata', exact: true }).click();
		const metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
		await metadataDialog.getByRole('tab', { name: 'General', exact: true }).click();
		await metadataDialog.locator('[data-export-metadata-tab="general"]')
			.getByRole('textbox', { name: 'Title', exact: true }).fill('');
		await metadataDialog.getByRole('tab', { name: 'ADM', exact: true }).click();
		const adm = metadataDialog.locator('[data-adm-mode="passthrough"]');
		await expect(adm).toBeVisible();
		await expect(adm.getByText(
			'Imported ADM is eligible for bit-exact metadata pass-through while this project remains unedited.',
			{ exact: true },
		)).toBeVisible();
		await expect(adm.getByText('AXML', { exact: true })).toBeVisible();
		await expect(adm.getByText(String(CHANNEL_COUNT), { exact: true })).toBeVisible();
		await expect(adm.getByText(`${String(SAMPLE_RATE)} Hz`, { exact: true })).toBeVisible();
		await metadataDialog.getByRole('button', { name: /^Done\.?$/u }).click();

		await installDirectPcmTarget(page, {
			fileName: 'direct-browser-pristine-passthrough.wav',
			pcmOffset: source.prefix.byteLength,
			prefixBytes: PREFIX_BYTES,
			suffixBytes: SUFFIX_BYTES,
		});
		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect(editor.getByText(
			'Large project: rendering in realtime to conserve memory',
			{ exact: true },
		)).toBeVisible();
		await expect(exportDialog.locator('[data-export-progress]')).toBeVisible();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[0]?.closes || 0), {
			timeout: PASSTHROUGH_COMPLETION_TIMEOUT_MS,
		}).toBe(1);
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible();
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();

		const saved = await inspectDirectPassthroughTarget(page, 0);
		expect(saved).toMatchObject({
			aborts: 0,
			closes: 1,
			commits: 1,
			maxConcurrentWrites: 1,
			opens: 1,
			publications: 1,
			prefixCapacityBytes: PREFIX_BYTES,
			prefixBytes: PREFIX_BYTES,
			suffixCapacityBytes: SUFFIX_BYTES,
			suffixBytes: SUFFIX_BYTES,
		});
		expect(saved.writeCalls).toBeGreaterThan(1);
		expect(saved.maximumWriteBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
		expect(saved.nonzeroPcmBytes).toBeGreaterThan(0);
		expect(saved.totalBytes).toBe(source.totalBytes);
		expect(saved.chunkOrder).toEqual(['ds64', 'fmt ', 'JUNK', 'bext', 'chna', 'data', 'PEAK', 'axml']);
		expect(saved.sequence).toEqual(source.sequence);
		expect(saved.ds64).toEqual({
			chunkBytes: 28,
			dataBytes: DATA_BYTES,
			riffBytes: source.totalBytes - 8,
			sampleCount: 0,
			tableLength: 0,
		});
		expect(saved.header).toEqual({
			bitsPerSample: 16,
			blockAlign: CHANNEL_COUNT * BYTES_PER_SAMPLE,
			byteRate: SAMPLE_RATE * CHANNEL_COUNT * BYTES_PER_SAMPLE,
			channelCount: CHANNEL_COUNT,
			dataBytes32: UINT32_SENTINEL,
			formatBytes: 16,
			formatTag: 1,
			riffBytes32: UINT32_SENTINEL,
			riffId: 'BW64',
			sampleRate: SAMPLE_RATE,
			waveId: 'WAVE',
		});
		expect(saved.ds64.dataBytes / saved.header.blockAlign).toBe(FRAME_COUNT);
		expect(saved.bext).toEqual({
			description: 'Pristine browser passthrough',
			timeReference: '96000',
			version: 2,
		});
		expect(saved.chna).toEqual({ numTracks: CHANNEL_COUNT, numUids: CHANNEL_COUNT });
		expect(saved.axml).toContain('audioProgrammeName="Imported browser passthrough programme"');
		expect(saved.pickerOptions).toMatchObject({
			suggestedName: expect.stringMatching(/\.wav$/iu),
			types: [{ description: 'BW64 / ADM audio', accept: { 'audio/wav': ['.wav'] } }],
		});
		expect(saved.objectUrls).toEqual([]);
		expect(downloads).toBe(0);

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__directPcmSave.sessions[1]?.nonzeroPcmBytes || 0), {
			timeout: 30_000,
		}).toBeGreaterThan(0);
		await exportDialog.getByRole('button', { name: 'Cancel export' }).click();
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible({ timeout: 30_000 });
		const cancelled = await inspectDirectSession(page, 1);
		expect(cancelled.opens).toBe(1);
		expect(cancelled.closes).toBe(0);
		expect(cancelled.commits).toBe(0);
		expect(cancelled.publications).toBe(0);
		expect(cancelled.aborts).toBe(1);
		expect(cancelled.nonzeroPcmBytes).toBeGreaterThan(0);
		expect(cancelled.totalBytes).toBeGreaterThan(PREFIX_BYTES);
		expect(cancelled.totalBytes).toBeLessThan(saved.totalBytes);
		expect(cancelled.objectUrls).toEqual([]);
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();
		expect(downloads).toBe(0);
		expect(errors).toEqual([]);
	});
});

async function importLazyBw64(page, editor, fixture) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	if (await projectBin.isVisible()) {
		await projectBin.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBin).toBeHidden();
	}
	const importedBytes = await editor.locator('[data-import-input]').evaluate((input, configuration) => {
		const decode = (value) => {
			const binary = atob(value);
			return Uint8Array.from(binary, (character) => character.charCodeAt(0));
		};
		const pcm = new Blob([new Uint8Array(configuration.blockBytes).fill(1)]);
		const parts = [decode(configuration.prefixBase64)];
		for (let index = 0; index < configuration.blocks; index += 1) parts.push(pcm);
		parts.push(decode(configuration.suffixBase64));
		const file = new File(parts, configuration.name, { type: 'audio/wav' });
		const transfer = new DataTransfer();
		transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
		return file.size;
	}, {
		blockBytes: BLOCK_FRAMES * CHANNEL_COUNT * BYTES_PER_SAMPLE,
		blocks: PCM_BLOCKS,
		name: 'pristine-browser-passthrough.wav',
		prefixBase64: fixture.prefix.toString('base64'),
		suffixBase64: fixture.suffix.toString('base64'),
	});
	expect(importedBytes).toBe(fixture.totalBytes);
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 60_000 });
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 60_000 });
}

async function inspectDirectPassthroughTarget(page, sessionIndex) {
	return page.evaluate((index) => {
		const state = globalThis.__directPcmSave;
		const session = state.sessions[index];
		const prefix = session.prefix.subarray(0, session.prefixBytes);
		const suffix = session.suffix.subarray(0, session.suffixBytes);
		const prefixView = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
		const suffixView = new DataView(suffix.buffer, suffix.byteOffset, suffix.byteLength);
		const ascii = (bytes, offset, length = 4) => new TextDecoder('ascii')
			.decode(bytes.subarray(offset, offset + length));
		const fixedAscii = (bytes, offset, length) => ascii(bytes, offset, length).replace(/\0.*$/u, '');
		const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
		const chunks = [];
		let offset = 48;
		while (offset + 8 <= prefix.byteLength) {
			const id = ascii(prefix, offset);
			const payloadBytes = prefixView.getUint32(offset + 4, true);
			chunks.push({ id, offset, payloadBytes });
			if (id === 'data') break;
			offset += 8 + payloadBytes + (payloadBytes & 1);
		}
		const chunk = (id) => chunks.find((candidate) => candidate.id === id);
		const format = chunk('fmt ');
		const bext = chunk('bext');
		const chna = chunk('chna');
		const data = chunk('data');
		const dataBytes = Number(prefixView.getBigUint64(28, true));
		const trailingOffset = data.offset + 8 + dataBytes + (dataBytes & 1);
		const suffixStart = session.totalBytes - session.suffixBytes;
		const trailing = [];
		let suffixOffset = trailingOffset - suffixStart;
		while (suffixOffset + 8 <= suffix.byteLength) {
			const id = ascii(suffix, suffixOffset);
			const payloadBytes = suffixView.getUint32(suffixOffset + 4, true);
			const end = suffixOffset + 8 + payloadBytes + (payloadBytes & 1);
			if (end > suffix.byteLength) break;
			trailing.push({ id, offset: suffixOffset, payloadBytes, end });
			suffixOffset = end;
		}
		const preservedBefore = chunks.filter(({ id }) => !['fmt ', 'data'].includes(id));
		const sequence = [
			...preservedBefore.map((candidate) => ({
				id: candidate.id,
				placement: 'before-data',
				rawHex: hex(prefix.subarray(
					candidate.offset,
					candidate.offset + 8 + candidate.payloadBytes + (candidate.payloadBytes & 1),
				)),
			})),
			...trailing.map((candidate) => ({
				id: candidate.id,
				placement: 'after-data',
				rawHex: hex(suffix.subarray(candidate.offset, candidate.end)),
			})),
		];
		const bextPayloadOffset = bext.offset + 8;
		const timeReferenceLow = BigInt(prefixView.getUint32(bextPayloadOffset + 338, true));
		const timeReferenceHigh = BigInt(prefixView.getUint32(bextPayloadOffset + 342, true));
		const chnaPayloadOffset = chna.offset + 8;
		const axml = trailing.find(({ id }) => id === 'axml');
		return {
			...session,
			axml: axml ? new TextDecoder().decode(suffix.subarray(
				axml.offset + 8,
				axml.offset + 8 + axml.payloadBytes,
			)) : '',
			bext: {
				description: fixedAscii(prefix, bextPayloadOffset, 256),
				timeReference: (timeReferenceLow + (timeReferenceHigh << 32n)).toString(),
				version: prefixView.getUint16(bextPayloadOffset + 346, true),
			},
			chna: {
				numTracks: prefixView.getUint16(chnaPayloadOffset, true),
				numUids: prefixView.getUint16(chnaPayloadOffset + 2, true),
			},
			chunkOrder: ['ds64', ...chunks.map(({ id }) => id), ...trailing.map(({ id }) => id)],
			ds64: {
				chunkBytes: prefixView.getUint32(16, true),
				riffBytes: Number(prefixView.getBigUint64(20, true)),
				dataBytes,
				sampleCount: Number(prefixView.getBigUint64(36, true)),
				tableLength: prefixView.getUint32(44, true),
			},
			header: {
				riffId: ascii(prefix, 0),
				riffBytes32: prefixView.getUint32(4, true),
				waveId: ascii(prefix, 8),
				formatBytes: format.payloadBytes,
				formatTag: prefixView.getUint16(format.offset + 8, true),
				channelCount: prefixView.getUint16(format.offset + 10, true),
				sampleRate: prefixView.getUint32(format.offset + 12, true),
				byteRate: prefixView.getUint32(format.offset + 16, true),
				blockAlign: prefixView.getUint16(format.offset + 20, true),
				bitsPerSample: prefixView.getUint16(format.offset + 22, true),
				dataBytes32: prefixView.getUint32(data.offset + 4, true),
			},
			objectUrls: state.objectUrls,
			pickerOptions: state.pickerOptions,
			prefix: undefined,
			prefixCapacityBytes: session.prefix.byteLength,
			sequence,
			suffix: undefined,
			suffixCapacityBytes: session.suffix.byteLength,
		};
	}, sessionIndex);
}

async function inspectDirectSession(page, sessionIndex) {
	return page.evaluate((index) => {
		const state = globalThis.__directPcmSave;
		const session = state.sessions[index];
		return { ...session, objectUrls: state.objectUrls, prefix: undefined, suffix: undefined };
	}, sessionIndex);
}

function createPristineBw64Fixture() {
	const bext = createRiffBextChunk(normalizeBextMetadata({
		description: 'Pristine browser passthrough',
		originator: 'Browser fixture',
		timeReference: '96000',
		codingHistory: 'A=PCM,F=48000,W=16,M=5.1,T=Browser fixture\n',
	}, { version: 2 }));
	const before = [
		riffChunk('JUNK', Uint8Array.of(1, 2, 3), 0xa5),
		bext,
		riffChunk('chna', encodeChnaPayload(createAdmChna({ layout: '5.1' }))),
	];
	const after = [
		riffChunk('PEAK', Uint8Array.of(9, 8, 7), 0x5a),
		riffChunk('axml', new TextEncoder().encode(generateAdmAxml({
			programmeName: 'Imported browser passthrough programme',
			layout: '5.1',
		}))),
	];
	const format = riffChunk('fmt ', formatPayload());
	const headerBytes = 12 + 36 + format.byteLength
		+ before.reduce((total, chunk) => total + chunk.byteLength, 0) + 8;
	const trailingBytes = after.reduce((total, chunk) => total + chunk.byteLength, 0);
	const totalBytes = headerBytes + DATA_BYTES + trailingBytes;
	const riff = new Uint8Array(12);
	writeAscii(riff, 0, 'BW64');
	new DataView(riff.buffer).setUint32(4, UINT32_SENTINEL, true);
	writeAscii(riff, 8, 'WAVE');
	const ds64Payload = new Uint8Array(28);
	const ds64View = new DataView(ds64Payload.buffer);
	ds64View.setBigUint64(0, BigInt(totalBytes - 8), true);
	ds64View.setBigUint64(8, BigInt(DATA_BYTES), true);
	const data = new Uint8Array(8);
	writeAscii(data, 0, 'data');
	new DataView(data.buffer).setUint32(4, UINT32_SENTINEL, true);
	return Object.freeze({
		prefix: Buffer.from(joinBytes([riff, riffChunk('ds64', ds64Payload), format, ...before, data])),
		sequence: Object.freeze([
			...before.map((raw) => sequenceEntry(raw, 'before-data')),
			...after.map((raw) => sequenceEntry(raw, 'after-data')),
		]),
		suffix: Buffer.from(joinBytes(after)),
		totalBytes,
	});
}

function formatPayload() {
	const output = new Uint8Array(16);
	const view = new DataView(output.buffer);
	view.setUint16(0, 1, true);
	view.setUint16(2, CHANNEL_COUNT, true);
	view.setUint32(4, SAMPLE_RATE, true);
	view.setUint32(8, SAMPLE_RATE * CHANNEL_COUNT * BYTES_PER_SAMPLE, true);
	view.setUint16(12, CHANNEL_COUNT * BYTES_PER_SAMPLE, true);
	view.setUint16(14, 16, true);
	return output;
}

function riffChunk(id, payload, padByte = 0) {
	const output = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeAscii(output, 0, id);
	new DataView(output.buffer).setUint32(4, payload.byteLength, true);
	output.set(payload, 8);
	if (payload.byteLength & 1) output[output.byteLength - 1] = padByte;
	return output;
}

function sequenceEntry(raw, placement) {
	return Object.freeze({
		id: String.fromCharCode(...raw.subarray(0, 4)),
		placement,
		rawHex: Buffer.from(raw).toString('hex'),
	});
}

function joinBytes(chunks) {
	const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function writeAscii(bytes, offset, value) {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}
