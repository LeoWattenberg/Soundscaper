/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import {
	freezeNyquistResult, normalizeNyquistRole, nyquistAudioResultBytes,
	nyquistMaximumOutputFrames,
} from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { throwIfAborted } from '../src/common/editor/controller/shared/app-helpers.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import {
	collapseEditorHistory, createEditorHistory, executeEditorCommand,
	rollbackEditorHistory, undoEditorCommand,
} from '../src/common/editor/history.js';

type Project = ReturnType<typeof createCurrentAudioEditorProject>;
interface History {
	readonly present: Project;
	readonly undoStack: readonly Readonly<{ project: Project }>[];
}

function fixture(cancelLabels = false) {
	const opening = createCurrentAudioEditorProject({
		id: 'mixed-nyquist', tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })],
	});
	let history = createEditorHistory(opening) as unknown as History;
	let evaluation = 0;
	const commit = (command: Readonly<Record<string, unknown>>) => {
		history = executeEditorCommand(history, command) as unknown as History;
	};
	const lifetime = new EditorControllerLifetime();
	const execution = createSelectionEffectExecutionService({
		lifetime,
		captureProject: () => ({ projectId: opening.id }),
		assertProject: () => undefined,
		activeSelection: () => null,
		audacityEffectTargets: () => [
			{ track: { id: 'voice' }, startFrame: 0, endFrame: 16, channelCount: 1 },
			{ track: { id: 'other' }, startFrame: 0, endFrame: 16, channelCount: 1 },
		],
		audacityEffectSelectionDetails: () => ({}),
		cancelAudacityEffectPreview: () => undefined,
		copy: { audacityProcessing: 'Processing', nyquistPrompt: 'Nyquist prompt', nyquistApplied: 'Applied' },
		editingBlocked: () => false,
		freezeNyquistResult,
		normalizeNyquistRole,
		nyquistAudioResultBytes,
		nyquistMaximumOutputFrames,
		NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES: 1_000_000,
		nyquistHostProperties: () => ({}),
		nyquistEvaluator: async () => ++evaluation === 1
			? { type: 'audio', channels: [new Float32Array(16)], sampleRate: 48_000, frameCount: 16 }
			: { type: 'labels', labels: [{ start: 0, end: 0, text: 'Analysis' }] },
		persistAudacityEffectResults: async () => {
			commit({ type: 'track/update', trackId: 'voice', changes: { gain: 0.5 } });
		},
		persistNyquistLabels: () => {
			if (cancelLabels) throw new DOMException('Cancelled', 'AbortError');
			commit({ type: 'track/add', track: { id: 'analysis', type: 'label', name: 'Analysis' } });
		},
		beginResultTransaction: () => {
			const checkpoint = history;
			const depth = history.undoStack.length;
			return {
				commit(command: Readonly<Record<string, unknown>>) {
					history = collapseEditorHistory(history, depth, command, checkpoint) as unknown as History;
				},
				rollback() {
					history = rollbackEditorHistory(history, depth, {}, checkpoint) as unknown as History;
				},
			};
		},
		preflightStorage: async () => undefined,
		getProject: () => history.present,
		projectDurationFrames: () => 16,
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => undefined,
		renderDryTrackRange: async () => [new Float32Array(16)],
		setStatus: () => undefined,
		state: { audacityEffectProcessing: false, nyquistAbort: null, nyquistResult: null },
		throwIfAborted,
		updateTaskProgress: () => undefined,
	});
	return { execution, opening, get history() { return history; } };
}

test('one Nyquist run publishes its audio and labels as one reversible history operation', async () => {
	const run = fixture();
	await run.execution.runNyquistEvaluation({ source: '*track*' });
	assert.equal(run.history.present.tracks.length, 2);
	assert.equal(run.history.undoStack.length, 1);
	const undone = undoEditorCommand(run.history) as unknown as History;
	assert.deepEqual(undone.present.tracks, run.opening.tracks);
});

test('cancelling mixed-result publication restores the already-published audio', async () => {
	const run = fixture(true);
	assert.equal(await run.execution.runNyquistEvaluation({ source: '*track*' }), null);
	assert.deepEqual(run.history.present.tracks, run.opening.tracks);
	assert.equal(run.history.undoStack.length, 0);
});
