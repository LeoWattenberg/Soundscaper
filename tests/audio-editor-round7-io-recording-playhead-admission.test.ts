/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import {
	createAudioEditorController, createCapturePool, createFfmpegStub,
	createMockStream, createMockTrack, createProjectStore,
	createRecordingControllerFactory, createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

for (const routed of [false, true]) for (const timed of [false, true]) for (const navigation of ['selection', 'skip']) test(`${routed ? 'routed' : 'default'} ${timed ? 'scheduled' : 'ordinary'} capture retains its playhead through ${navigation} while direct seeks stay available after Stop`, async () => {
	const store = createProjectStore();
	const engine = createRecordingEngine();
	const stream = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const created: RecordingControllerFactoryOptions[] = [];
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { store,
		engine: engine as unknown as Options['engine'], ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: createCapturePool({ hardware: { default: stream } }) as unknown as Options['recordingCapturePool'],
		recordingControllerFactory: createRecordingControllerFactory(created),
	});
	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project?.tracks?.[0]?.id;
		assert.ok(typeof trackId === 'string');
		if (routed) await controller.actions.recording.setTrackInput(trackId, {
			kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1,
		});
		controller.actions.timeline.clearSelection();
		controller.actions.transport.seek(12_345);
		assert.equal(engine.getPositionFrames(), 12_345, 'idle public seeks retain their existing behavior');
		controller.actions.transport.seek(24_000);
		if (timed) await controller.actions.recording.schedule(new Date(Date.now() + 60_000), { trackId });
		else await controller.actions.recording.start({ trackId });
		assert.equal(created.length, 1);
		const initialFrame = engine.getPositionFrames();
		controller.actions.transport.seek(48_000);
		assert.equal(engine.getPositionFrames(), initialFrame, 'an owned capture cannot have its programme clock moved');
		if (!timed) {
			await created[0]!.onChunk({ frameStart: 0, frames: 8_192, channels: [new Float32Array(8_192).fill(0.25)] });
			controller.actions.recording.pause();
		}
		controller.actions.timeline.setExactSelection(1_000, 4_096, { trackIds: [trackId] });
		if (navigation === 'skip') controller.actions.timeline.skipToSelectionEnd();
		assert.equal(engine.getPositionFrames(), initialFrame, 'selection navigation preserves the same capture clock');
		if (timed) {
			controller.actions.recording.cancelScheduled();
		} else {
			controller.actions.transport.seek(96_000);
			assert.equal(engine.getPositionFrames(), initialFrame, 'paused capture retains the same source-to-programme clock');
		}
		await controller.actions.recording.stop();
		controller.actions.transport.seek(24_000);
		assert.equal(engine.getPositionFrames(), 24_000, 'release restores ordinary seeks');
		if (!timed) {
			const sources = controller.getSnapshot().project?.sources;
			assert.ok(Array.isArray(sources));
			const source: unknown = sources[0];
			assert.ok(source && typeof source === 'object' && 'id' in source && typeof source.id === 'string');
			const stored = await store.readSourceChunk(source.id, 0);
			assert.equal(stored.channels[0]![0], 0.25);
		}
	} finally { await controller.dispose(); }
});
