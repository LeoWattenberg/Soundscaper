/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioTrackVisualRevisionReader } from '../src/common/editor/ui/timeline/audio-track-visual-revision.ts';
import { createAudioTrackClipSelectionReader } from '../src/common/editor/ui/timeline/audio-track-clip-selection.ts';
import type { TimelineClipVisualData } from '../src/common/editor/ui/timeline/waveform-view-model.ts';

test('audio row visual revision ignores fresh wrappers and refreshes each waveform content reference', () => {
	const read = createAudioTrackVisualRevisionReader();
	const source = { id: 'source' };
	let visual: TimelineClipVisualData = { source, available: true };
	const controller = { getClipVisualData: () => ({ ...visual }) };
	const clips = [{ id: 'clip' }];
	let revision = read(controller, clips);
	assert.equal(read(controller, clips), revision);
	const replacements: readonly TimelineClipVisualData[] = [
		{ source: { id: 'replacement' } },
		{ available: false },
		{ buffer: { numberOfChannels: 1, getChannelData: () => new Float32Array(1) } },
		{ peaks: {} },
		{ pcmWindow: { startFrame: 0, endFrame: 1, channels: [new Float32Array(1)] } },
		{ peakWindow: { startFrame: 0, endFrame: 1, blockSize: 1, channels: [] } },
		{ frequencyAnalysis: {} },
		{ frequencyWindow: {} },
	];
	for (const replacement of replacements) {
		visual = { ...visual, ...replacement };
		const next = read(controller, clips);
		assert.notEqual(next, revision);
		assert.equal(read(controller, clips), next);
		revision = next;
	}
});

test('audio row revisions read only projected media and fall back to project-bin data', () => {
	const read = createAudioTrackVisualRevisionReader();
	const reads: string[] = [];
	let binVisual: TimelineClipVisualData | null = { available: true, peaks: {} };
	const controller = {
		getClipVisualData: (id: string) => { reads.push(`timeline:${id}`); return null; },
		getProjectBinClipVisualData: (id: string) => { reads.push(`bin:${id}`); return binVisual; },
	};
	const clips = [{ id: 'preview', projectBinClipId: 'bin' }, { id: 'recording', isRecordingPreview: true }];
	const revision = read(controller, clips);
	assert.deepEqual(reads, ['timeline:preview', 'bin:bin']);
	binVisual = null;
	assert.notEqual(read(controller, clips), revision, 'a removed source invalidates the model');
	const empty = read(controller, []);
	assert.equal(read(controller, [{ id: 'recording', isRecordingPreview: true }]), empty);
});

test('audio row selection retains identity until projected clip membership changes', () => {
	const read = createAudioTrackClipSelectionReader();
	const clips = [{ id: 'first' }, { id: 'second' }];
	const empty = read(clips, new Set(), null);
	assert.equal(read(clips, new Set(['other-row']), 'first'), empty,
		'explicit selection overrides the fallback clip and excludes other rows');
	const selected = read(clips, new Set(), 'first');
	assert.deepEqual([...selected], ['first']);
	assert.equal(read(clips, new Set(['first', 'other-row']), 'second'), selected);
	const both = read(clips, new Set(['first', 'second']), null);
	assert.notEqual(both, selected);
	assert.deepEqual([...both], ['first', 'second']);
	const trimmed = read([{ id: 'second' }], new Set(['first', 'second']), null);
	assert.deepEqual([...trimmed], ['second'], 'removed projected clips leave the selection');
});
