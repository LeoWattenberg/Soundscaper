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

test('AUP4 export reports enabled half-wave flags and every explicit RMS override', () => {
	for (const showRms of [true, false]) {
		const project = fixtureProject({
			sources: [], clips: [],
			tracks: [{ ...track('options', []), displayMode: 'waveform', halfWave: true, showRms }],
		});
		const plan = createAup4ExportPlan(project);
		const exportedTrack = plan.project.tracks[0];
		assert.equal(exportedTrack?.displayMode, 'waveform');
		assert.equal(Object.hasOwn(exportedTrack, 'halfWave'), false);
		assert.equal(Object.hasOwn(exportedTrack, 'showRms'), false);
		const reports = plan.compatibilityReport.items as readonly Readonly<{
			code: string; disposition: string; scope: Readonly<{ trackId?: string }>;
			data: Readonly<{ halfWave?: boolean; showRms?: boolean }>;
		}>[];
		assert.ok(reports.some((item) => item.code === 'HALF_WAVE_DISPLAY_CONVERTED'
			&& item.disposition === 'converted' && item.scope.trackId === 'options'));
		assert.ok(reports.some((item) => item.code === 'TRACK_RMS_DISPLAY_OMITTED'
			&& item.disposition === 'omitted' && item.data.showRms === showRms));
		assert.equal(project.tracks[0].halfWave, true, 'the open project remains unchanged');
		assert.equal(project.tracks[0].showRms, showRms);
	}
});

test('AUP4 does not report disabled half-wave or duplicate legacy half-wave conversions', () => {
	for (const [displayMode, halfWave, expectedConversions] of [
		['waveform', false, 0], ['half-wave', true, 1],
	] as const) {
		const plan = createAup4ExportPlan(fixtureProject({
			sources: [], clips: [],
			tracks: [{ ...track('half', []), displayMode, halfWave }],
		}));
		assert.equal(plan.compatibilityReport.items.filter((item: Readonly<{ code: string }>) => (
			item.code === 'HALF_WAVE_DISPLAY_CONVERTED'
		)).length, expectedConversions);
		assert.equal(Object.hasOwn(plan.project.tracks[0], 'halfWave'), false);
	}
});
