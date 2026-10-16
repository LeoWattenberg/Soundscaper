/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { waveformPaintReadiness } from './browser/helpers/performance-paint-readiness.js';

function canvas() {
	const bounds = { width: 123.5, height: 80 };
	return {
		dataset: { waveformRenderer: 'audacity' } as Record<string, string>,
		__kwWaveformState: 'audacity',
		__kwWaveformDrawKey: 'completed-plan|123.5|80|247|160|2',
		width: 247, height: 160,
		ownerDocument: { defaultView: { devicePixelRatio: 2 } },
		getBoundingClientRect: () => bounds,
		bounds,
	};
}

test('a successful waveform paint becomes stale when layout changes until that geometry is painted', () => {
	const painted = canvas();
	assert.deepEqual(waveformPaintReadiness([painted]), { count: 1, painted: 1 });
	painted.bounds.width = 120;
	assert.deepEqual(waveformPaintReadiness([painted]), { count: 1, painted: 0 });
	painted.width = 240;
	painted.__kwWaveformDrawKey = 'replacement-plan|120|80|240|160|2';
	assert.deepEqual(waveformPaintReadiness([painted]), { count: 1, painted: 1 });
});

test('retained pending or failed waveforms never qualify as completed measurement setup', () => {
	for (const marker of ['waveformPending', 'waveformError']) {
		const painted = canvas();
		painted.dataset[marker] = '';
		assert.deepEqual(waveformPaintReadiness([painted]), { count: 1, painted: 0 });
	}
});

test('measurement readiness requires every actual canvas to be painted and visible', () => {
	const incomplete = canvas();
	incomplete.__kwWaveformState = 'empty';
	assert.deepEqual(waveformPaintReadiness([canvas(), incomplete]), { count: 2, painted: 1 });
	incomplete.__kwWaveformState = 'audacity';
	delete incomplete.dataset.waveformRenderer;
	assert.deepEqual(waveformPaintReadiness([incomplete]), { count: 1, painted: 0 });
	incomplete.dataset.waveformRenderer = 'audacity';
	incomplete.bounds.height = 0;
	assert.deepEqual(waveformPaintReadiness([incomplete]), { count: 1, painted: 0 });
	assert.deepEqual(waveformPaintReadiness([]), { count: 0, painted: 0 });
});
