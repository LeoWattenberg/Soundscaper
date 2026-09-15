/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createRackEffectService, type ControllerRackEffect, type RackEffectProject,
	type RackEffectControllerState, type RackEffectScope } from '../src/common/editor/controller/effects/internal/rack-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createEffect } from '../src/common/editor/effects.js';

type Project = RackEffectProject & {
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly automationLanes?: readonly unknown[];
	readonly sources: readonly { id: string; channelCount: number }[];
	readonly clips: readonly { id: string; sourceId: string }[];
	readonly tracks: readonly (RackEffectProject['tracks'][number] & { clipIds: readonly string[] })[];
	readonly mixer: NonNullable<RackEffectProject['mixer']> & {
		readonly schemaVersion?: number;
		readonly edges?: readonly unknown[];
		readonly groups: readonly { id: string; channelCount: number; effects: readonly ControllerRackEffect[] }[];
		readonly sends: readonly { id: string; channelCount: number; effects: readonly ControllerRackEffect[] }[];
	};
};

function fixture(type: string, sampleRate = 48000, channels = 2, production = false): Project {
	const effect = createEffect(type, { id: 'effect-a' }) as ControllerRackEffect;
	return {
		id: 'project-a', sampleRate, masterChannels: channels,
		sources: [{ id: 'source-a', channelCount: channels }],
		clips: [{ id: 'clip-a', sourceId: 'source-a' }],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: ['clip-a'], effects: [effect] }],
		master: { effects: [effect] },
		mixer: {
			groups: [{ id: 'group-a', channelCount: channels, effects: [effect] }],
			sends: [{ id: 'send-a', channelCount: channels, effects: [effect] }],
			...(production ? { schemaVersion: 1, edges: [] } : {}),
		},
		...(production ? { automationLanes: [] } : {}),
	};
}

function harness(initial: Project) {
	let project = initial;
	let history = { present: project, undoStack: [] as Project[] };
	const commands: AudioEditorCommand[] = [];
	let configurations = 0;
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const state: RackEffectControllerState = { selectedTrackId: 'track-a', readOnly: false, writeAuthorityGeneration: 0,
		effectClipboard: null, rackEffectGestures: new Map(), parametricEqGestures: new Map(),
		audacityControlTrackId: null, audacityNoiseProfile: null };
	const service = createRackEffectService({
		state,
		copy: { effectTypeRequired: 'Type required', selectTrackFirst: 'Select track', audioTrackRequired: 'Audio required',
			effectUnsupported: 'Unsupported', autoDuckOtherControlTrack: 'Control required', noiseReductionAddedDisabled: 'Disabled',
			rackEffectNotFound: 'Effect missing', missingEffectReadOnly: 'Read only', projectReadOnly: 'Read only',
			audioTrackNotFound: 'Track missing', paste: 'Paste', noiseProfileMissing: 'Profile missing' },
		engine: { configureRackEffect: () => { configurations += 1; return false; } },
		getProject: () => project,
		captureProject: () => generation.capture(project.id),
		assertProject: (token) => generation.assertCurrent(token),
		editingBlocked: () => false,
		commit: (command) => {
			commands.push(command);
			history = { present: { ...project }, undoStack: [...history.undoStack, project] };
			project = history.present;
			return project;
		},
		handleError: (error) => { throw error; },
		publishDocumentSnapshot: () => {},
		setStatus: () => {},
	});
	return { service, commands, state, get project() { return project; }, get history() { return history; },
		get configurations() { return configurations; } };
}

const scopes: readonly RackEffectScope[] = ['track', 'master', 'group', 'send'];
const targetId = (scope: RackEffectScope): string | null => scope === 'master' ? null : `${scope}-a`;

test('ordinary rack updates reject cutoffs at and beyond project Nyquist before project/history publication', () => {
	for (const type of ['highpass-filter', 'lowpass-filter', 'notch-filter', 'shelf-filter', 'noise-gate']) {
		for (const scope of scopes) {
			const current = harness(fixture(type, 8000));
			const project = current.project;
			const history = current.history;
			for (const frequency of [4000, 5000]) {
				const params = { [type === 'noise-gate' ? 'gateFrequency' : 'frequency']: frequency };
				assert.throws(() => current.service.updateRackEffect(scope, targetId(scope), 'effect-a', { params }), /Nyquist/);
				assert.strictEqual(current.project, project);
				assert.strictEqual(current.history, history);
				assert.equal(current.commands.length, 0);
			}
			current.service.updateRackEffect(scope, targetId(scope), 'effect-a', {
				params: { [type === 'noise-gate' ? 'gateFrequency' : 'frequency']: 3999 },
			});
			assert.equal(current.commands.length, 1);
		}
	}
});

