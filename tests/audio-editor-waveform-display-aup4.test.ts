/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAup4ExportPlan } from '../src/common/editor/aup4-export.js';
import { fixtureProject, track } from './helpers/aup4-export-harness.js';

test('AUP4 export converts frequency waveform displays to waveform with explicit reports', () => {
	for (const [displayMode, code] of [
		['waveform-three-band', 'THREE_BAND_WAVEFORM_DISPLAY_CONVERTED'],
		['waveform-rainbow', 'RAINBOW_WAVEFORM_DISPLAY_CONVERTED'],
	] as const) {
		const project = fixtureProject({
			sources: [],
			clips: [],
			tracks: [{ ...track(`track-${displayMode}`, []), displayMode }],
		});
		const plan = createAup4ExportPlan(project);
		assert.equal(plan.project.tracks[0]?.displayMode, 'waveform');
		assert.ok(plan.compatibilityReport.items.some((item: Readonly<{
			code: string;
			disposition: string;
			scope: Readonly<{ trackId?: string }>;
			data: Readonly<{ displayMode?: string }>;
		}>) => (
			item.code === code
			&& item.disposition === 'converted'
			&& item.scope.trackId === `track-${displayMode}`
			&& item.data.displayMode === 'waveform'
		)));
	}
});
