/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
} from './audio-editor-test-helpers.js';

for (const platform of ['web', 'desktop']) {
	test(`${platform} playback computes production strip meters in a dedicated worker`, async ({ page }) => {
		test.setTimeout(90_000);
		await page.addInitScript((desktop) => {
			const probe = { created: 0, submissions: 0, results: 0, transferredBuffers: 0,
				maximumPeak: 0, workerErrors: [] };
			Object.defineProperty(globalThis, '__productionStripMeterWorkerProbe', {
				configurable: true, value: probe,
			});
			if (desktop) Object.defineProperty(globalThis, 'soundscaperDesktop', {
				configurable: true,
				value: Object.freeze({ v1: Object.freeze({
					getEnvironment: async () => ({ platform: 'linux' }),
				}) }),
			});
			const NativeWorker = globalThis.Worker;
			globalThis.Worker = class extends NativeWorker {
				constructor(url, options) {
					super(url, options);
					this.productionStripMeter = options?.name === 'soundscaper-production-strip-meter';
					if (!this.productionStripMeter) return;
					probe.created += 1;
					this.addEventListener('message', ({ data }) => {
						if (data?.type === 'error') {
							probe.workerErrors.push(data.error?.message ?? 'Unknown meter worker error');
							return;
						}
						if (data?.type !== 'result') return;
						probe.results += 1;
						for (const strip of data.snapshot ?? []) {
							for (const channel of strip.channels ?? []) {
								probe.maximumPeak = Math.max(probe.maximumPeak, channel.peak);
							}
						}
					});
					this.addEventListener('error', (event) => {
						probe.workerErrors.push(event.message || 'Meter worker failed');
					});
				}
				postMessage(message, transfer) {
					if (this.productionStripMeter && message?.type === 'sample') {
						probe.submissions += 1;
						probe.transferredBuffers += transfer?.length ?? 0;
					}
					return super.postMessage(message, transfer);
				}
			};
		}, platform === 'desktop');

		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		const mixer = editor.locator('[data-mixer-panel]');
		await expect(mixer).toBeVisible();
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => {
			const probe = globalThis.__productionStripMeterWorkerProbe;
			const fill = document.querySelector('[data-mixer-panel] .kw-audio-editor__mixer-channel--master .mixer-channel__meter-fill');
			const level = 100 - Number.parseFloat(fill?.style.top ?? '100');
			return probe.created > 0 && probe.submissions > 0 && probe.results > 0
				&& probe.transferredBuffers > 0 && probe.maximumPeak > 0.05 && level > 20;
		}), {
			message: `the ${platform} meter worker should process audible PCM while the mixer shows playback`,
			timeout: 20_000,
		}).toBe(true);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		const probe = await page.evaluate(() => globalThis.__productionStripMeterWorkerProbe);
		expect(probe.workerErrors).toEqual([]);
		expect(errors).toEqual([]);
	});
}
