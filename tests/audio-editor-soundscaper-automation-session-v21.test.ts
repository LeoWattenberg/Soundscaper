/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createSoundscaperAutomationControllerBindingV21,
	resolveSoundscaperAutomationTargetV21,
} from '../src/soundscaper/editor-automation-controller-v21.ts';
import {
	createSoundscaperAutomationSessionV21,
	type SoundscaperAutomationAuthorityV21,
	type SoundscaperAutomationGestureTokenV21,
	type SoundscaperAutomationSessionV21,
} from '../src/soundscaper/editor-automation-session-v21.ts';
import { applySoundscaperProjectCommandV21 } from '../src/soundscaper/editor-project-v21-commands.ts';
import {
	createSoundscaperProjectHistoryV21,
	executeSoundscaperProjectCommandV21,
	redoSoundscaperProjectCommandV21,
	undoSoundscaperProjectCommandV21,
} from '../src/soundscaper/editor-project-v21-history.ts';
import {
	createSoundscaperProjectV21,
	type SoundscaperProjectV21,
} from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-14T12:00:00.000Z';
const ADDRESS = Object.freeze({
	kind: 'strip' as const,
	strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
	parameterId: 'gain' as const,
});

test('the session coordinator applies every ownership mode across gestures and transport', () => {
	const fixture = createFixture();
	for (const expected of [
		{ mode: 'read' as const, gesture: 'lane', after: 'lane', commits: 0 },
		{ mode: 'trim' as const, gesture: 'trimmed-lane', after: 'lane', commits: 1 },
		{ mode: 'touch' as const, gesture: 'control', after: 'lane', commits: 1 },
		{ mode: 'latch' as const, gesture: 'control', after: 'control', commits: 1 },
	] as const) {
		fixture.reset();
		fixture.authority.transportState = 'playing';
		fixture.authority.positionFrame = 10;
		fixture.coordinator.setMode(expected.mode, 'voice-gain');
		const token = fixture.coordinator.beginGesture('voice-gain', 0.5);
		fixture.authority.positionFrame = 20;
		const preview = fixture.coordinator.previewGesture(token, 0.8);
		assert.equal(preview.owner, expected.gesture, expected.mode);
		fixture.authority.positionFrame = 30;
		const released = fixture.coordinator.releaseGesture(token, 0.7);
		assert.equal(released.owner, expected.after, expected.mode);
		if (expected.mode === 'latch') {
			assert.equal(fixture.commits.length, 0);
			fixture.authority.positionFrame = 40;
			fixture.coordinator.synchronize();
			fixture.authority.transportState = 'stopped';
			fixture.coordinator.synchronize();
		}
		assert.equal(fixture.commits.length, expected.commits, expected.mode);
		assert.equal(fixture.coordinator.getSnapshot().capturePointCount, 0);
	}

	fixture.reset();
	fixture.coordinator.setMode('write', 'voice-gain');
	assert.equal(fixture.coordinator.getSnapshot().active, false);
	fixture.authority.positionFrame = 10;
	fixture.authority.transportState = 'playing';
	fixture.coordinator.synchronize();
	assert.equal(fixture.coordinator.getSnapshot().active, true);
	const token = fixture.coordinator.beginGesture('voice-gain', 0.5);
	fixture.authority.positionFrame = 20;
	assert.equal(fixture.coordinator.previewGesture(token, 0.25).owner, 'control');
	fixture.coordinator.releaseGesture(token, 0.25);
	assert.equal(fixture.commits.length, 0);
	fixture.authority.positionFrame = 30;
	fixture.coordinator.synchronize();
	fixture.authority.transportState = 'stopped';
	fixture.coordinator.synchronize();
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.commits[0]?.type, 'automation-lane/set');
	assert.equal(fixture.coordinator.getSnapshot().mode, 'write');
});

test('trim preview refuses a descriptor-range overflow before capture or preview publication', () => {
	const fixture = createFixture();
	fixture.authority.transportState = 'playing';
	fixture.authority.positionFrame = 10;
	fixture.coordinator.setMode('trim', 'voice-gain');
	const token = fixture.coordinator.beginGesture('voice-gain', 0);
	fixture.authority.positionFrame = 20;
	assert.throws(
		() => fixture.coordinator.previewGesture(token, 4),
		/parameter range/iu,
	);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.coordinator.getSnapshot().capturePointCount, 1);
	assert.equal(fixture.coordinator.cancelGesture(token), true);
});

test('a backward seek or loop refuses capture and restores readback without committing', () => {
	const fixture = createFixture();
	fixture.authority.transportState = 'playing';
	fixture.authority.positionFrame = 100;
	fixture.coordinator.setMode('touch', 'voice-gain');
	const token = fixture.coordinator.beginGesture('voice-gain', 0.5);
	fixture.authority.positionFrame = 200;
	fixture.coordinator.previewGesture(token, 0.75);
	fixture.authority.positionFrame = 150;
	assert.throws(
		() => fixture.coordinator.previewGesture(token, 0.25),
		/non-monotonic|seek|loop|backward/iu,
	);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.restores, 1);
	assert.equal(fixture.coordinator.getSnapshot().active, false);
	assert.throws(() => fixture.coordinator.releaseGesture(token), /active|stale|generation/iu);
});

