/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useProjectBinItems, useProjectBinSources, useProjectBinWaveformPath, useProjectBinTransformBadges,
	useProjectBinDuration, useProjectBinInstanceCount, useProjectBinMediaTiming } from '../src/common/editor/ui/workspace/useProjectBinPresentation.ts';
import { projectBinWaveformPath, projectBinTransformBadges, formatProjectBinDuration } from '../src/common/editor/ui/workspace/project-bin-model.ts';

void test('bin grouping, source joins, PCM paths, badges, durations and instance scans survive preview publications', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let groupingReads = 0, sourceReads = 0, pcmReads = 0, badgeReads = 0, instanceCalls = 0, timingReads = 0, formatterCalls = 0;
	const numberFormat = Intl.NumberFormat;
	Intl.NumberFormat = new Proxy(numberFormat, { construct(target, argumentsList, newTarget) { formatterCalls++; return Reflect.construct(target, argumentsList, newTarget) as Intl.NumberFormat; } });
	const clip = { id: 'clip', sourceId: 'source', kind: 'audio', durationFrames: 48000,
		get binItemId() { groupingReads++; return 'item'; }, get gain() { badgeReads++; return 0.5; } };
	const clips = [clip]; const sources = [{ get id() { sourceReads++; return 'source'; }, frameCount: 48000 }];
	const samples = new Float32Array(48000).fill(0.5);
	const buffer = { length: samples.length, numberOfChannels: 1, getChannelData() { pcmReads++; return samples; } };
	const visual = { buffer }; const copy = { projectBinTransformGain: 'gain' };
	const count = () => { instanceCalls++; return 2; }; const timelineClips = [clip];
	let project = { sampleRate: 48000, primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 25, den: 1 }, startTimecode: { hours: 0, minutes: 0, seconds: 0, frames: 0 } }] };
	const visualClip = { kind: 'generator', get sequenceFrameCount() { timingReads++; return 100; } };
	let result: readonly unknown[] = []; let durationFrames = 48000;
	function Harness({ revision }: { revision: number }) {
		const items = useProjectBinItems(clips); const joined = useProjectBinSources(items, sources);
		result = [items, joined, useProjectBinWaveformPath(visual, clip), useProjectBinTransformBadges(items[0]!.clips, joined.itemSources.get('item')!, copy),
			useProjectBinDuration(durationFrames, 48000, 'en'), useProjectBinInstanceCount(count, 'clip', timelineClips, clips), useProjectBinMediaTiming(project, null, null, visualClip).visualDuration];
		return <span>{revision}</span>;
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />));
		const first = result; const work = { groupingReads, sourceReads, pcmReads, badgeReads, instanceCalls, timingReads, formatterCalls };
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.deepEqual({ groupingReads, sourceReads, pcmReads, badgeReads, instanceCalls, timingReads, formatterCalls }, work);
		assert.equal(result[0], first[0]); assert.equal(result[1], first[1]); assert.equal(result[3], first[3]);
		assert.equal(result[2], projectBinWaveformPath(visual, clip));
		assert.deepEqual(result[3], projectBinTransformBadges(clip, sources[0], copy));
		assert.equal(result[4], formatProjectBinDuration(48000, 48000, 'en')); assert.equal(result[5], 2);
		assert.equal(result[6], 192000);
		durationFrames = 96000; await act(async () => root.render(<Harness revision={31} />));
		assert.equal(result[4], formatProjectBinDuration(96000, 48000, 'en'));
		project = { ...project, sequences: [{ ...project.sequences[0]!, rate: { num: 50, den: 1 } }] };
		await act(async () => root.render(<Harness revision={32} />)); assert.equal(result[6], 96000);
	} finally { await act(async () => root.unmount()); Intl.NumberFormat = numberFormat; globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
