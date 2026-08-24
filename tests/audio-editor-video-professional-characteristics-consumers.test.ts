/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveSourceTimecodeAtSample,
	resolveVideoSourcePropertiesView,
} from '../src/common/editor/source-properties-model.ts';
import { sourceMonitorTimecodeLabel } from '../src/common/editor/source-monitor-model.ts';
import { resolveVideoSourcePresentation } from '../src/common/editor/video-source-presentation.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';

const RATE = Object.freeze({ num: 25, den: 1 });
const CHARACTERISTICS = normalizeVideoSourceCharacteristicsV25({
	backend: 'native-ffmpeg',
	codedWidth: 720,
	codedHeight: 576,
	rotationDegrees: 0,
	pixelAspectRatio: { num: 64, den: 45 },
	fieldOrder: 'progressive',
	hasAlpha: false,
	videoCodec: 'hevc',
	bitDepth: 10,
	pixelFormat: 'yuv420p10le',
	chromaFormat: '4:2:0',
	alphaMode: null,
	alphaInterpretation: null,
	colour: {
		primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited',
		masteringDisplay: null, contentLight: null,
	},
	audioStreams: [],
	extractedAudioStreamIndex: null,
	startTimecode: {
		negative: false, hours: 10, minutes: 0, seconds: 0, frames: 0, dropFrame: false,
	},
}, { rate: RATE });

function source(): Readonly<Record<string, unknown>> {
	return Object.freeze({
		kind: 'video', id: 'professional-video', name: 'Professional video',
		width: 1_024, height: 576, frameRate: RATE, sourceFrameCount: 250,
		characteristics: CHARACTERISTICS,
		timingDecision: { mode: 'exact', rate: RATE, backend: 'native-ffmpeg' },
	});
}

test('shared presentation consumers accept exact V25 professional characteristics', () => {
	const professionalSource = source();
	const properties = resolveVideoSourcePropertiesView(professionalSource);
	assert.equal((properties.characteristics as Readonly<{ bitDepth?: number }>).bitDepth, 10);
	assert.equal(properties.startTimecodeLabel, '10:00:00:00');
	assert.equal(sourceMonitorTimecodeLabel(professionalSource, 102), '10:00:04:02');
	assert.deepEqual(resolveVideoSourcePresentation(professionalSource), {
		autorotate: true,
		decodedWidth: 720,
		decodedHeight: 576,
		sampleAspect: { num: 64, den: 45 },
		scaledWidth: 1_024,
		scaledHeight: 576,
	});
	const reading = resolveSourceTimecodeAtSample({
		sampleRate: 48_000,
		primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: RATE }],
		sources: [professionalSource],
		clips: [{
			kind: 'video', id: 'professional-clip', sourceId: 'professional-video',
			sequenceId: 'main', sequenceStartFrame: 10, sequenceFrameCount: 50,
			sourceInFrame: 100, sourceFrameCount: 50,
		}],
	}, 48_000 * 12 / 25);
	assert.equal(reading?.label, '10:00:04:02');
});
