/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseFileAction,
	collectClientErrors,
	disableNativeSavePicker,
	importFiles,
	openNestedCommandMenu,
	readDownloadBytes,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test.describe('Framescaper v1 audio finishing', () => {
	test('authors, restores, executes, and delivers the shared V21 audio workflows from menus', async ({ page }) => {
		test.setTimeout(180_000);
		await disableNativeSavePicker(page);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await expect(page.locator('[data-framescaper-finishing-dialog]')).toHaveCount(0);
		for (const label of ['Automation Lanes', 'Mixer & Routing', 'Dialogue Chain']) {
			await expect(editor.getByRole('button', { name: new RegExp(label, 'u') })).toHaveCount(0);
		}

		await importFiles(editor, [createDeterministicAvFixture('framescaper-audio-finishing.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const track = editor.locator('[data-track-row]:not([data-video-track]):not([data-label-track])').last();
		await track.locator('[data-track-header]').click();
		const trackId = await track.getAttribute('data-track-id');
		expect(trackId).toBeTruthy();

		let dialog = await openFinishing(page, editor, 'Tracks', [], /^Automation(?: Lanes)?/u, 'Automation Lanes');
		await expect(dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }))
			.toBeFocused();
		await assertNoSeriousAxeViolations(page, '[data-framescaper-finishing-dialog="automation"]');
		const lane = automationLane(trackId);
		await finishingDocument(dialog).fill(JSON.stringify([lane], null, 2));
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Finishing state updated.');
		await closeFinishing(dialog);

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		dialog = await openFinishing(page, editor, 'Tracks', [], /^Automation(?: Lanes)?/u, 'Automation Lanes');
		expect(JSON.parse(await finishingDocument(dialog).inputValue())).toEqual([]);
		await closeFinishing(dialog);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		dialog = await openFinishing(page, editor, 'Tracks', [], /^Automation(?: Lanes)?/u, 'Automation Lanes');
		expect(JSON.parse(await finishingDocument(dialog).inputValue())).toEqual([lane]);
		await closeFinishing(dialog);

		dialog = await openFinishing(page, editor, 'Window', [],
			/^(?:Mixer & Routing|Routing graph)/u, 'Mixer & Routing');
		const mixer = JSON.parse(await finishingDocument(dialog).inputValue());
		mixer.outputs[0].name = 'Programme';
		await finishingDocument(dialog).fill(JSON.stringify(mixer, null, 2));
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Finishing state updated.');
		await closeFinishing(dialog);

		dialog = await openFinishing(page, editor, 'Window', [], /^Dialogue Chain/u, 'Dialogue Chain');
		await expect(dialog).toContainText('Highpass → gate → EQ → compressor → limiter');
		await expect(dialog.getByRole('checkbox', { name: /Include profiled noise reduction/u }))
			.not.toBeChecked();
		await dialog.getByRole('button', { name: 'Apply dialogue chain', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Dialogue chain applied.');
		await closeFinishing(dialog);

		dialog = await openFinishing(page, editor, 'Tracks', [], /^Caption Tracks/u, 'Caption Tracks');
		await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('webvtt');
		await dialog.getByRole('textbox', { name: 'Sidecar text', exact: true }).fill([
			'WEBVTT', '', 'duplicate', '00:00.000 --> 00:01.000', 'First', '',
			'duplicate', '00:01.000 --> 00:02.000', 'Second', '',
		].join('\n'));
		await dialog.getByRole('button', { name: 'Import sidecar text', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('1 interchange loss recorded.');
		await closeFinishing(dialog);

		await expect.poll(() => storedAudioFinishing(page, projectId, trackId)).toMatchObject({
			schemaFamily: 'framescaper', schemaVersion: 1,
			mixerOutputName: 'Programme',
			automationLaneIds: ['dialogue-gain'],
			effectTypes: ['highpass', 'gate', 'eq', 'compressor', 'limiter'],
			captionCueCount: 2,
			audioClipDurationFrames: 104_000,
		});

		await chooseFileAction(page, editor, 'Export video');
		const exportDialog = page.getByRole('dialog', { name: 'Export video', exact: true });
		const loudness = exportDialog.getByRole('group', { name: 'Loudness normalization', exact: true })
			.getByRole('button', { name: 'Loudness normalization', exact: true });
		await expect(loudness).toContainText('None');
		await loudness.click();
		const loudnessOptions = page.getByRole('listbox');
		await expect(loudnessOptions.getByRole('option')).toHaveText([
			'None', 'EBU R 128 (-23 LUFS)', 'ATSC A/85 (-24 LUFS)', 'Streaming (-14 LUFS)',
		]);
		await loudnessOptions.getByRole('option', { name: 'EBU R 128 (-23 LUFS)', exact: true }).click();
		await expect(loudness).toContainText('EBU R 128 (-23 LUFS)');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 30_000 });
		await expect(download).toHaveAttribute('download', /\.wav$/u);
		expect(readWavDelivery(await readDownloadBytes(page, download))).toEqual({
			format: 1,
			channels: 2,
			sampleRate: 48_000,
			bitDepth: 24,
			frames: 104_000,
		});
		expect(clientErrors).toEqual([]);
	});
});

function readWavDelivery(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe('RIFF');
	expect(Buffer.from(bytes.subarray(8, 12)).toString('ascii')).toBe('WAVE');
	expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
	let format = null;
	let dataSize = null;
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const kind = Buffer.from(bytes.subarray(offset, offset + 4)).toString('ascii');
		const size = view.getUint32(offset + 4, true);
		expect(offset + 8 + size).toBeLessThanOrEqual(bytes.byteLength);
		if (kind === 'fmt ') format = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, size);
		if (kind === 'data') dataSize = size;
		offset += 8 + size + (size & 1);
	}
	expect(format).not.toBeNull();
	expect(dataSize).not.toBeNull();
	const channels = format.getUint16(2, true);
	const bitDepth = format.getUint16(14, true);
	expect(dataSize % (channels * bitDepth / 8)).toBe(0);
	return {
		format: format.getUint16(0, true),
		channels,
		sampleRate: format.getUint32(4, true),
		bitDepth,
		frames: dataSize / (channels * bitDepth / 8),
	};
}

async function openFinishing(page, editor, owner, parents, itemName, title) {
	let menu;
	if (parents.length > 0) {
		menu = await openNestedCommandMenu(page, editor, owner, parents);
	} else {
		await editor.getByRole('menubar', { name: 'Application menu', exact: true })
			.getByRole('menuitem', { name: owner, exact: true }).click();
		menu = page.getByRole('menu', { name: owner, exact: true });
		await expect(menu).toBeVisible();
	}
	const item = menu.getByRole('menuitem', { name: itemName }).first();
	await expect(item).toBeEnabled();
	await item.focus();
	await item.press('Enter');
	const dialog = page.getByRole('dialog', { name: title, exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

function finishingDocument(dialog) {
	return dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true });
}

async function closeFinishing(dialog) {
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

function automationLane(trackId) {
	return {
		id: 'dialogue-gain',
		address: { kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [
			{ id: 'start', position: 0, value: 0.5 },
			{ id: 'end', position: 48_000, value: 1 },
		],
		segments: [{ kind: 'linear' }],
	};
}

async function storedAudioFinishing(page, projectId, trackId) {
	return page.evaluate(async ({ databaseName, id, selectedTrackId }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(
				database.transaction('projects', 'readonly').objectStore('projects').get(id),
			);
			const audioTrack = project?.tracks?.find((track) => track.id === selectedTrackId);
			return {
				schemaFamily: project?.schemaFamily ?? null,
				schemaVersion: project?.schemaVersion ?? null,
				mixerOutputName: project?.mixer?.outputs?.[0]?.name ?? null,
				automationLaneIds: project?.automationLanes?.map(({ id: laneId }) => laneId) ?? [],
				effectTypes: audioTrack?.effects?.map(({ type }) => type) ?? [],
				captionCueCount: project?.videoCaptionTracks?.[0]?.cues?.length ?? 0,
				audioClipDurationFrames: project?.clips?.find(({ kind }) => kind === 'audio')?.durationFrames ?? null,
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId, selectedTrackId: trackId });
}
