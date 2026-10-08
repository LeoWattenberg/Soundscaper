/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

const recording = createWavFixture({ name: 'channel-map.wav', frequency: 440, channelAmplitudes: [0.4, 0.1] });
const rms = samples => Math.sqrt(samples.slice(9600, 28800).reduce((sum, value) => sum + value * value, 0) / 19200);

test('Split stereo refuses an unrepresentable custom route without altering audio or history, then recovers after Reset', async ({ page }) => {
	const { editor, track, graph, inspector } = await setup(page);
	await inspector.locator('select[name="map-0"]').selectOption('1');
	await inspector.locator('select[name="map-1"]').selectOption('0');
	await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
	const before = await exportChannels(page, editor);
	expect(rms(before[0])).toBeGreaterThan(0.3);
	await chooseNestedCommandAction(page, editor, 'Window', ['History']);
	const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li');
	const count = await history.count();
	const clip = clipByName(editor, recording.name);
	const clipStyle = await clip.getAttribute('style');
	const connections = await graph.locator('[data-routing-edge]').count();
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor.getByRole('alert')).toContainText('Reset or remove the custom channel map in Routing graph');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clip).toHaveAttribute('style', clipStyle);
	await expect(history).toHaveCount(count);
	await expect(graph.locator('[data-routing-edge]')).toHaveCount(connections);
	await expect(inspector.locator('select[name="map-0"]')).toHaveValue('1');
	await expect(inspector.locator('select[name="map-1"]')).toHaveValue('0');
	expect(await exportChannels(page, editor)).toEqual(before);
	await inspector.getByRole('button', { name: 'Reset channel map', exact: true }).click();
	await expect(inspector.locator('select[name="map-0"]')).toHaveValue('0');
	await expect(inspector.locator('select[name="map-1"]')).toHaveValue('1');
	const resetHistory = await history.count();
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(history).toHaveCount(resetHistory + 1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clip).toHaveAttribute('style', clipStyle);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});

test('Split stereo retains both channels of an ordinary default send', async ({ page }) => {
	const { editor, track } = await setup(page);
	const before = await exportChannels(page, editor);
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const after = await exportChannels(page, editor);
	for (const channel of [0, 1]) expect(rms(after[channel])).toBeCloseTo(rms(before[channel]), 5);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});

async function setup(page) {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	const track = clipByName(editor, recording.name).locator('xpath=ancestor::*[@data-track-row][1]');
	const trackId = await track.getAttribute('data-track-id');
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add send bus', exact: true }).click();
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const bus = await graph.locator('[data-routing-node^="mixer-node:"]').getAttribute('data-routing-node');
	await graph.locator(`[data-routing-source="track:${trackId}"]`).press('Enter');
	await graph.locator(`[data-routing-destination="${bus}"]`).press('Enter');
	await graph.locator('[data-routing-edge]').last().press('Enter');
	return { editor, track, graph, inspector: graph.locator('[data-routing-inspector="edge"]') };
}

async function exportChannels(page, editor) {
	const dialog = await openExportDialog(page, editor);
	const link = dialog.locator('[data-export-download]');
	const previous = await link.count() ? await link.getAttribute('href') : null;
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
	const bytes = await readDownloadBytes(page, link);
	const channels = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const audio = await context.decodeAudioData(new Uint8Array(data).buffer);
			return Array.from({ length: audio.numberOfChannels }, (_, channel) => Array.from(audio.getChannelData(channel)));
		} finally { await context.close(); }
	}, Array.from(bytes));
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return channels;
}
