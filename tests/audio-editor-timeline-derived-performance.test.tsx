/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useTimelineTrackCounts, useTimelineFrequencyRuler, useTimelineOutputDockContentHeight,
	useTimelineTotalTrackHeight, useTimelineTimeSelection, useTimelineWaveformCacheMembership,
	useTimelineDocumentDuration } from '../src/common/editor/ui/timeline/useTimelineViewportDerived.ts';
import { useTimelineRulerModels } from '../src/common/editor/ui/timeline/useTimelineRulerModels.ts';

void test('viewport derivations retain results through unrelated React renders and invalidate relevant edits', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let trackReads = 0;
	let busReads = 0;
	let heightCalls = 0;
	let cacheEnumerations = 0; let durationCalls = 0;
	const tracks = [{ id: 'audio', get type() { trackReads++; return 'audio'; }, displayMode: 'multiview' }, { id: 'label', type: 'label' }];
	const outputs = [{ bus: { get collapsed() { busReads++; return false; } } }];
	const selection = { startFrame: 24_000, endFrame: 48_000 };
	let automationIds: ReadonlySet<string> = new Set(['audio']);
	let rate = 48_000;
	let primarySequenceId = 'primary';
	const timing = { timeDisplay: { format: 'minutes-seconds' } };
	let scale: unknown;
	class MeasuredCache extends Map<string, number> { override keys() { cacheEnumerations++; return super.keys(); } }
	const cacheRef = { current: new MeasuredCache([['keep', 1], ['remove', 2]]) };
	const clipIds = new Set(['keep']); const clips: never[] = [];
	const calculate = () => { durationCalls++; return 2_000_000; };
	const height = () => { heightCalls++; return 100; };
	let result: unknown;
	function Harness({ revision }: { revision: number }) {
		void revision;
		scale = useTimelineRulerModels({ ...timing, selection: { revision } }, 100, rate, 0, 800).rulerScale;
		useTimelineWaveformCacheMembership(cacheRef, clipIds);
		useTimelineDocumentDuration({ id: 'project', clips, tracks, primarySequenceId, selection: { revision } }, rate, calculate);
		result = {
			counts: useTimelineTrackCounts(tracks, true, automationIds),
			frequency: useTimelineFrequencyRuler(tracks, true, 'waveform'),
			dock: useTimelineOutputDockContentHeight(outputs, 100, 20),
			height: useTimelineTotalTrackHeight(tracks, height, 100),
			selection: useTimelineTimeSelection(selection, rate),
		};
		return null;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />));
		const first = result as { counts: unknown; selection: unknown };
		const firstScale = scale;
		const initialReads = { trackReads, busReads, heightCalls, cacheEnumerations, durationCalls };
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.deepEqual({ trackReads, busReads, heightCalls, cacheEnumerations, durationCalls }, initialReads, 'selection/pointer publications perform zero repeat track, bus, lane-height, waveform-cache or duration reads');
		assert.deepEqual([...cacheRef.current], [['keep', 1]]);
		assert.equal((result as typeof first).counts, first.counts);
		assert.equal((result as typeof first).selection, first.selection, 'ruler selection dependencies stay stable');
		assert.equal(scale, firstScale, 'unrelated project replacements retain the ruler authority and ticks');
		automationIds = new Set(); rate = 96_000;
		await act(async () => root.render(<Harness revision={31} />));
		assert.deepEqual(result, { counts: { armedTrackCount: 1, automationControlsTrackCount: 0 }, frequency: true, dock: 100, height: 200,
			selection: { startTime: 0.25, endTime: 0.5 } });
		const priorDurationCalls = durationCalls; primarySequenceId = 'secondary';
		await act(async () => root.render(<Harness revision={32} />));
		assert.equal(durationCalls, priorDurationCalls + 1, 'switching the primary sequence invalidates fallback clip geometry');
	} finally {
		await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
