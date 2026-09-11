/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	COPY,
	createAudioEditorController,
	createMemoryEngine,
} from './helpers/audio-editor-controller-harness.js';
import type { AudioEditorEditingPreferences } from '../src/common/editor/editing-preferences.ts';

interface DeleteControllerSnapshot {
	readonly project: {
		readonly revision: number;
		readonly tracks: readonly Readonly<{ readonly id: string }>[];
		readonly clips: readonly Readonly<{
			readonly timelineStartFrame: number;
			readonly durationFrames: number;
		}>[];
	};
	readonly preferences: { readonly editing: AudioEditorEditingPreferences };
}

test('controller executes a fresh generic Delete as Leave gap without onboarding', async () => {
	let confirmationCalls = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		confirmDeleteBehavior: () => {
			confirmationCalls += 1;
			throw new Error('Delete onboarding must not open automatically.');
		},
	} as never);
	try {
		await controller.ready;
		const trackId = installClip(controller, 'first-delete');
		controller.actions.timeline.setSelection(200, 400, { trackIds: [trackId] });
		const revision = snapshot(controller).project.revision;
		controller.actions.edit.delete();
		const current = snapshot(controller);
		assert.equal(confirmationCalls, 0);
		assert.equal(current.project.revision, revision + 1);
		assert.equal(current.preferences.editing.deleteBehavior, 'not-set');
		assert.equal(current.preferences.editing.closeGapBehavior, 'clip');
		assert.equal(current.project.clips.reduce(
			(total, clip) => total + clip.durationFrames,
			0,
		), 800);
		assert.ok(current.project.clips.every((clip) => (
			clip.timelineStartFrame + clip.durationFrames <= 200 || clip.timelineStartFrame >= 400
		)));
	} finally {
		await controller.dispose();
	}
});

function installClip(
	controller: ReturnType<typeof createAudioEditorController>,
	clipId: string,
): string {
	const trackId = snapshot(controller).project.tracks[0]?.id;
	if (!trackId) throw new Error('The controller did not create its initial audio track.');
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: `${clipId}-source`, storageKey: `${clipId}-source`, name: `${clipId}.wav`,
				mimeType: 'audio/wav', frameCount: 1_000, channelCount: 1,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: clipId, sourceId: `${clipId}-source`, timelineStartFrame: 0,
				sourceStartFrame: 0, durationFrames: 1_000,
			},
		}],
	});
	return trackId;
}

function snapshot(
	controller: ReturnType<typeof createAudioEditorController>,
): DeleteControllerSnapshot {
	return controller.getSnapshot() as unknown as DeleteControllerSnapshot;
}
