/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeWorkspacePanel, getMenuItem, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { installWebVcrHost } from './helpers/web-vcr-host.js';

test.use({ browserCoverage: false });

for (const mute of [false, true]) test(`Web VCR page-audio preview ${mute ? 'follows Playback volume' : 'retains its independent local mute'}`, async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__webVcrSpeakerOutputs = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser();
				analyser.fftSize = 2048;
				Reflect.apply(connect, this, [analyser, ...ports]);
				const output = { peak: 0, samples: 0 };
				globalThis.__webVcrSpeakerOutputs.push(output);
				const samples = new Float32Array(analyser.fftSize);
				const interval = setInterval(() => {
					if (this.context.state === 'closed') { clearInterval(interval); return; }
					analyser.getFloatTimeDomainData(samples);
					output.peak = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
					output.samples++;
				}, 20);
			}
			return result;
		};
	});
	await installWebVcrHost(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	const menu = await openNestedCommandMenu(page, editor, 'Window', []);
	await getMenuItem(menu, 'Recording setup').click();
	const setup = editor.locator('[data-workspace-panel="recording-setup"] [data-framescaper-recording-setup]');
	await expect(setup).toBeVisible();
	await expect(setup.getByRole('status')).not.toContainText('Checking capture support');
	await editor.getByRole('button', { name: 'Capture options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Web VCR', exact: true }).click();
	const panel = editor.locator('[data-workspace-panel="web-vcr"] [data-framescaper-web-vcr]');
	await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready');
	const peak = () => page.evaluate(() => Math.max(0, ...globalThis.__webVcrSpeakerOutputs.map(output => output.peak)));
	await expect.poll(peak).toBeGreaterThan(.1);
	const localMute = panel.getByRole('checkbox', { name: 'Mute local audio', exact: true });
	await localMute.check();
	await expect.poll(peak).toBeLessThan(.001);
	await localMute.uncheck();
	await expect.poll(peak).toBeGreaterThan(.1);
	const volume = editor.getByRole('slider', { name: 'Playback volume', exact: true });
	if (mute) {
		await volume.fill('0');
		await expect(volume).toHaveAttribute('aria-valuetext', '−∞ dB');
		await expect.poll(peak).toBeLessThan(.001);
		await volume.fill('0.8');
		await expect(volume).toHaveAttribute('aria-valuetext', '−12 dB');
		await expect.poll(peak).toBeGreaterThan(.24);
		await expect.poll(peak).toBeLessThan(.26);
	}
	await volume.fill('1');
	await expect.poll(peak).toBeGreaterThan(.1);
	await localMute.check();
	await volume.fill('0');
	await volume.fill('1');
	await expect.poll(peak).toBeLessThan(.001);
	await closeWorkspacePanel(editor, 'web-vcr');
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperWebVcrHarness.disposedSessions)).toBe(1);
	await expect.poll(peak).toBeLessThan(.001);
});