test('every writing gesture mode creates exactly one real history transaction and survives undo and redo', () => {
	for (const mode of ['trim', 'touch', 'latch', 'write'] as const) {
		const fixture = createHistoryFixture();
		const originalLane = fixture.history.present.automationLanes[0]!;
		const token = armWritingGesture(fixture, mode);
		fixture.authority.positionFrame = 20;
		fixture.coordinator.previewGesture(token, mode === 'trim' ? 0.75 : 0.25);
		fixture.authority.positionFrame = 30;
		const released = fixture.coordinator.releaseGesture(token, mode === 'trim' ? 0.75 : 0.25);
		if (mode === 'latch' || mode === 'write') {
			assert.equal(released.committed, false, mode);
			fixture.authority.positionFrame = 40;
			fixture.coordinator.synchronize();
			fixture.authority.transportState = 'stopped';
			fixture.coordinator.synchronize();
		} else {
			assert.equal(released.committed, true, mode);
		}

		const committedLane = fixture.history.present.automationLanes[0]!;
		assert.notDeepEqual(committedLane, originalLane, mode);
		assert.equal(fixture.commitCount, 1, mode);
		assert.equal(fixture.history.undoStack.length, 1, mode);
		assert.equal(fixture.history.redoStack.length, 0, mode);
		assert.deepEqual(fixture.history.undoStack[0]?.command, {
			type: 'automation-lane/set',
			laneId: 'voice-gain',
			expected: originalLane,
			lane: committedLane,
		}, mode);

		fixture.undo();
		assert.deepEqual(fixture.history.present.automationLanes[0], originalLane, `${mode}: undo`);
		assert.equal(fixture.history.redoStack.length, 1, mode);
		fixture.redo();
		assert.deepEqual(fixture.history.present.automationLanes[0], committedLane, `${mode}: redo`);
		assert.equal(fixture.commitCount, 1, mode);
		assert.throws(
			() => fixture.coordinator.releaseGesture(token, 0.25),
			/active|stale|generation/iu,
			mode,
		);
	}
});

test('the product controller binding resolves exact targets and follows host lifecycle signals', () => {
	let project = projectFixture();
	let readOnly = false;
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
			project = applySoundscaperProjectCommandV21(project, command as AudioEditorCommand, { now: NOW });
			for (const listener of documentListeners) listener();
			return project;
		} } },
		getSnapshot: () => ({ readOnly, lockReadOnly: false, transportState }),
		subscribe: (listener: () => void) => {
			documentListeners.add(listener);
			return () => documentListeners.delete(listener);
		},
	};
	const target = resolveSoundscaperAutomationTargetV21(project, 'voice-gain');
	assert.equal(target?.controlValue, 1);
	assert.deepEqual(target?.descriptor.address, target?.lane.address);
	const binding = createSoundscaperAutomationControllerBindingV21(host);
	binding.actions.setMode('touch', 'voice-gain');
	transportState = 'playing';
	for (const listener of stateListeners) listener();
	positionFrame = 10;
	const token = binding.actions.beginGesture('voice-gain', 0.5);
	positionFrame = 20;
	for (const listener of positionListeners) listener();
	binding.actions.previewGesture(token, 0.25);
	positionFrame = 30;
	binding.actions.releaseGesture(token, 0.25);
	assert.equal(commitCount, 1);
	assert.equal(project.automationLanes[0]?.points.find(({ position }) => position === 30)?.value, 0.25);
	assert.equal(project.automationLanes[0]?.points.at(-1)?.id, 'end');
	assert.ok(livePreviews.length >= 4);
	assert.deepEqual(livePreviews.at(-1), [project.automationLanes[0]?.address, 0.25]);
	assert.equal(binding.actions.getSnapshot().mode, 'touch');
	readOnly = true;
	for (const listener of documentListeners) listener();
	assert.equal(binding.actions.getSnapshot().mode, 'read');
	binding.dispose();
	assert.equal(documentListeners.size, 0);
	assert.equal(positionListeners.size, 0);
	assert.equal(stateListeners.size, 0);
});

