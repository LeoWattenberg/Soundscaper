/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

/** Serializable witness: the renderer writes this key only after a successful paint. */
export function waveformPaintReadiness(canvases) {
	let painted = 0;
	for (const canvas of canvases) {
		const bounds = canvas.getBoundingClientRect();
		const geometry = [bounds.width, bounds.height, canvas.width, canvas.height,
			canvas.ownerDocument.defaultView?.devicePixelRatio || 1].join('|');
		if (bounds.width > 0 && bounds.height > 0 && canvas.width > 0 && canvas.height > 0
			&& canvas.dataset.waveformRenderer === 'audacity' && canvas.__kwWaveformState === 'audacity'
			&& canvas.dataset.waveformPending === undefined && canvas.dataset.waveformError === undefined
			&& typeof canvas.__kwWaveformDrawKey === 'string' && canvas.__kwWaveformDrawKey.endsWith(`|${geometry}`)) painted += 1;
	}
	return { count: canvases.length, painted };
}

export async function waitForCurrentWaveformPaint(editor, count) {
	const canvases = editor.locator('canvas.clip-body__waveform');
	const current = () => canvases.evaluateAll(waveformPaintReadiness);
	const completed = { count, painted: count };
	await expect.poll(current, { message: 'every clip must finish painting its current geometry' }).toEqual(completed);
	// A root resize schedules its retained draw on the following native frame.
	// Finish that render turn, including ResizeObserver delivery, then verify the
	// paint again. Never use redraw-count quietness to choose a performance window.
	await editor.evaluate(() => new Promise(resolve => {
		requestAnimationFrame(() => requestAnimationFrame(() => { setTimeout(resolve, 0); }));
	}));
	await expect.poll(current, { message: 'completed clip paints must still match after the retained frame' }).toEqual(completed);
}

export async function waitForPlayheadAdvance(editor) {
	const cursor = editor.locator('[data-playhead] .playhead-cursor__line');
	const initial = await cursor.boundingBox();
	expect(initial).not.toBeNull();
	await expect.poll(async () => (await cursor.boundingBox())?.x ?? initial.x,
		{ message: 'the native playback clock must advance the painted cursor' }).toBeGreaterThan(initial.x);
}

export async function waitForLiveAnalysisSignal(panel) {
	await expect.poll(() => panel.locator('[data-live-analysis-spectrum]').evaluate(canvas => {
		// The no-signal floor trace lives at the bottom edge; require actual audio
		// above it, using the existing stereo-spectrum paint oracle.
		const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.floor(canvas.height * 0.75));
		let signalPixels = 0;
		for (let offset = 0; offset < data.length; offset += 4) {
			if (data[offset] < 150 && data[offset + 1] > 120 && data[offset + 2] > 100) signalPixels += 1;
		}
		return signalPixels;
	}), { message: 'the spectrum must paint live audio above its floor trace' }).toBeGreaterThan(4);
	await expect.poll(() => panel.locator('[data-live-analysis-spectrogram]').evaluate(canvas => {
		const { data } = canvas.getContext('2d').getImageData(canvas.width - 1, 0, 1, canvas.height);
		let brightness = 0;
		for (let offset = 0; offset < data.length; offset += 4) {
			brightness = Math.max(brightness, data[offset], data[offset + 1], data[offset + 2]);
		}
		return brightness;
	}), { message: 'the current spectrogram column must paint live audio' }).toBeGreaterThan(80);
}
