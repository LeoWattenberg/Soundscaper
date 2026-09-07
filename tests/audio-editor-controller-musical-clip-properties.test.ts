/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorController } from '../src/common/editor/app.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createAddTrackCommand, createAddSourceCommand, createAddClipCommand } from '../src/common/editor/commands/factories.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

void test('controller clip stretching reads resolved timing and preserves authored musical coordinates', async () => {
	const controller = createAudioEditorController({ headless: true,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
	});
	try {
		await controller.ready;
		controller.actions.edit.commit({ type: 'batch', commands: [
			createAddTrackCommand({ id: 'musical-track', name: 'Musical' }),
			createAddSourceCommand({ id: 'musical-source', frameCount: 96_000,
				channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000 }),
			createAddClipCommand('musical-track', { id: 'musical-clip', sourceId: 'musical-source',
				sourceStartFrame: 0, sourceDurationFrames: 96_000,
				anchor: 'musical', musicalStartBeat: 2, musicalExtent: 'beat', musicalDurationBeats: 2,
			}),
		] });
		const before = controller.project;
		assert.ok(before);
		const clip = resolveRuntimeProjectProjection(before).clips.find(clip => clip.id === 'musical-clip');
		assert.ok(clip);
		controller.actions.clip.stretch('musical-clip', { durationFrames: clip.durationFrames * 2 });
		const after = controller.project;
		assert.ok(after);
		const stretched = resolveRuntimeProjectProjection(after).clips.find(clip => clip.id === 'musical-clip');
		assert.equal(stretched?.durationFrames, clip.durationFrames * 2);
		assert.equal(stretched?.timelineStartFrame, clip.timelineStartFrame);
		const persisted = after.clips.find(clip => clip.id === 'musical-clip');
		assert.equal(persisted?.anchor, 'musical');
		assert.deepEqual(persisted?.musicalDurationBeats, { num: 4, den: 1 });
	} finally {
		await controller.dispose();
	}
});
