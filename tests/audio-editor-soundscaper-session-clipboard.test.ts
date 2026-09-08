/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect } from '../src/common/editor/effects.js';
import { createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { prepareCurrentSoundscaperTrackDuplicateCarrierV8 } from '../src/soundscaper/editor-session-clipboard.ts';

for (const extraTrack of [
	createLabelTrack({ id: 'labels', name: 'Labels' }),
	{ id: 'video', name: 'Video', type: 'video', clipIds: [], locked: false },
]) {
	test(`track duplication ignores a ${extraTrack.type} track without an effect rack`, () => {
		const voice = createAudioTrack({
			id: 'voice', name: 'Voice', clipIds: [],
			effects: [createEffect('highpass', { id: 'voice-gain' })],
		});
		const project = createSoundscaperProject({
			tracks: [voice, extraTrack],
			sequences: [{
				id: 'main-sequence', rate: { num: 30, den: 1 },
				trackIds: ['voice', String(extraTrack.id)],
			}],
			primarySequenceId: 'main-sequence',
		} as never);

		const carrier = prepareCurrentSoundscaperTrackDuplicateCarrierV8(project, {
			sourceTrackId: 'voice', targetTrackId: 'voice-copy',
			effectIds: [{ sourceId: 'voice-gain', targetId: 'voice-copy-gain' }],
		});
		assert.deepEqual(carrier.effectIds, [
			{ sourceId: 'voice-gain', targetId: 'voice-copy-gain' },
		]);
		assert.equal(Object.isFrozen(carrier), true);
	});
}
