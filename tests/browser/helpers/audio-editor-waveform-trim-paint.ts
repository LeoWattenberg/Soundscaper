/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, type Locator } from '@playwright/test';

interface WaveformPaintPlan {
	readonly pixelsPerSample: number;
	readonly pixelWidth: number;
}

interface WaveformPaintCanvas extends HTMLCanvasElement {
	readonly __kwWaveformPlan: WaveformPaintPlan;
}

type WaveformPreviewWindow = Window & typeof globalThis & {
	readonly __trimPreviewWaveformPlan: WaveformPaintPlan;
};

interface WaveformTrimReference {
	readonly pixelsPerSample: number;
	readonly drawScale: number;
}

export async function expectWaveformTrimPaint(
	waveform: Locator,
	beforeTrim: WaveformTrimReference,
): Promise<void> {
	// DOM resizing precedes the retained canvas paint; inspect one painted
	// snapshot while the pointer still owns the trim gesture.
	await expect(async () => {
		const duringTrim = await waveform.evaluate((element: HTMLElement | SVGElement) => {
			if (!(element instanceof HTMLCanvasElement)) throw new TypeError('The waveform must be a canvas.');
			const canvas = element as WaveformPaintCanvas;
			const previewWindow = window as WaveformPreviewWindow;
			return {
				reusedPlan: canvas.__kwWaveformPlan === previewWindow.__trimPreviewWaveformPlan,
				pixelsPerSample: canvas.__kwWaveformPlan.pixelsPerSample,
				drawScale: canvas.getBoundingClientRect().width / canvas.__kwWaveformPlan.pixelWidth,
			};
		});
		expect(duringTrim.reusedPlan).toBe(false);
		expect(duringTrim.pixelsPerSample).toBeCloseTo(beforeTrim.pixelsPerSample, 4);
		expect(duringTrim.drawScale).toBeCloseTo(beforeTrim.drawScale, 2);
	}).toPass({ timeout: 5_000 });
}