test('every writing mode cancels on each authority loss without entering history', () => {
	const causes = [
		'cancel', 'read-only', 'lock', 'target-removal', 'project-change',
		'revision-change', 'transport-failure',
	] as const;
	for (const mode of ['trim', 'touch', 'latch', 'write'] as const) {
		for (const cause of causes) {
			const fixture = createFixture();
			const token = armWritingGesture(fixture, mode);
			fixture.authority.positionFrame = 20;
			fixture.coordinator.previewGesture(token, 0.25);
			if (cause === 'cancel') fixture.coordinator.cancelGesture(token);
			else {
				if (cause === 'read-only') fixture.authority.readOnly = true;
				if (cause === 'lock') fixture.targetLocked = true;
				if (cause === 'target-removal') fixture.targetAvailable = false;
				if (cause === 'project-change') fixture.authority.projectId = 'replacement';
				if (cause === 'revision-change') fixture.authority.projectRevision = 1;
				if (cause === 'transport-failure') fixture.authority.transportState = 'failed';
				fixture.coordinator.synchronize();
			}
			const label = `${mode}: ${cause}`;
			assert.equal(fixture.commits.length, 0, label);
			assert.equal(fixture.coordinator.getSnapshot().active, false, label);
			assert.equal(fixture.restores, 1, label);
			if (cause !== 'cancel') assert.equal(fixture.coordinator.getSnapshot().mode, 'read', label);
		}
	}
});

interface MutableAuthority extends SoundscaperAutomationAuthorityV21 {
	projectId: string | null;
	projectRevision: number | null;
	readOnly: boolean;
	lockReadOnly: boolean;
	transportState: string;
	positionFrame: number;
	sampleRate: number;
	tempoMap?: SoundscaperAutomationAuthorityV21['tempoMap'];
}

function armWritingGesture<Result>(
	fixture: Readonly<{
		authority: MutableAuthority;
		coordinator: SoundscaperAutomationSessionV21<Result>;
	}>,
	mode: 'trim' | 'touch' | 'latch' | 'write',
): SoundscaperAutomationGestureTokenV21 {
	fixture.coordinator.setMode(mode, 'voice-gain');
	fixture.authority.positionFrame = 10;
	fixture.authority.transportState = 'playing';
	if (mode === 'write') fixture.coordinator.synchronize();
	return fixture.coordinator.beginGesture('voice-gain', 0.5);
}

function createHistoryFixture() {
	const project = projectFixture();
	let history = createSoundscaperProjectHistoryV21(project);
	let commitCount = 0;
	const authority: MutableAuthority = {
		projectId: project.id,
		projectRevision: project.revision,
		readOnly: false,
		lockReadOnly: false,
		transportState: 'stopped',
		positionFrame: 0,
		sampleRate: project.sampleRate,
		tempoMap: project.tempoMap,
	};
	const coordinator = createSoundscaperAutomationSessionV21<SoundscaperProjectV21>({
		captureAuthority: () => authority,
		resolveTarget: (laneId) => {
			const lane = history.present.automationLanes.find(({ id }) => id === laneId);
			return lane ? {
				lane,
				descriptor: stripParameterDescriptor(lane.address),
				controlValue: 0.5,
				locked: false,
			} : null;
		},
		commit: (command) => {
			commitCount += 1;
			history = executeSoundscaperProjectCommandV21(
				history,
				command as AudioEditorCommand,
				{ now: NOW },
			);
			authority.projectRevision = history.present.revision;
			return history.present;
		},
	});
	const synchronizeRevision = () => { authority.projectRevision = history.present.revision; };
	return {
		authority,
		coordinator,
		get history() { return history; },
		get commitCount() { return commitCount; },
		undo() {
			history = undoSoundscaperProjectCommandV21(history, { now: NOW });
			synchronizeRevision();
		},
		redo() {
			history = redoSoundscaperProjectCommandV21(history, { now: NOW });
			synchronizeRevision();
		},
	};
}

function createFixture() {
	const project = projectFixture();
	const lane = project.automationLanes[0]!;
	const authority: MutableAuthority = {
		projectId: project.id,
		projectRevision: project.revision,
		readOnly: false,
		lockReadOnly: false,
		transportState: 'stopped',
		positionFrame: 0,
		sampleRate: project.sampleRate,
		tempoMap: project.tempoMap,
	};
	const commits: AudioEditorCommand[] = [];
	let targetAvailable = true;
	let targetLocked = false;
	let restores = 0;
	const coordinator = createSoundscaperAutomationSessionV21({
		captureAuthority: () => authority,
		resolveTarget: (laneId) => targetAvailable && laneId === lane.id ? {
			lane,
			descriptor: stripParameterDescriptor(lane.address),
			controlValue: 0.5,
			locked: targetLocked,
		} : null,
		commit: (command) => {
			commits.push(command as AudioEditorCommand);
			return command;
		},
		restoreReadback: () => { restores += 1; },
	});
	const original = structuredClone(authority);
	return {
		authority,
		commits,
		coordinator,
		get restores() { return restores; },
		get targetAvailable() { return targetAvailable; },
		set targetAvailable(value: boolean) { targetAvailable = value; },
		get targetLocked() { return targetLocked; },
		set targetLocked(value: boolean) { targetLocked = value; },
		reset() {
			coordinator.resetProject();
			Object.assign(authority, structuredClone(original));
			commits.length = 0;
			restores = 0;
			targetAvailable = true;
			targetLocked = false;
			coordinator.synchronize();
		},
	};
}

function projectFixture() {
	return createSoundscaperProjectV21({
		id: 'automation-session-project',
		title: 'Automation session project',
		now: NOW,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
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
