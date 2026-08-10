/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveInspectedVideoSource,
	resolveSourceTimecodeAtSample,
	resolveVideoSourcePropertiesView,
} from '../src/common/editor/source-properties-model.ts';

const PAL = { num: 25, den: 1 };
const NTSC = { num: 30_000, den: 1_001 };

function videoSource(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'video',
		id: 'video-source',
		name: 'Take 1',
		width: 1_920,
		height: 1_080,
		frameRate: PAL,
		sourceFrameCount: 250,
		videoCodec: 'unknown',
		audioCodec: null,
		timingDecision: { mode: 'exact', rate: PAL, backend: 'ffmpeg' },
		...overrides,
	};
}

test('an unprobed source reports every characteristic as unknown', () => {
	const view = resolveVideoSourcePropertiesView(videoSource({
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: PAL },
	}));
	assert.equal(view.videoCodec, null, 'the literal unknown placeholder is not a codec');
	assert.equal(view.characteristics.rotationDegrees, null);
	assert.equal(view.startTimecodeLabel, null);
	assert.equal(view.geometry.reconciliation, 'unreported');
	assert.deepEqual(view.notes, ['timing-unprobed']);
});

test('a probed source describes its picture and discloses what is not acted on', () => {
	const view = resolveVideoSourcePropertiesView(videoSource({
		characteristics: {
			backend: 'ffmpeg',
			codedWidth: 720,
			codedHeight: 576,
			rotationDegrees: 0,
			pixelAspectRatio: { num: 64, den: 45 },
			fieldOrder: 'top-field-first',
			hasAlpha: false,
			videoCodec: 'mpeg2video',
			colour: { primaries: 'bt470bg', transfer: 'smpte170m', matrix: 'bt470bg', range: 'limited' },
			audioStreams: [
				{ index: 1, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'eng' },
				{ index: 2, codec: 'ac3', channelCount: 6, sampleRate: 48_000, language: 'deu' },
			],
			extractedAudioStreamIndex: 1,
			startTimecode: { negative: false, hours: 10, minutes: 0, seconds: 0, frames: 0, dropFrame: false },
		},
		width: 1_024,
		height: 576,
	}));
	assert.equal(view.videoCodec, 'mpeg2video');
	assert.equal(view.audioCodec, 'aac', 'the extracted program names the audio codec');
	assert.equal(view.startTimecodeLabel, '10:00:00:00');
	assert.equal(view.geometry.reconciliation, 'applied');
	assert.deepEqual(view.notes, ['interlaced-presented-as-coded', 'additional-audio-programs']);
	assert.equal(view.extractedAudioStream?.language, 'eng');
});

test('a rotation the decoder did not apply is disclosed rather than hidden', () => {
	const view = resolveVideoSourcePropertiesView(videoSource({
		characteristics: { backend: 'ffmpeg', codedWidth: 1_920, codedHeight: 1_080, rotationDegrees: 90 },
	}));
	assert.equal(view.geometry.reconciliation, 'residual');
	assert.deepEqual(view.notes, ['rotation-not-applied']);
});

test('a stretch the surfaces do apply is not disclosed as an unapplied one', () => {
	const view = resolveVideoSourcePropertiesView(videoSource({
		characteristics: {
			backend: 'ffmpeg',
			codedWidth: 720,
			codedHeight: 576,
			pixelAspectRatio: { num: 64, den: 45 },
		},
		width: 720,
		height: 576,
	}));
	assert.equal(view.geometry.reconciliation, 'residual');
	assert.deepEqual(view.notes, [], 'the preview and the export both close a pixel-aspect residual');
	assert.equal(view.geometry.displayWidth, 1_024);
});

test('a conformed ingest names the backend that produced its timing', () => {
	const view = resolveVideoSourcePropertiesView(videoSource({
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: PAL, backend: 'ffmpeg' },
	}));
	assert.equal(view.timingBackend, 'ffmpeg');
	assert.deepEqual(view.notes, ['conformed-at-ingest']);
});

