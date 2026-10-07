/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	exportProjectEdl,
	exportProjectFcpxml,
	exportProjectOtio,
} from '../src/common/editor/controller/export/interchange-export-action.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { parseXmlDocument, walkXml } from '../src/common/editor/dawproject-xml.ts';

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
	// Keep source and record timecodes distinct: the clip starts at the media
	// head but one second into the sequence, and lasts exactly two seconds.
	assert.deepEqual(edl.text.split('\n')
		.filter((line) => /^\d{3}\s/u.test(line))
		.map((line) => line.trim().split(/\s+/u)), [[
		'001', 'CAM_A', 'V', 'C',
		'00:00:00:00', '00:00:02:00', '00:00:01:00', '00:00:03:00',
	]]);

	const otio = await exportProjectOtio(runtime.runtime);
	assert.ok(otio);
	const otioDocument = JSON.parse(otio.text) as {
		tracks: { children: { children: {
			OTIO_SCHEMA: string;
			name: string;
			source_range: { start_time: { value: number }; duration: { value: number; rate: number } };
			media_reference?: { target_url: string };
		}[] }[] };
	};
	const videoTrack = otioDocument.tracks.children[0]!;
	assert.deepEqual(videoTrack.children.map(({ OTIO_SCHEMA, name, source_range }) => ({
		schema: OTIO_SCHEMA,
		name,
		sourceStart: source_range.start_time.value,
		duration: source_range.duration.value,
		rate: source_range.duration.rate,
	})), [
		{ schema: 'Gap.1', name: '', sourceStart: 0, duration: 25, rate: 25 },
		{ schema: 'Clip.1', name: 'Wide', sourceStart: 0, duration: 50, rate: 25 },
	]);
	assert.equal(videoTrack.children[1]?.media_reference?.target_url, 'media/cam.mp4');

	const fcpxml = await exportProjectFcpxml(runtime.runtime);
	assert.ok(fcpxml);
	const assetClips = [...walkXml(parseXmlDocument(fcpxml.text))].filter((element) => element.name === 'asset-clip');
	assert.equal(assetClips.length, 1);
	assert.deepEqual(assetClips[0]!.attributes, {
		ref: 'r2', name: 'Wide', srcEnable: 'video', offset: '1s', start: '0s', duration: '2s', videoRole: 'video',
	});
});

test('a musically anchored audio clip is exported where the tempo map puts it', async () => {
	const runtime = harness(musicalProject());
	const otio = await exportProjectOtio(runtime.runtime);
	assert.ok(otio);
	const otioDocument = JSON.parse(otio.text) as {
		tracks: { children: { children: {
			OTIO_SCHEMA: string;
			source_range: { duration: { value: number; rate: number } };
		}[] }[] };
	};
	const audioTrack = otioDocument.tracks.children[0]!;
	// Four beats at 120bpm is two seconds of leader, which OTIO states as a Gap
	// before the clip. Reading the missing sample alias as zero wrote the clip at
	// the top of the timeline instead.
	assert.deepEqual(audioTrack.children.map(({ OTIO_SCHEMA, source_range }) => ({
		schema: OTIO_SCHEMA,
		frames: source_range.duration.value,
		rate: source_range.duration.rate,
	})), [
		{ schema: 'Gap.1', frames: 2 * SAMPLE_RATE, rate: SAMPLE_RATE },
		{ schema: 'Clip.1', frames: SAMPLE_RATE, rate: SAMPLE_RATE },
	]);
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
	return createSoundscaperProject({
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
	return createSoundscaperProject({
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
