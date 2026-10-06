/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findClipSilenceRegions } from '../src/common/editor/clip-silence-regions.ts';
import { createClipboardEditService, type ClipboardEditProject } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';

const NOW = '2026-10-07T00:00:00.000Z';

const project = { sampleRate: 48_000, tempoMap: { mode: 'musical' as const,
	events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] }, clips: [], tracks: [] };
const clip = { id: 'clip', kind: 'audio', anchor: 'sample', sourceId: 'recording',
	timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
	warpMap: { feature: 'audio-warp', points: [
		{ outer: 0, source: 0, mode: 'forward' }, { outer: 24_000, source: 36_000, mode: 'forward' },
		{ outer: 48_000, source: 48_000, mode: 'forward' },
	] } };
function recording(start = 12_000, end = 24_000) {
	const data = new Float32Array(48_000).fill(0.5);
	data.fill(0, start, end);
	return { sampleRate: 48_000, numberOfChannels: 1, getChannelData: () => data };
}

test('detected source silence is returned at the inverse authored warp position', () => {
	assert.deepEqual(findClipSilenceRegions(clip, recording(), null, project), [[8_000, 16_000]]);
});

test('a labeled time window scans its actual warped source interval', () => {
	assert.deepEqual(findClipSilenceRegions(clip, recording(), { startFrame: 10_000, endFrame: 18_000 }, project), [[10_000, 16_000]]);
	assert.deepEqual(findClipSilenceRegions(clip, recording(), { startFrame: 18_000, endFrame: 23_000 }, project), []);
});

test('an automatic detector resolves fractional inverse boundaries to existing editable material', () => {
	assert.deepEqual(findClipSilenceRegions(clip, recording(12_000, 24_001), null, project), [[8_000, 16_000]]);
});

test('trimmed source and moved timeline origins retain their independent exact clocks', () => {
	const trimmed = { ...clip, timelineStartFrame: 12_000, sourceStartFrame: 48_000,
		warpMap: { ...clip.warpMap, points: clip.warpMap.points.map(point => ({ ...point, source: point.source + 48_000 })) } };
	const data = new Float32Array(96_000).fill(0.5);
	data.fill(0, 60_000, 72_000);
	assert.deepEqual(findClipSilenceRegions(trimmed, { sampleRate: 48_000, numberOfChannels: 1,
		getChannelData: () => data }, null, project), [[20_000, 28_000]]);
});

test('the production edit service detaches mapped material atomically and preserves exact warp views through Undo and Redo', async () => {
	const source = createAudioSource({ id: 'recording', name: 'Recording', storageKey: 'recording',
		mimeType: 'audio/wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1, chunkFrames: 65_536 });
	const document = createSoundscaperProject({ id: 'project', title: 'Warped pause', now: NOW,
		sources: [source], clips: [createAudioClip(clip)],
		tracks: [createAudioTrack({ id: 'audio', name: 'Recording', clipIds: ['clip'] })] });
	const runtime = createSoundscaperProjectRuntimeSelection();
	let history = runtime.createHistory(document);
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	let nextId = 0;
	const service = createClipboardEditService({ lifetime, state: { selectedTrackId: 'audio', selectedClipId: 'clip', clipboard: null },
		copy: { noSilencesFound: 'No silences', track: 'Track' },
		getProject: () => runtime.projectForCommandConsumers(history.present) as ClipboardEditProject,
		editingBlocked: () => false, getPositionFrames: () => 0, normalizeFrame: Number, snapFrame: Number,
		createId: prefix => `${prefix}-${String(++nextId)}`, setStatus() {},
		commit: command => { history = runtime.executeCommand(history, command); },
		sourceBuffers: new Map([['recording', recording(12_000, 24_001)]]),
		session: { setClipboard: descriptor => ({ clipboard: { descriptor, sources: [] } }), clipboardForProject: () => null },
	});
	await service.disjoinSelectedClip();
	const after = history.present;
	assert.equal(after.clips.length, 2);
	const left = after.clips.find(item => item.id === 'clip');
	assert.ok(left && 'durationFrames' in left && 'sourceDurationFrames' in left);
	assert.equal(left.durationFrames, 8_000);
	assert.equal(left.sourceDurationFrames, 12_000);
	history = runtime.undo(history);
	assert.deepEqual(history.present.clips, document.clips);
	history = runtime.redo(history);
	assert.deepEqual(history.present.clips, after.clips);
});
