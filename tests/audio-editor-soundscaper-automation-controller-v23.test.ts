/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	createSoundscaperAutomationControllerBindingV21,
} from '../src/soundscaper/editor-automation-controller-v21.ts';
import { applySoundscaperProjectCommandV23 } from '../src/soundscaper/editor-project-v23-commands.ts';
import { validateSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23-validation.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';

/**
 * The automation binding is inherited by every later production revision.
 *
 * That is why it takes the validator as an option: asking `validateSoundscaperProjectV21`
 * about a V23 document refuses it outright, because V23 carries a field the closed
 * V21 record does not know. The resolve and preview ports were threaded with the
 * injected validator; the readback restore was not, and it runs in the gesture's
 * own `finally`. So on the revision the app actually mounts, every completed or
 * cancelled gesture ended in "Soundscaper V21 project contains an unsupported
 * field" — the lane was written and undoable, but the panel reported a failure
 * and the live parameter was left at the gesture's last previewed value.
 */

const NOW = '2026-08-19T12:00:00.000Z';
const ADDRESS = Object.freeze({
	kind: 'strip' as const,
	strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
	parameterId: 'gain' as const,
});

test('a V23 automation gesture completes and restores its readback', () => {
	const host = createHost();
	const binding = createSoundscaperAutomationControllerBindingV21(host.host, {
		validateProject: validateSoundscaperProjectV23,
	});
	binding.actions.setMode('touch', 'voice-gain');
	host.startTransport();

	const token = binding.actions.beginGesture('voice-gain', 0.5);
	host.seek(20);
	binding.actions.previewGesture(token, 0.25);
	host.seek(30);
	assert.doesNotThrow(() => binding.actions.releaseGesture(token, 0.25));

	assert.equal(host.commitCount, 1);
	// The readback restore runs after the commit, so the last preview is the lane
	// value at the transport position rather than the gesture's own last value.
	assert.deepEqual(host.livePreviews.at(-1), [ADDRESS, 0.25]);
});

test('a cancelled V23 automation gesture restores its readback too', () => {
	const host = createHost();
	const binding = createSoundscaperAutomationControllerBindingV21(host.host, {
		validateProject: validateSoundscaperProjectV23,
	});
	binding.actions.setMode('latch', 'voice-gain');
	host.startTransport();

	const token = binding.actions.beginGesture('voice-gain', 0.75);
	host.seek(15);
	binding.actions.previewGesture(token, 0.75);
	assert.doesNotThrow(() => binding.actions.cancelGesture(token));

	assert.equal(host.commitCount, 0);
	assert.deepEqual(host.livePreviews.at(-1), [ADDRESS, 0.5]);
});

function createHost() {
	let project = projectFixture();
	let positionFrame = 0;
	let transportState = 'stopped';
	let commitCount = 0;
	const livePreviews: Array<readonly [unknown, number]> = [];
	const documentListeners = new Set<() => void>();
	const positionListeners = new Set<() => void>();
	const stateListeners = new Set<() => void>();
	const host = {
		get project() { return project; },
		engine: {
			getPositionFrames: () => positionFrame,
			getState: () => ({ state: transportState }),
			previewScheduledParameter: (address: unknown, value: number) => {
				livePreviews.push([address, value]);
				return true;
			},
			subscribePosition: (listener: () => void) => {
				positionListeners.add(listener);
				return () => positionListeners.delete(listener);
			},
			subscribeState: (listener: () => void) => {
				stateListeners.add(listener);
				return () => stateListeners.delete(listener);
			},
		},
		actions: { edit: { commit: (command: unknown) => {
			commitCount += 1;
			project = applySoundscaperProjectCommandV23(project, command as AudioEditorCommand, { now: NOW });
			for (const listener of documentListeners) listener();
			return project;
		} } },
		getSnapshot: () => ({ readOnly: false, lockReadOnly: false, transportState }),
		subscribe: (listener: () => void) => {
			documentListeners.add(listener);
			return () => documentListeners.delete(listener);
		},
	};
	return {
		host,
		livePreviews,
		get commitCount() { return commitCount; },
		startTransport() {
			transportState = 'playing';
			for (const listener of stateListeners) listener();
		},
		seek(frame: number) {
			positionFrame = frame;
			for (const listener of positionListeners) listener();
		},
	};
}

function projectFixture() {
	return createSoundscaperProjectV23({
		id: 'automation-v23-project',
		title: 'Automation V23 project',
		now: NOW,
		tracks: [createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [{
			id: 'voice-gain',
			address: ADDRESS,
			timebase: 'absolute-samples',
			points: [
				{ id: 'start', position: 0, value: 0.5 },
				{ id: 'end', position: 48_000, value: 0.5 },
			],
			segments: [{ kind: 'linear' }],
		}],
	});
}
