/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { downloadBytes } from '../audio-editor-test-helpers.js';
import { sourcePeakChannels } from './stored-source-probes.js';

const GENERATED_GUIDES = Object.freeze({
	'generate-a-rhythm-track': { name: 'Rhythm Track', duration: 8 },
	'generate-a-risset-drum': { name: 'Risset Drum', duration: 1.5 },
	'generate-a-plucked-tone': { name: 'Pluck', duration: 2 },
});

/** Verify the bundled Nyquist reports before the guide runner closes its dialog. */
export async function verifyNyquistWorkflowDialog(dialog, entry) {
	const output = dialog.locator('.kw-audio-editor__nyquist-output');
	await expect(output).toBeVisible();
	if (entry.name === 'Measure RMS') {
		await expect(output).toContainText(/Stereo:[\s\S]*dB/u);
		await expect(output).toContainText(/Left:[\s\S]*Right:/u);
		return;
	}
	if (entry.name === 'Label Sounds') {
		await expect(output).toContainText(/\d+ label\(s\)/u);
	}
}

/** Inspect the actual payload while the export dialog still owns its object URL. */
export async function verifyNyquistDeliveryDownload(page, download, entry) {
	if (entry.extension !== 'aiff' && entry.mode !== 'Individual clips (split by clips)') return;
	const [downloadEvent] = await Promise.all([page.waitForEvent('download'), download.click()]);
	const bytes = Buffer.from(await downloadBytes(downloadEvent));
	const signature = inspectDownload(bytes);
	if (entry.extension === 'aiff') {
		expect(signature.kind).toBe('AIFF');
		expect(signature.length).toBeGreaterThan(54);
		return;
	}
	if (entry.mode === 'Individual clips (split by clips)') {
		expect(signature.kind).toBe('zip');
		expect(signature.names).toHaveLength(3);
		for (const name of signature.names) expect(name).toMatch(/\.wav$/u);
	}
}

function inspectDownload(bytes) {
	if (bytes.length < 16) return { kind: 'short', length: bytes.length };
	if (bytes.toString('ascii', 0, 4) === 'FORM') return { kind: bytes.toString('ascii', 8, 12), length: bytes.length };
	if (bytes.toString('ascii', 0, 4) !== 'PK\u0003\u0004') return { kind: 'unknown', length: bytes.length };
	let end = -1;
	for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
		if (bytes.readUInt32LE(index) === 0x06054b50) {
			end = index;
			break;
		}
	}
	if (end < 0) return { kind: 'zip-without-directory', length: bytes.length };
	const count = bytes.readUInt16LE(end + 10);
	let offset = bytes.readUInt32LE(end + 16);
	const names = [];
	for (let item = 0; item < count; item += 1) {
		if (bytes.readUInt32LE(offset) !== 0x02014b50) return { kind: 'bad-central-directory', length: bytes.length, names };
		const nameLength = bytes.readUInt16LE(offset + 28);
		const extraLength = bytes.readUInt16LE(offset + 30);
		const commentLength = bytes.readUInt16LE(offset + 32);
		names.push(bytes.toString('utf8', offset + 46, offset + 46 + nameLength));
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return { kind: 'zip', length: bytes.length, names };
}

/** Assert generated timelines and their stored audio contain the expected result. */
export async function verifyNyquistDeliveryWorkflowResults(page, id) {
	const generated = GENERATED_GUIDES[id];
	if (generated) {
		const editor = page.locator('[data-audio-editor]');
		const clips = editor.getByRole('group', { name: / clip, starts at [\d.]+ seconds?, [\d.]+ seconds? long$/u });
		await expect(clips).toHaveCount(1);
		await expect(clips).toHaveAttribute('aria-label', new RegExp(`starts at 0 seconds, ${String(generated.duration).replace('.', '\\.')} seconds long$`, 'u'));
		const peaks = await sourcePeakChannels(page, generated.name);
		expect(peaks.channels.length).toBeGreaterThan(0);
		expect(peaks.channels.some(({ minimum, maximum }) => minimum < 0 || maximum > 0)).toBe(true);
		return;
	}
	if (id === 'label-sounds-separated-by-silence') {
		const editor = page.locator('[data-audio-editor]');
		const track = editor.getByRole('region', { name: 'Label Sounds', exact: true });
		await expect(track).toBeVisible();
		await expect(track.getByRole('group', { name: /^Edit labels: Sound /u })).toHaveCount(4);
		return;
	}
	if (id === 'export-clips-as-an-archive') {
		// The archive's central directory and three WAV entries are checked before
		// the export dialog closes by verifyNyquistDeliveryDownload.
		return;
	}
}