test('rack additions validate disabled filters and reject the 48 kHz maximum cutoff before committing', () => {
	for (const scope of scopes) {
		const current = harness(fixture('tremolo'));
		const history = current.history;
		assert.throws(() => current.service.addEffect({ type: 'highpass-filter', scope, trackId: targetId(scope),
			options: { enabled: false, params: { frequency: 24000 } } }), /Nyquist/);
		assert.strictEqual(current.history, history);
		assert.equal(current.commands.length, 0);
	}
});

test('large delay additions, updates and materialization reject before committing while a mono fit is accepted', () => {
	const params = { time: 5, echoes: 30 };
	for (const scope of scopes) {
		const current = harness(fixture('multi-tap-delay', 96000));
		const history = current.history;
		assert.throws(() => current.service.updateRackEffect(scope, targetId(scope), 'effect-a', { params, enabled: false }), /64 MiB/);
		assert.throws(() => current.service.addEffect({ type: 'multi-tap-delay', scope, trackId: targetId(scope), options: { params } }), /64 MiB/);
		assert.throws(() => current.service.materializeRackEffect({ type: 'multi-tap-delay', params }, scope, targetId(scope)), /64 MiB/);
		assert.strictEqual(current.history, history);
		assert.equal(current.commands.length, 0);
	}
	const mono = harness(fixture('multi-tap-delay', 96000, 1, true));
	mono.service.updateRackEffect('track', 'track-a', 'effect-a', { params });
	assert.equal(mono.commands.length, 1);
});

test('paused gestures reject invalid cutoffs before fallback publication', () => {
	const current = harness(fixture('notch-filter', 8000));
	const history = current.history;
	current.service.beginRackEffectGesture('track', 'track-a', 'effect-a');
	assert.throws(() => current.service.commitRackEffectGesture('track', 'track-a', 'effect-a', { frequency: 4000 }), /Nyquist/);
	assert.strictEqual(current.history, history);
	assert.equal(current.commands.length, 0);
	assert.equal(current.configurations, 0);
	current.service.cancelRackEffectGesture('track', 'track-a', 'effect-a');
});

test('paste and replacement cannot publish an invalid standard configuration', () => {
	const current = harness(fixture('tremolo', 8000));
	const history = current.history;
	current.state.effectClipboard = [createEffect('shelf-filter', { params: { frequency: 5000 } }) as ControllerRackEffect];
	assert.throws(() => current.service.pasteEffectStack('track', 'track-a'), /Nyquist/);
	assert.throws(() => current.service.updateRackEffect('track', 'track-a', 'effect-a', {
		type: 'highpass-filter', params: { frequency: 5000 },
	}), /Nyquist/);
	assert.strictEqual(current.history, history);
	assert.equal(current.commands.length, 0);
});

test('standard delay admission follows legacy mix widths and production bus widths', () => {
	const params = { time: 5, echoes: 10 };
	for (const production of [false, true]) {
		const project = fixture('multi-tap-delay', 48000, 8, production);
		const current = harness({ ...project, masterChannels: 2,
			mixer: { ...project.mixer, groups: [{ ...project.mixer.groups[0], id: 'group-a', channelCount: 2, effects: project.master?.effects || [] }] } });
		if (production) {
			current.service.updateRackEffect('group', 'group-a', 'effect-a', { params });
			current.service.updateRackEffect('master', null, 'effect-a', { params });
			assert.equal(current.commands.length, 2);
		} else {
			assert.throws(() => current.service.updateRackEffect('group', 'group-a', 'effect-a', { params }), /64 MiB/);
			assert.throws(() => current.service.updateRackEffect('master', null, 'effect-a', { params }), /64 MiB/);
			assert.equal(current.commands.length, 0);
		}
		assert.throws(() => current.service.updateRackEffect('track', 'track-a', 'effect-a', { params }), /64 MiB/);
	}
});
