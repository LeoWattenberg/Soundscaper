/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, closeWorkspacePanel,
	disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

test('a normal master envelope survives native playback projection and a following selection', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1080 });
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	await closeWorkspacePanel(editor, 'source-monitor');
	await importFiles(editor, [createWavFixture({ name: 'Master envelope recording.wav', duration: 1,
		frequency: 440, channelCount: 1, channelAmplitudes: [.2] })]);
	const dry = await exportAudio(page, editor);
	expect(dry).toHaveLength(48_000);
	const dryRms = rms(dry);
	expect(dryRms).toBeGreaterThan(.08);
	await chooseCommandAction(page, editor, 'View', 'Master track');
	const row = editor.locator('[data-output-track-row][data-output-scope="master"]');
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Track menu', exact: true }).click();
	await page.locator('.audio-editor-output-track-menu').getByRole('menuitem', { name: 'Expand track', exact: true }).click();
	await expect(row).toHaveAttribute('data-collapsed', 'false');
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	await chooseCommandAction(page, editor, 'Window', 'History');
	const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li:not([data-redo])');
	const changes = history.filter({ hasText: 'master/update' });
	const beforeChanges = await changes.count();
	const point = row.locator('.envelope-point').first();
	await expect(point).toBeVisible();
	const pointY = () => point.evaluate(element => element.getBoundingClientRect().y
		- element.closest('[data-output-track-row]').getBoundingClientRect().y);
	const initial = await pointY();
	const box = await point.boundingBox();
	expect(box).not.toBeNull();
	const x = box.x + box.width / 2 + 32, y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + 30, { steps: 6 });
	await expect.poll(pointY).toBeGreaterThan(initial + 20);
	await page.mouse.up();
	await expect(changes).toHaveCount(beforeChanges + 1);
	const wet = await exportAudio(page, editor);
	expect(wet).toHaveLength(dry.length);
	const wetRms = rms(wet);
	expect(wetRms / dryRms).toBeGreaterThan(.1);
	expect(wetRms / dryRms).toBeLessThan(.4);
	await expect.poll(pointY).toBeGreaterThan(initial + 20);
	const acceptedY = await pointY();
	await editor.locator('[data-track-row]').last().locator('[data-track-header]').click({ position: { x: 4, y: 4 } });
	await expect.poll(pointY).toBeCloseTo(acceptedY, 1);
	const selected = await exportAudio(page, editor);
	expect(rms(selected)).toBeCloseTo(wetRms, 5);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});

async function exportAudio(page, editor) {
	const dialog = await openExportDialog(page, editor, { label: 'Export video' });
	const link = dialog.locator('[data-export-download]');
	const previous = await link.getAttribute('href');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect(link).toHaveAttribute('download', /\.wav$/u);
	await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
	const bytes = await readDownloadBytes(page, link);
	const samples = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try { return Array.from((await context.decodeAudioData(new Uint8Array(data).buffer)).getChannelData(0)); }
		finally { await context.close(); }
	}, Array.from(bytes));
	await closeDialog(dialog);
	return samples;
}

function rms(samples) {
	let energy = 0;
	for (let frame = 12_000; frame < 36_000; frame++) energy += samples[frame] ** 2;
	return Math.sqrt(energy / 24_000);
}
