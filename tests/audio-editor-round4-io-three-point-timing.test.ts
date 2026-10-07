/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoEditService } from '../src/common/editor/controller/clip-video/internal/video/video-edit-service.ts';
import { createSourceMonitorService } from '../src/common/editor/controller/clip-video/internal/source-monitor-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { resolveThreePointEdit, ThreePointEditError } from '../src/common/editor/three-point-edit.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { videoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../src/common/editor/video-source-timing-views.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';

const recording = (() => {
	const value = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1');
	assert.ok(value);
	return value;
})();
const SEQUENCE_RATE = Object.freeze({ num: 30, den: 1 });

function fixture() {
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
	const project = {
		sampleRate: 48_000, primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: SEQUENCE_RATE, trackIds: ['video', 'audio'] }],
		tracks: [
			{ id: 'video', type: 'video', laneGroupId: 'pair', clipIds: [] },
			{ id: 'audio', type: 'audio', laneGroupId: 'pair', clipIds: [] },
		],
		sources: [source, { id: 'sound', kind: 'audio', frameCount: 48_000, sampleRate: 48_000 }],
		clips: [], selection: { startFrame: 16_000, endFrame: 16_000, clipIds: [], trackIds: [] },
		projectBin: { clips: [
			{ id: 'bin-video', kind: 'video', binItemId: 'item', sourceId: source.id },
			{ id: 'bin-audio', kind: 'audio', binItemId: 'item', sourceId: 'sound' },
		] },
	};
	return {
		project,
		context: {
			sourceRate: recording.nominalRate, sequenceRate: SEQUENCE_RATE,
			sampleRate: 48_000, sourceFrameCount: source.sourceFrameCount,
			sourceTiming: videoSourceTimingView(resolveVideoSourceTimingViews(project), source),
		},
		cleanup: () => { unregisterVideoTimingIndex(source); },
	};
}

test('VFR marked-source edits use the presentation span in forward and backtimed placement', () => {
	const { context, cleanup } = fixture();
	try {
		for (const sequencePoint of [{ sequenceIn: 10 }, { sequenceOut: 11 }]) {
			const edit = resolveThreePointEdit({ sourceIn: 2, sourceOut: 3, ...sequencePoint }, context);
			assert.deepEqual([edit.sequenceIn, edit.sequenceOut, edit.startFrame, edit.endFrame], [10, 11, 16_000, 17_600]);
		}
		// The next recorded interval is 297 ms, despite also being one source frame.
		assert.equal(resolveThreePointEdit({ sourceIn: 3, sourceOut: 4, sequenceIn: 10 }, context).sequenceFrameCount, 9);
	} finally { cleanup(); }
});

test('VFR sequence-owned edits resolve the missing source endpoint from presentation boundaries', () => {
	const { context, cleanup } = fixture();
	try {
		for (const sourcePoint of [{ sourceIn: 3 }, { sourceOut: 4 }]) {
			const edit = resolveThreePointEdit({ sequenceIn: 10, sequenceOut: 19, ...sourcePoint }, context);
			assert.deepEqual([edit.sourceIn, edit.sourceOut], [3, 4]);
		}
	} finally { cleanup(); }
});

test('four VFR points agree through their marked presentation range and retain source bounds', () => {
	const { context, cleanup } = fixture();
	try {
		assert.equal(resolveThreePointEdit({ sourceIn: 2, sourceOut: 3, sequenceIn: 10, sequenceOut: 11 }, context).sourceFrameCount, 1);
		assert.throws(() => resolveThreePointEdit({ sourceIn: 2, sourceOut: 3, sequenceIn: 10, sequenceOut: 19 }, context),
			(error: unknown) => error instanceof ThreePointEditError && error.reason === 'over-specified');
		assert.throws(() => resolveThreePointEdit({ sourceIn: 7, sequenceIn: 10, sequenceOut: 40 }, context),
			(error: unknown) => error instanceof ThreePointEditError && error.reason === 'source-out-of-bounds');
	} finally { cleanup(); }
});

test('Project Bin Insert and Overwrite carry the same exact VFR span into linked audio placements', () => {
	const { project, cleanup } = fixture();
	try {
		const lifetime = new EditorControllerLifetime();
		const monitor = createSourceMonitorService({ lifetime, getProject: () => project, publishProjectState: () => undefined });
		monitor.open('item'); monitor.seek(2); monitor.markIn(); monitor.markOut();
		const prepared: Readonly<Record<string, unknown>>[] = [];
		const service = createVideoEditService({
			lifetime, getProject: () => project, getSelectedTrackId: () => 'video',
			editingBlocked: () => false, getPositionFrames: () => 16_000,
			commit: command => command, publishProjectState: () => undefined, sourceMonitor: monitor,
			prepareThreePointEditCommand: (_project, options) => {
				prepared.push(options);
				return { type: 'edit/insert', placements: [{ clipId: 'video' }, { clipId: 'audio' }] } as unknown as AudioEditorCommand;
			},
		});
		for (const action of [service.insert, service.overwrite]) {
			const result = action({ binItemId: 'item' });
			assert.equal(result.edit.sequenceFrameCount, 1);
			const options = prepared.at(-1)!;
			const placements = options.placements as readonly { readonly sourceIn: number; readonly sourceCount: number }[];
			assert.deepEqual(placements.map(({ sourceIn, sourceCount }) => [sourceIn, sourceCount]), [[2, 1], [9_600, 2_160]]);
			assert.deepEqual([options.startFrame, options.endFrame], [16_000, 17_600]);
		}
	} finally { cleanup(); }
});
