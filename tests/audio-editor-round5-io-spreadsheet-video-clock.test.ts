/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getClipSpreadsheetRows } from '../src/common/editor/clip-spreadsheet.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createVideoClip, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';

test('spreadsheet source offset agrees with the authenticated camera presentation boundary', () => {
	const recording = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1');
	assert.ok(recording);
	const publication = createVideoTimingAssetPublication(recording.sourceSha256, {
		timescale: recording.timescale, presentationTicks: recording.presentationTicks,
		finalFrameDurationTicks: recording.finalFrameDurationTicks,
	});
	const rate = { num: 30, den: 1 };
	const source = createVideoSource({ id: 'camera', name: 'Camera.webm', storageKey: 'camera',
		sampleFrameCount: 48_000, sourceFrameCount: recording.presentationTicks.length,
		frameRate: recording.nominalRate, width: 64, height: 48, videoCodec: 'vp8',
		contentSha256: recording.sourceSha256, timingAsset: publication.reference,
		timingDecision: { mode: 'exact', rate: recording.nominalRate, backend: 'demuxer' },
	});
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	try {
		const clip = createVideoClip({ id: 'excerpt', sourceId: source.id, sequenceId: 'main',
			sequenceStartFrame: 9, sequenceFrameCount: 9, sourceInFrame: 2, sourceFrameCount: 3,
		}, { projectSampleRate: 48_000, sequence: { id: 'main', rate }, source });
		const project = createCurrentAudioEditorProject({ id: 'camera-edit', sampleRate: 48_000,
			sources: [source], clips: [clip], tracks: [createVideoTrack({ id: 'picture', clipIds: [clip.id] })],
			sequences: [{ id: 'main', rate, trackIds: ['picture'] }], primarySequenceId: 'main',
		});
		const original = structuredClone(project);
		const row = getClipSpreadsheetRows(project)[0];
		assert.ok(row);
		assert.equal(row.cells.offset, '0.2');
		assert.equal(row.cells.position, '0.3');
		assert.equal(row.cells.duration, '0.3');
		assert.equal(row.editable, false);
		assert.deepEqual(project, original);
	} finally { unregisterVideoTimingIndex(source); }
});
