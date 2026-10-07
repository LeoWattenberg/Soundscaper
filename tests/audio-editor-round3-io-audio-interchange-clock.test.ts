/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function trimmedRecording() {
	const source = createAudioSource({ id: 'recording', name: 'Native.wav', sampleRate: 32_000, frameCount: 32_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'trimmed', sourceId: source.id, sourceStartFrame: 16_000,
		sourceDurationFrames: 16_000, durationFrames: 24_000, timelineStartFrame: 24_000 });
	return projectForRuntimeConsumers(createSoundscaperProject({ id: 'native-audio-clock', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'audio', clipIds: [clip.id] })],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['audio'] }], primarySequenceId: 'main',
	}) as never) as unknown as Readonly<Record<string, unknown>>;
}

test('FCPXML keeps a native-rate audio trim on the sequence grid', () => {
	const project = trimmedRecording();
	const original = structuredClone(project);
	assert.match(createFcpxmlExport({ project, sequenceRate: { num: 30, den: 1 } }).text, /<asset-clip[^>]* start="1\/2s"/u);
	assert.deepEqual(project, original);
});

test('OTIO audio source time crosses from native samples to its delivered rate', () => {
	const result = createOtioExport({ project: trimmedRecording(), sequenceRate: { num: 30, den: 1 } });
	const delivered = JSON.parse(result.text) as { tracks: { children: { kind: string; children: { OTIO_SCHEMA: string; source_range?: { start_time: unknown } }[] }[] } };
	const range = delivered.tracks.children.find(track => track.kind === 'Audio')?.children.find(clip => clip.OTIO_SCHEMA === 'Clip.1')?.source_range;
	assert.deepEqual(range?.start_time, { OTIO_SCHEMA: 'RationalTime.1', value: 24_000, rate: 48_000 });
});
