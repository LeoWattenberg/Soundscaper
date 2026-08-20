/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createBrowserFramescaperCaptureLevelMonitor,
	createBrowserFramescaperCapturePreviewSurface,
} from '../src/common/editor/controller/framescaper-browser-capture-preview.ts';

test('browser video preview uses the live stream and owns no synthetic object URL', async () => {
	const stream = { id: 'camera-stream' };
	const surface = createBrowserFramescaperCapturePreviewSurface({
		sourceId: 'camera', role: 'camera', stream, track: {}, settings: {}, capabilities: {},
	});
	assert.equal(surface.stream, stream);
	assert.equal(surface.url, null);
	await surface.dispose();
	await surface.dispose();
});

test('browser audio level monitor reports RMS without connecting to output and releases exactly', async () => {
	let sample: (() => void) | null = null;
	let clears = 0;
	let closes = 0;
	let resumes = 0;
	let sourceDisconnects = 0;
	let analyserDisconnects = 0;
	let notifications = 0;
	const analyser = {
		fftSize: 0,
		frequencyBinCount: 4,
		getFloatTimeDomainData(values: Float32Array) { values.set([0, 0.5, -0.5, 0]); },
		disconnect() { analyserDisconnects += 1; },
	};
	const monitor = await createBrowserFramescaperCaptureLevelMonitor({
		sourceId: 'microphone', role: 'microphone', stream: { id: 'microphone-stream' },
		track: {}, settings: {}, capabilities: {},
	}, () => { notifications += 1; }, {
		createAudioContext: () => ({
			state: 'suspended',
			createMediaStreamSource: () => ({
				connect(value: unknown) { assert.equal(value, analyser); },
				disconnect() { sourceDisconnects += 1; },
			}),
			createAnalyser: () => analyser,
			async resume() { resumes += 1; },
			async close() { closes += 1; },
		}),
		setInterval(callback) { sample = callback; return 17; },
		clearInterval(timer) { assert.equal(timer, 17); clears += 1; },
	});

	assert.equal(resumes, 1);
	assert.equal(monitor.level, null);
	assert.ok(sample);
	(sample as () => void)();
	assert.ok(Math.abs((monitor.level ?? 0) - Math.sqrt(0.125)) < 0.000_001);
	assert.equal(notifications, 1);
	await monitor.dispose();
	await monitor.dispose();
	assert.deepEqual({ clears, closes, sourceDisconnects, analyserDisconnects }, {
		clears: 1, closes: 1, sourceDisconnects: 1, analyserDisconnects: 1,
	});
});
