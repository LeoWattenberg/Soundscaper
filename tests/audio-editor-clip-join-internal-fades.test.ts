/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { canJoinClips } from '../src/common/editor/commands/clip-link-runtime.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const NOW = '2026-09-29T12:00:00.000Z';

test('joining cannot discard an outgoing or incoming fade at an internal boundary', () => {
	for (const [leftFadeOutFrames, rightFadeInFrames] of [[20, 0], [0, 20], [20, 20]]) {
		const source = createAudioSource({
			id: 'source', storageKey: 'source', name: 'Source',
			frameCount: 200, channelCount: 1, sampleRate: 48_000,
		});
		const project = createCurrentAudioEditorProject({
			id: 'join-internal-fades', now: NOW, sources: [source],
			clips: [
				createAudioClip({ id: 'left', sourceId: source.id,
					timelineStartFrame: 0, durationFrames: 100,
					sourceStartFrame: 0, sourceDurationFrames: 100,
					fadeOutFrames: leftFadeOutFrames }),
				createAudioClip({ id: 'right', sourceId: source.id,
					timelineStartFrame: 100, durationFrames: 100,
					sourceStartFrame: 100, sourceDurationFrames: 100,
					fadeInFrames: rightFadeInFrames }),
			],
			tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['left', 'right'] })],
		});
		assert.equal(canJoinClips(project, ['left', 'right']), false);
		assert.throws(() => applyEditorCommand(project, {
			type: 'clip/join', clipIds: ['left', 'right'],
		}, { now: NOW }), /processing|render|fade/iu);
		assert.equal(project.clips.length, 2, 'a refused join preserves the original clips');
	}
});
