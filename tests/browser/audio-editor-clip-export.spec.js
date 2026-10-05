/* SPDX-License-Identifier: AGPL-3.0-only */

import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { createAudioClip } from '../../src/common/editor/project-media-factory.ts';

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	chooseNestedCommandAction,
	closeWorkspacePanel,
	collectClientErrors,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
	readDownloadBytes,
	waitForEditor,
	waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const fixtures = [330, 660, 990].map((frequency, index) => createWavFixture({
	name: `clip-export-${index + 1}.wav`, frequency, channelCount: 1,
}));
const cell = (grid, row, column) => grid.getByRole('gridcell')
	.and(grid.locator(`[data-row="${row}"][data-column="${column}"]`));

async function editCell(grid, row, column, label, value) {
	await cell(grid, row, column).dblclick();
	const input = grid.getByLabel(label, { exact: true });
	await input.fill(value);
	await input.press('Enter');
	await expect(cell(grid, row, column)).toHaveText(value);
}

async function arrangeClips(page, editor, product) {
	await importFiles(editor, fixtures);
	if (product === 'framescaper') return arrangeFramescaperClips(page, editor);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const panel = editor.locator('[data-workspace-panel="clip-spreadsheet"]');
	const grid = panel.getByRole('grid');
	// The first two clips overlap on one track; the third remains on another.
	// A time-range mix or a track stem would leak the overlapping neighbor.
	const firstTrack = await cell(grid, 0, 'track').textContent();
	await editCell(grid, 1, 'track', 'Track', firstTrack);
	for (const [row, position, offset, duration] of [
		[0, '2', '0.125', '0.25'],
		[1, '2.1', '0.1', '0.4'],
		[2, '5', '0.3', '0.1'],
	]) {
		await editCell(grid, row, 'duration', 'Duration (s)', duration);
		await editCell(grid, row, 'offset', 'Offset (s)', offset);
		await editCell(grid, row, 'position', 'Position (s)', position);
		await editCell(grid, row, 'name', 'Name', 'Voice / take:*?');
	}
	await closeWorkspacePanel(editor, 'clip-spreadsheet');
	await expect(editor).toHaveAttribute('data-clip-count', '3');
}

async function arrangeFramescaperClips(page, editor) {
	const projectId = await editor.getAttribute('data-project-id');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const project = await persistedFramescaperProject(page, projectId);
	// Framescaper has no Clip spreadsheet. Seed its native audio clip schema
	// with the maintained factory while keeping the real imported source bodies.
	const clips = fixtures.map((fixture, index) => {
		const source = project.sources.find(({ name }) => name === fixture.name);
		const clip = project.clips.find(({ sourceId }) => sourceId === source.id);
		return createAudioClip({
			...clip, title: 'Voice / take:*?',
			timelineStartFrame: [96_000, 100_800, 240_000][index],
			sourceStartFrame: [6_000, 4_800, 14_400][index],
			sourceDurationFrames: [12_000, 19_200, 4_800][index],
			durationFrames: [12_000, 19_200, 4_800][index],
		});
	});
	const firstTrack = project.tracks.find(({ clipIds }) => clipIds?.includes(clips[0].id));
	for (const track of project.tracks) {
		if (track.clipIds) track.clipIds = track.clipIds.filter((id) => id !== clips[1].id);
	}
	firstTrack.clipIds.push(clips[1].id);
	project.clips = clips;
	await page.evaluate(({ databaseName, document }) => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const transaction = database.transaction('projects', 'readwrite');
			transaction.objectStore('projects').put(document);
			transaction.oncomplete = () => { database.close(); resolve(); };
			transaction.onerror = () => { database.close(); reject(transaction.error); };
		};
	}), { databaseName: FRAMESCAPER_DATABASE_NAME, document: project });
	await page.reload();
	await waitForEditor(page);
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
}

async function persistedFramescaperProject(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const request = database.transaction('projects', 'readonly').objectStore('projects').get(id);
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => {
				database.close();
				resolve(request.result ?? null);
			};
		};
	}), { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}

function wavSamples(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
	expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE');
	expect(view.getUint16(34, true)).toBe(16);
	const channelCount = view.getUint16(22, true);
	const frameCount = view.getUint32(40, true) / (channelCount * 2);
	return {
		sampleRate: view.getUint32(24, true),
		frameCount,
		samples: Float32Array.from({ length: frameCount }, (_value, frame) => (
			view.getInt16(44 + frame * channelCount * 2, true) / 32768
		)),
	};
}

function toneProjection(samples, frequency, sampleRate) {
	let sine = 0;
	let cosine = 0;
	for (const [frame, sample] of samples.entries()) {
		const angle = 2 * Math.PI * frequency * frame / sampleRate;
		sine += sample * Math.sin(angle);
		cosine += sample * Math.cos(angle);
	}
	return { amplitude: 2 * Math.hypot(sine, cosine) / samples.length, cosine: 2 * cosine / samples.length };
}

for (const product of ['soundscaper', 'framescaper']) {
	test.describe(`${product} clip batch export`, () => {
		test('exports trimmed overlapping clips as separate named audio files', async ({ page }) => {
			test.setTimeout(60_000);
			await disableNativeSavePicker(page);
			const errors = collectClientErrors(page);
			const path = product === 'soundscaper' ? '/embed/en/' : '/framescaper/embed/en/';
			const editor = await bootEditor(page, path);
			await arrangeClips(page, editor, product);
			const dialog = await openExportDialog(page, editor, {
				label: product === 'framescaper' ? 'Export video' : 'Export audio',
			});
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
			await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Individual clips (split by clips)');
			await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
			await expect(dialog.locator('[data-export-field="tails"]')).toHaveCount(0);
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			const download = dialog.locator('[data-export-download]');
			await expect(download).toBeVisible({ timeout: 20_000 });
			await expect(download).toHaveAttribute('download', /-clips-.*\.zip$/u);
			const archive = new ZipReader(new Uint8ArrayReader(await readDownloadBytes(page, download)), {
				useWebWorkers: false,
			});
			try {
				const entries = await archive.getEntries();
				expect.soft(entries.map(({ filename }) => filename)).toEqual([
					'01-Voice-take.wav', '02-Voice-take.wav', '03-Voice-take.wav',
				]);
				const durations = [0.25, 0.4, 0.1];
				for (const [index, entry] of entries.entries()) {
					const wav = wavSamples(await entry.getData(new Uint8ArrayWriter()));
					expect(wav.sampleRate).toBe(48_000);
					expect(wav.frameCount).toBe(durations[index] * wav.sampleRate);
					// The first trim begins at the tone's positive peak; check the phase
					// across its file without depending on the scheduler's edge ramp.
					if (index === 0) expect(toneProjection(wav.samples, 330, wav.sampleRate).cosine).toBeGreaterThan(0.23);
					expect(toneProjection(wav.samples, [330, 660, 990][index], wav.sampleRate).amplitude).toBeGreaterThan(0.23);
					for (const frequency of [330, 660, 990].filter((value, position) => position !== index)) {
						expect(toneProjection(wav.samples, frequency, wav.sampleRate).amplitude).toBeLessThan(0.01);
					}
				}
			} finally {
				await archive.close();
			}
			await expect(editor).toHaveAttribute('data-clip-count', '3');
			expect(errors).toEqual([]);
		});
	});
}
