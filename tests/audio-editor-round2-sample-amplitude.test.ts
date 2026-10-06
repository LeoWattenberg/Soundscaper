/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePointAtPointer } from '../src/common/editor/ui/timeline/track-row-helpers.jsx';

test('a pencil screen displacement accounts for linear waveform vertical magnification', () => {
	for (const waveformRulerFormat of ['linear-amp', 'linear-db']) {
		for (const zoom of [0, 1, 3]) {
			for (const [clientY, value] of [[45, 0.5], [95, -0.5]]) {
				const lane = { dataset: { waveformRulerFormat, waveformZoom: String(zoom), channelBodyTop: '20' },
					getBoundingClientRect: () => ({ height: 120, top: 0 }) };
				const point = samplePointAtPointer({ clientX: 10, clientY }, lane,
					{ timelineStartFrame: 0, durationFrames: 10 }, { channelCount: 1 }, () => 5);
				assert.equal(point.value, value! / 2 ** zoom);
				assert.equal(point.timelineFrame, 5);
			}
		}
	}
});