function project(sourceOverrides: Record<string, unknown> = {}, clipOverrides: Record<string, unknown> = {}) {
	return {
		sampleRate: 48_000,
		primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: PAL, dropFrame: false }],
		sources: [videoSource(sourceOverrides)],
		clips: [{
			kind: 'video',
			id: 'video-clip',
			sourceId: 'video-source',
			sequenceId: 'main',
			sequenceStartFrame: 10,
			sequenceFrameCount: 50,
			sourceInFrame: 100,
			sourceFrameCount: 50,
			...clipOverrides,
		}],
	};
}

test('the source timecode reads from the probed origin when there is one', () => {
	const reading = resolveSourceTimecodeAtSample(project({
		characteristics: {
			backend: 'ffmpeg',
			startTimecode: { negative: false, hours: 10, minutes: 0, seconds: 0, frames: 0, dropFrame: false },
		},
	}), 48_000 * 12 / 25);
	assert.ok(reading);
	assert.equal(reading.sourceFrame, 102);
	assert.equal(reading.label, '10:00:04:02');
	assert.equal(reading.originReported, true);
	assert.equal(reading.sourceName, 'Take 1');
});

test('an unreported origin still labels the source frame and says the origin is unknown', () => {
	const reading = resolveSourceTimecodeAtSample(project(), 48_000 * 10 / 25);
	assert.ok(reading);
	assert.equal(reading.sourceFrame, 100);
	assert.equal(reading.label, '00:00:04:00');
	assert.equal(reading.originReported, false);
});

test('a drop-frame source origin labels its source position with the drop-frame rule', () => {
	const reading = resolveSourceTimecodeAtSample(project({
		frameRate: NTSC,
		timingDecision: { mode: 'exact', rate: NTSC, backend: 'ffmpeg' },
		characteristics: {
			backend: 'ffmpeg',
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 59, frames: 29, dropFrame: true },
		},
	}, { sourceInFrame: 1 }), 48_000 * 10 / 25);
	assert.ok(reading);
	assert.equal(reading.label, '00:01:00;02', 'the skipped drop-frame labels do not exist');
});

test('a position no video clip covers has no source reading', () => {
	assert.equal(resolveSourceTimecodeAtSample(project(), 0), null);
	assert.equal(resolveSourceTimecodeAtSample(project(), 48_000 * 100), null);
	assert.equal(resolveSourceTimecodeAtSample({ sampleRate: 0 }, 0), null);
});

test('a runtime projection resolves the same reading as the persisted document', () => {
	const projected = project();
	projected.clips = [{
		kind: 'video',
		id: 'video-clip',
		sourceId: 'video-source',
		sequenceId: 'main',
		sequenceStartFrame: 10,
		sequenceEndFrame: 60,
		sourceStartFrame: 100,
		sourceDurationFrames: 50,
	}] as never;
	const reading = resolveSourceTimecodeAtSample(projected, 48_000 * 12 / 25);
	assert.ok(reading);
	assert.equal(reading.sourceFrame, 102);
	assert.equal(reading.label, '00:00:04:02');
});

test('the inspected source follows the selection before the playhead', () => {
	const inspected = project();
	assert.equal(resolveInspectedVideoSource(inspected, 0), null, 'nothing selected and no clip under the playhead');
	assert.equal(
		resolveInspectedVideoSource(inspected, 48_000 * 12 / 25)?.id,
		'video-source',
		'the playhead clip is the fallback',
	);
	const binned = {
		...project(),
		clips: [],
		projectBin: { clips: [{ kind: 'video', id: 'bin-clip', sourceId: 'video-source' }] },
		selection: { clipIds: ['bin-clip'] },
	};
	assert.equal(
		resolveInspectedVideoSource(binned, 0)?.id,
		'video-source',
		'a freshly imported Project Bin item is inspectable',
	);
});
