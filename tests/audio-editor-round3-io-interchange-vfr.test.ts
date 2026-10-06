/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { createProjectEdlExport } from '../src/common/editor/edl-project-adapter.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';

function trimmedRecording() {
	const recording = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1');
	assert.ok(recording);
	const publication = createVideoTimingAssetPublication(recording.sourceSha256, {
		timescale: recording.timescale, presentationTicks: recording.presentationTicks,
		finalFrameDurationTicks: recording.finalFrameDurationTicks,
	});
	const source = createVideoSource({
		id: 'recording', name: recording.file.name, storageKey: 'recording', mimeType: recording.file.mimeType,
		frameRate: recording.nominalRate, sourceFrameCount: recording.presentationTicks.length,
		sampleRate: 48_000, sampleFrameCount: 44_544, width: 32, height: 24,
		contentSha256: recording.sourceSha256, timingAsset: publication.reference,
		timingDecision: { mode: 'exact', rate: recording.nominalRate, backend: 'demuxer' },
	});
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	const project = createSoundscaperProject({
		id: 'vfr-trim', now: '2026-10-07T10:00:00.000Z', sampleRate: 48_000, sources: [source],
		clips: [{ kind: 'video', id: 'take', sourceId: source.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 6, sourceInFrame: 2, sourceFrameCount: 3 }],
		tracks: [createVideoTrack({ id: 'picture', name: 'Picture', clipIds: ['take'] })],
		sequences: [{ id: 'main', name: 'Main', rate: { num: 30, den: 1 },
			trackNodes: [{ kind: 'track', id: 'picture', parentFolderId: null }] }], primarySequenceId: 'main',
	});
	return { project: projectForRuntimeConsumers(project as never) as unknown as Readonly<Record<string, unknown>>,
		cleanup: () => { unregisterVideoTimingIndex(source); } };
}

for (const format of ['edl', 'fcpxml', 'otio', 'dawproject'] as const) {
	test(`${format} keeps the authenticated presentation time of an ordinary VFR trim`, () => {
		const { project, cleanup } = trimmedRecording();
		try {
			const request = { project, sequenceRate: { num: 30, den: 1 } };
			if (format === 'edl') assert.match(createProjectEdlExport(request).text, /\s00:00:00:06\s/u);
			else if (format === 'fcpxml') assert.match(createFcpxmlExport(request).text, /<asset-clip[^>]* start="1\/5s"/u);
			else if (format === 'dawproject') assert.match(createDawprojectExport({ project, embeddableVideoSourceIds: ['recording'] }).projectXml, /<Clip[^>]* playStart="0\.2"/u);
			else {
				const tracks = createOtioExport(request).document.tracks as { children: readonly { children: readonly { source_range: { start_time: { value: number } } }[] }[] };
				assert.equal(tracks.children[0]?.children[0]?.source_range.start_time.value, 6);
			}
		} finally { cleanup(); }
	});
}
