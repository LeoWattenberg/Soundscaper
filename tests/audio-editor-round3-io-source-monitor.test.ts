/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourceMonitorService } from '../src/common/editor/controller/clip-video/internal/source-monitor-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';

const recording = (() => {
	const value = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1');
	assert.ok(value);
	return value;
})();

function monitor() {
	const publication = createVideoTimingAssetPublication(recording.sourceSha256, {
		timescale: recording.timescale,
		presentationTicks: recording.presentationTicks,
		finalFrameDurationTicks: recording.finalFrameDurationTicks,
	});
	const source = {
		id: 'recording', kind: 'video', name: recording.file.name,
		frameRate: recording.nominalRate, sourceFrameCount: recording.presentationTicks.length,
		contentSha256: recording.sourceSha256, timingAsset: publication.reference,
		timingDecision: { mode: 'exact', rate: recording.nominalRate, backend: 'demuxer' },
	};
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	const lifetime = new EditorControllerLifetime();
	const service = createSourceMonitorService({
		lifetime,
		getProject: () => ({ sources: [source], projectBin: { clips: [{ id: 'bin', kind: 'video', sourceId: source.id }] } }),
		publishProjectState: () => undefined,
	});
	service.open('bin');
	return { service, source, cleanup: () => { unregisterVideoTimingIndex(source); } };
}

test('Source monitor seeks the actual presentation interval instead of the average-rate frame', () => {
	const { service, cleanup } = monitor();
	try {
		assert.equal(service.seek(0).mediaSeconds, 0.015);
		assert.equal(service.seek(2).mediaSeconds, 0.2225);
		assert.equal(service.seek(7).mediaSeconds, 0.9035);
	} finally { cleanup(); }
});

test('stepping a VFR source never renders a neighboring source ordinal', () => {
	const { service, cleanup } = monitor();
	try {
		for (let ordinal = 0; ordinal < recording.presentationTicks.length; ordinal += 1) {
			const view = ordinal === 0 ? service.view() : service.step(1);
			const start: number = Number(recording.presentationTicks[ordinal]) / recording.timescale;
			const end: number = Number(recording.presentationTicks[ordinal + 1]
				?? recording.presentationTicks.at(-1)! + recording.finalFrameDurationTicks) / recording.timescale;
			assert.ok(view.mediaSeconds >= start && view.mediaSeconds < end, `source frame ${String(ordinal)}`);
		}
	} finally { cleanup(); }
});

test('a paused media clock reads back through actual VFR boundaries', () => {
	const { service, cleanup } = monitor();
	try {
		assert.equal(service.seekMediaTime(0.029).positionFrame, 0);
		assert.equal(service.seekMediaTime(0.03).positionFrame, 1);
		assert.equal(service.seekMediaTime(0.2225).positionFrame, 2);
		assert.equal(service.markIn().markIn, 2);
		assert.equal(service.seekMediaTime(0.245).positionFrame, 3);
		assert.equal(service.seekMediaTime(0.88).positionFrame, 7);
		assert.equal(service.seekMediaTime(1).positionFrame, 7);
		assert.equal(service.seekMediaTime(-1).positionFrame, 0);
	} finally { cleanup(); }
});
