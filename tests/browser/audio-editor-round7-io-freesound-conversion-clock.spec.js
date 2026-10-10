/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../src/common/editor/wav.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('Freesound native recording conversion clock', () => {
	registerAudioEditorHooks();
	for (const sampleRate of [44_100, 96_000]) test(`the ordinary ${sampleRate} Hz broadcast recording retains its source clock and PCM through upload`, async ({ page }) => {
		const frames = sampleRate / 4;
		const samples = Float32Array.from({ length: frames }, (_, frame) =>
			.2 * Math.sin(2 * Math.PI * 3_000 * frame / sampleRate)
			+ (sampleRate === 96_000 ? .15 * Math.sin(2 * Math.PI * 26_000 * frame / sampleRate) : 0));
		// Ordinary 24-bit BWF, produced by the application's delivery writer.
		const input = Buffer.from(encodeWav([samples], {
			sampleRate, bitDepth: 24, dither: 'none',
			bext: { description: 'High resolution field recording', originator: 'Soundscaper', timeReference: '0' },
		}));
		const original = await inspectWavBlobPcm(new Blob([input]));
		expect(original.sampleRate).toBe(sampleRate);
		expect(original.frameCount).toBe(frames);
		const uploads = [];
		await page.route('**/api/freesound/**', async route => {
			const request = route.request();
			const path = new URL(request.url()).pathname;
			if (path === '/api/freesound/oauth/session') await route.fulfill({ json: { data: { connected: true, user: { id: 7, username: 'browser-tester' } } } });
			else if (path === '/api/freesound/uploads/pending') await route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } });
			else if (path === '/api/freesound/uploads') {
				uploads.push({ name: request.headers()['x-freesound-filename'], type: request.headers()['content-type'], bytes: request.postDataBuffer() });
				await route.fulfill({ status: 201, json: { data: { uploadFilename: 'remote-field-recording.wav' } } });
			} else await route.fulfill({ status: 404, json: {} });
		});
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Window', 'Freesound');
		const panel = editor.locator('[data-workspace-panel="freesound"]');
		await expect(panel.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
		const area = panel.locator('[data-freesound-uploads="true"]');
		await area.getByText('Upload to Freesound', { exact: true }).click();
		const chosen = page.waitForEvent('filechooser');
		await area.getByRole('button', { name: 'Choose audio files', exact: true }).click();
		// audio/wav made this standard BWF reachable before suffix admission IO041.
		await (await chosen).setFiles({ name: 'field-recording.bwf', mimeType: 'audio/wav', buffer: input });
		await expect(area.getByRole('button', { name: /^Ready to publish\s*:/u })).toHaveCount(1);
		await expect(area.getByRole('alert')).toHaveCount(0);
		expect(uploads).toHaveLength(1);
		expect(uploads[0].name).toBe('field-recording.wav');
		expect(uploads[0].type).toBe('audio/wav');
		const blob = new Blob([uploads[0].bytes]);
		const delivered = await inspectWavBlobPcm(blob);
		const pcm = [];
		await streamWavBlobPcm(blob, { onChunk: channels => { pcm.push(...channels[0]); } });
		const programmeAmplitude = toneAmplitude(pcm, 3_000, delivered.sampleRate);
		const upperBandAmplitude = toneAmplitude(pcm, 26_000, delivered.sampleRate);
		expect(programmeAmplitude).toBeGreaterThan(.19);
		expect(delivered.sampleRate, JSON.stringify({ sourceRate: sampleRate, deliveredRate: delivered.sampleRate,
			frames: delivered.frameCount, programmeAmplitude, upperBandAmplitude })).toBe(sampleRate);
		expect(Math.abs(delivered.frameCount - frames)).toBeLessThanOrEqual(1);
		if (sampleRate === 96_000) expect(upperBandAmplitude).toBeGreaterThan(.145);
	});
});

function toneAmplitude(samples, frequency, sampleRate) {
	let sine = 0; let cosine = 0;
	for (let frame = 0; frame < samples.length; frame += 1) {
		const phase = 2 * Math.PI * frequency * frame / sampleRate;
		sine += samples[frame] * Math.sin(phase); cosine += samples[frame] * Math.cos(phase);
	}
	return 2 * Math.hypot(sine, cosine) / samples.length;
}
