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
import type {
	DeleteBehaviorConfirmationDecision,
	DeleteBehaviorConfirmationRequest,
} from '../src/common/editor/delete-behavior-onboarding.ts';
import type { AudioEditorEditingPreferences } from '../src/common/editor/editing-preferences.ts';

interface DeleteControllerSnapshot {
	readonly project: {
		readonly revision: number;
		readonly title: string;
		readonly tracks: readonly Readonly<{ readonly id: string }>[];
		readonly clips: readonly Readonly<{
			readonly timelineStartFrame: number;
			readonly durationFrames: number;
		}>[];
	};
	readonly preferences: { readonly editing: AudioEditorEditingPreferences };
	readonly status: { readonly state: string };
}

test('controller parks a fresh generic Delete, persists Apply, then executes the original range edit', async () => {
	const decision = deferredDecision();
	let prompt: Readonly<DeleteBehaviorConfirmationRequest> | null = null;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		confirmDeleteBehavior: (request: Readonly<DeleteBehaviorConfirmationRequest>) => {
			prompt = request;
			return decision.promise;
		},
	} as never);
	try {
		await controller.ready;
		const trackId = installClip(controller, 'first-delete');
		controller.actions.timeline.setSelection(200, 400, { trackIds: [trackId] });
		const revision = snapshot(controller).project.revision;
		const pending = controller.actions.edit.delete() as PromiseLike<unknown>;

		assert.equal(typeof pending.then, 'function');
		const issuedPrompt = prompt as unknown as Readonly<DeleteBehaviorConfirmationRequest>;
		assert.equal(issuedPrompt.initialDeleteBehavior, 'leave-gap');
		assert.equal(issuedPrompt.initialCloseGapBehavior, 'clip');
		assert.ok(issuedPrompt.signal instanceof AbortSignal);
		assert.equal(snapshot(controller).project.revision, revision);
		assert.equal(snapshot(controller).project.clips.length, 1);

		decision.resolve({ accepted: true, deleteBehavior: 'leave-gap', closeGapBehavior: 'clip' });
		await pending;
		const current = snapshot(controller);
		assert.equal(current.preferences.editing.deleteBehavior, 'leave-gap');
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

test('controller revision fencing rejects an Apply after an intervening project edit', async () => {
	const decision = deferredDecision();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		confirmDeleteBehavior: () => decision.promise,
	} as never);
	try {
		await controller.ready;
		const trackId = installClip(controller, 'stale-delete');
		controller.actions.timeline.setSelection(200, 400, { trackIds: [trackId] });
		const pending = controller.actions.edit.delete() as PromiseLike<unknown>;
		controller.actions.edit.commit({ type: 'project/rename', title: 'Intervening edit' });
		decision.resolve({ accepted: true, deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' });
		await pending;

		const current = snapshot(controller);
		assert.equal(current.project.title, 'Intervening edit');
		assert.equal(current.project.clips.length, 1);
		assert.equal(current.project.clips[0]?.durationFrames, 1_000);
		assert.equal(current.preferences.editing.deleteBehavior, 'not-set');
		assert.equal(current.status.state, 'error');
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

function deferredDecision(): Readonly<{
	readonly promise: Promise<DeleteBehaviorConfirmationDecision>;
	readonly resolve: (value: DeleteBehaviorConfirmationDecision) => void;
}> {
	let resolve!: (value: DeleteBehaviorConfirmationDecision) => void;
	const promise = new Promise<DeleteBehaviorConfirmationDecision>((settle) => { resolve = settle; });
	return Object.freeze({ promise, resolve });
}
