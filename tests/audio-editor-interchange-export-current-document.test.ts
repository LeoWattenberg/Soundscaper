/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	exportProjectEdl,
	exportProjectFcpxml,
	exportProjectOtio,
} from '../src/common/editor/controller/interchange-export-action.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';

/**
 * The three interchange profiles describe a document the product actually writes.
 *
 * Since the V10 foundation a persisted video clip states sequence frames and
 * source frames, and a musically anchored audio clip states beats; the sample
 * aliases the exporters read are resolved by the runtime projection and are not
 * on the document at all. The interchange action applied only the folder
 * projection, so every export of a real project containing a video clip threw
 * ("clip.timelineStartFrame must be a non-negative safe integer"), and a musical
 * audio clip was quietly written at the top of the timeline instead of at its
 * tempo-resolved position — wrong bytes with no error.
 *
 * The exporters' own suites never saw either case because their fixtures are
 * hand-written pre-V10 literals rather than documents from the product's
 * factories. These build the real thing.
 */

const NOW = '2026-08-19T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 25, den: 1 });

test('every interchange profile exports a current document that carries a video clip', async () => {
	const runtime = harness(videoProject());

	const edl = await exportProjectEdl(runtime.runtime);
	assert.ok(edl);
	// The clip starts one second into a 25fps sequence, so the record-in is the
	// frame the ruler shows rather than a sample count read as a frame count.
	assert.match(edl.text, /00:00:01:00/u);

	const otio = await exportProjectOtio(runtime.runtime);
	assert.ok(otio);
	const otioDocument = JSON.parse(otio.text) as {
		tracks: { children: { children: { OTIO_SCHEMA: string; source_range?: unknown }[] }[] };
	};
	const videoTrack = otioDocument.tracks.children[0]!;
	assert.equal(videoTrack.children.at(-1)?.OTIO_SCHEMA.startsWith('Clip'), true);

	const fcpxml = await exportProjectFcpxml(runtime.runtime);
	assert.ok(fcpxml);
	assert.match(fcpxml.text, /<asset-clip/u);
});

test('a musically anchored audio clip is exported where the tempo map puts it', async () => {
	const runtime = harness(musicalProject());
	const otio = await exportProjectOtio(runtime.runtime);
	assert.ok(otio);
	const otioDocument = JSON.parse(otio.text) as {
		tracks: { children: { children: { OTIO_SCHEMA: string }[] }[] };
	};
	const audioTrack = otioDocument.tracks.children[0]!;
	// Four beats at 120bpm is two seconds of leader, which OTIO states as a Gap
	// before the clip. Reading the missing sample alias as zero wrote the clip at
	// the top of the timeline instead.
	assert.equal(audioTrack.children[0]?.OTIO_SCHEMA.startsWith('Gap'), true);
	assert.equal(audioTrack.children[1]?.OTIO_SCHEMA.startsWith('Clip'), true);
});

function harness(project: Readonly<Record<string, unknown>>) {
	const saved: Record<string, unknown>[] = [];
	const state: Record<string, unknown> = {};
	return {
		saved,
		state,
		runtime: {
			getProject: () => project,
			state,
			fileService: { saveFile: (request: Record<string, unknown>) => { saved.push(request); } },
			publishDocumentSnapshot: () => undefined,
			sequenceId: 'seq',
		},
	};
}

function videoProject() {
	return createSoundscaperProjectV23({
		id: 'interchange-video', title: 'Interchange video', now: NOW,
		sources: [createVideoSource({
			id: 'cam', name: 'CAM A', storageKey: 'media/cam.mp4', mimeType: 'video/mp4',
			frameCount: SAMPLE_RATE * 10, sampleRate: SAMPLE_RATE, channelCount: 2,
			frameRate: PAL, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'v-clip', sourceId: 'cam', title: 'Wide', sequenceId: 'seq',
			sequenceStartFrame: 25, sequenceFrameCount: 50, sourceInFrame: 0, sourceFrameCount: 50,
		}],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v-clip'] }],
		sequences: [{ id: 'seq', name: 'Sequence', rate: PAL, trackIds: ['v1'] }],
		primarySequenceId: 'seq',
	});
}

function musicalProject() {
	const source = createAudioSource({
		id: 'bed', name: 'MIX', storageKey: 'media/mix.wav',
		frameCount: SAMPLE_RATE * 10, channelCount: 2, sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	return createSoundscaperProjectV23({
		id: 'interchange-musical', title: 'Interchange musical', now: NOW,
		sources: [source],
		clips: [createAudioClip({
			id: 'a-clip', sourceId: 'bed', title: 'Bed',
			anchor: 'musical', musicalStartBeat: { num: 4, den: 1 },
			durationFrames: SAMPLE_RATE, sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE,
		})],
		tracks: [createAudioTrack({ id: 'a1', name: 'A1', clipIds: ['a-clip'] })],
		sequences: [{ id: 'seq', name: 'Sequence', rate: PAL, trackIds: ['a1'] }],
		primarySequenceId: 'seq',
	});
}
