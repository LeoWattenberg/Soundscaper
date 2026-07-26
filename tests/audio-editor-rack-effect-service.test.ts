/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { EffectGestureTargetChangedError } from '../src/common/editor/controller/effect-gesture-safety.ts';
import { EditorProjectChangedError, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import {
	createRackEffectService,
	type ControllerRackEffect,
	type EffectParameters,
	type RackEffectControllerState,
	type RackEffectProject,
	type RackEffectScope,
} from '../src/common/editor/controller/rack-effect-service.ts';
import { createEffect } from '../src/common/editor/effects.js';

const COPY = Object.freeze({
	effectTypeRequired: 'Effect type required',
	selectTrackFirst: 'Select a track',
	audioTrackRequired: 'Audio track required',
	effectUnsupported: 'Unsupported effect',
	autoDuckOtherControlTrack: 'Control track required',
	noiseReductionAddedDisabled: 'Noise reduction disabled',
	rackEffectNotFound: 'Rack effect not found',
	missingEffectReadOnly: 'Missing effect is read only',
	projectReadOnly: 'Project is read only',
	audioTrackNotFound: 'Audio track not found',
	pasteEffects: 'Copy effects first',
	paste: 'Paste',
	noiseProfileMissing: 'Noise profile missing',
});

interface Configuration {
	readonly scope: RackEffectScope;
	readonly targetId: string | null;
	readonly effectId: string;
	readonly params: EffectParameters;
	readonly transitionFrames?: number;
}

function createHarness() {
	const delay = createEffect('delay', {
		id: 'delay-1',
		params: { time: 0.25, feedback: 0.3, mix: 0.2 },
	}) as ControllerRackEffect;
	const equalizer = createEffect('eq', { id: 'eq-1' }) as ControllerRackEffect;
	let project: RackEffectProject = {
		id: 'project-a',
		tracks: [{ id: 'track-1', type: 'audio', effects: [delay, equalizer] }],
		master: { effects: [] },
		mixer: { groups: [], sends: [] },
	};
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const state: RackEffectControllerState = {
		selectedTrackId: 'track-1',
		readOnly: false,
		effectClipboard: null,
		rackEffectGestures: new Map(),
		parametricEqGestures: new Map(),
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
	};
	const commands: AudioEditorCommand[] = [];
	const errors: Error[] = [];
	const rackConfigurations: Configuration[] = [];
	const eqConfigurations: Configuration[] = [];
	const statuses: string[] = [];
	let publications = 0;
	let blocked = false;
	let commitFailure: Error | null = null;

	function updateEffect(command: Extract<AudioEditorCommand, { readonly type: 'effect/update' }>) {
		project = {
			...project,
			tracks: project.tracks.map((track) => track.id !== 'track-1' ? track : {
				...track,
				effects: track.effects?.map((effect) => effect.id !== command.effectId
					? effect
					: {
						...effect,
						...(command.changes.params
							? { params: command.changes.params as EffectParameters }
							: {}),
						...(typeof command.changes.enabled === 'boolean'
							? { enabled: command.changes.enabled }
							: {}),
					}),
			}),
		};
	}

	const service = createRackEffectService({
		state,
		copy: COPY,
		engine: {
			configureRackEffect: (scope, targetId, effectId, params) => {
				rackConfigurations.push({ scope, targetId, effectId, params: structuredClone(params) });
				return rackConfigurations.length;
			},
			configureParametricEq: (scope, targetId, effectId, params, options) => {
				eqConfigurations.push({
					scope, targetId, effectId, params: structuredClone(params),
					...(options?.transitionFrames == null ? {} : { transitionFrames: options.transitionFrames }),
				});
				return eqConfigurations.length;
			},
		},
		getProject: () => project,
		captureProject: () => generation.capture(project.id),
		assertProject: (token) => generation.assertCurrent(token),
		editingBlocked: () => blocked,
		commit: (command) => {
			commands.push(command);
			if (commitFailure) throw commitFailure;
			if (command.type === 'effect/update') updateEffect(command);
			return project;
		},
		handleError: (error) => { errors.push(error); return null; },
		publishDocumentSnapshot: () => { publications += 1; },
		setStatus: (message) => { statuses.push(message); },
	});

	return {
		commands,
		eqConfigurations,
		errors,
		generation,
		get project() { return project; },
		get publications() { return publications; },
		rackConfigurations,
		service,
		setBlocked(value: boolean) { blocked = value; },
		setCommitFailure(error: Error | null) { commitFailure = error; },
		setProject(nextProject: RackEffectProject, activate = false) {
			project = nextProject;
			if (activate) {
				generation.invalidate();
				generation.activate(nextProject.id);
			}
		},
		state,
		statuses,
	};
}

test('rack gestures preview live, commit once, and restore the committed value on cancel', () => {
	const harness = createHarness();
	const { service } = harness;
	assert.deepEqual(service.beginRackEffectGesture('track', 'track-1', 'delay-1'), {
		time: 0.25,
		feedback: 0.3,
		mix: 0.2,
	});
	service.previewRackEffect('track', 'track-1', 'delay-1', { feedback: 0.6 });
	assert.deepEqual(harness.rackConfigurations.at(-1)?.params, {
		time: 0.25,
		feedback: 0.6,
		mix: 0.2,
	});
	assert.equal(harness.project.tracks[0]?.effects?.[0]?.params.feedback, 0.3);

	service.commitRackEffectGesture('track', 'track-1', 'delay-1', {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.equal(harness.commands.length, 1);
	assert.equal(harness.project.tracks[0]?.effects?.[0]?.params.feedback, 0.6);
	assert.equal(harness.state.rackEffectGestures.size, 0);

	service.beginRackEffectGesture('track', 'track-1', 'delay-1');
	service.previewRackEffect('track', 'track-1', 'delay-1', { feedback: 0.1 });
	assert.notEqual(service.cancelRackEffectGesture('track', 'track-1', 'delay-1'), false);
	assert.deepEqual(harness.rackConfigurations.at(-1)?.params, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.equal(harness.commands.length, 1);
});

test('parametric EQ gestures normalize previews, commit once, and cancel cleanly', () => {
	const harness = createHarness();
	const { service } = harness;
	const original = service.beginParametricEqGesture('track', 'track-1', 'eq-1');
	const bands = original.bands as readonly Readonly<Record<string, unknown>>[];
	const preview = {
		...original,
		bands: bands.map((band, index) => index === 0 ? { ...band, gain: 9 } : band),
	};
	service.previewParametricEq('track', 'track-1', 'eq-1', preview);
	const previewBands = harness.eqConfigurations.at(-1)?.params.bands as readonly Readonly<Record<string, unknown>>[];
	assert.equal(previewBands[0]?.gain, 9);

	const committed = {
		...preview,
		bands: preview.bands.map((band, index) => index === 0 ? { ...band, gain: 12 } : band),
	};
	service.commitParametricEqGesture('track', 'track-1', 'eq-1', committed);
	assert.equal(harness.commands.length, 1);
	const storedBands = harness.project.tracks[0]?.effects?.[1]?.params.bands as readonly Readonly<Record<string, unknown>>[];
	assert.equal(storedBands[0]?.gain, 12);

	service.beginParametricEqGesture('track', 'track-1', 'eq-1');
	service.previewParametricEq('track', 'track-1', 'eq-1', {
		...committed,
		bands: committed.bands.map((band, index) => index === 0 ? { ...band, gain: -18 } : band),
	});
	assert.notEqual(service.cancelParametricEqGesture('track', 'track-1', 'eq-1'), false);
	const restoredBands = harness.eqConfigurations.at(-1)?.params.bands as readonly Readonly<Record<string, unknown>>[];
	assert.equal(restoredBands[0]?.gain, 12);
	assert.equal(harness.commands.length, 1);
});

test('rack gestures never configure a switched project or a replaced target', () => {
	const harness = createHarness();
	harness.service.beginRackEffectGesture('track', 'track-1', 'delay-1');
	harness.setProject({ ...harness.project, id: 'project-b' }, true);
	assert.equal(harness.service.cancelRackEffectGesture('track', 'track-1', 'delay-1'), false);
	assert.equal(harness.rackConfigurations.length, 0);

	harness.service.beginRackEffectGesture('track', 'track-1', 'delay-1');
	const replacement = createEffect('delay', {
		id: 'delay-1',
		params: { time: 0.25, feedback: 0.9, mix: 0.2 },
	}) as ControllerRackEffect;
	harness.setProject({
		...harness.project,
		tracks: [{
			...harness.project.tracks[0]!,
			effects: [replacement, harness.project.tracks[0]!.effects![1]!],
		}],
	});
	assert.throws(
		() => harness.service.commitRackEffectGesture('track', 'track-1', 'delay-1', {
			time: 0.5, feedback: 0.4, mix: 0.2,
		}),
		EffectGestureTargetChangedError,
	);
	assert.equal(harness.rackConfigurations.length, 0);
	assert.equal(harness.commands.length, 0);
	assert.equal(harness.state.rackEffectGestures.size, 0);
});

test('rack gesture no-op, read-only, supersession, and commit rollback paths are safe', () => {
	const harness = createHarness();
	const original = harness.service.beginRackEffectGesture('track', 'track-1', 'delay-1');
	harness.service.commitRackEffectGesture('track', 'track-1', 'delay-1', original);
	assert.equal(harness.commands.length, 0);
	assert.equal(harness.rackConfigurations.length, 0);
	assert.equal(harness.service.cancelRackEffectGesture('track', 'track-1', 'delay-1'), false);

	harness.state.readOnly = true;
	assert.throws(
		() => harness.service.commitRackEffectGesture('track', 'track-1', 'delay-1', original),
		/read only/iu,
	);
	harness.state.readOnly = false;

	harness.service.beginRackEffectGesture('track', 'track-1', 'delay-1');
	harness.setCommitFailure(new Error('commit failed'));
	assert.throws(
		() => harness.service.commitRackEffectGesture('track', 'track-1', 'delay-1', {
			time: 0.5, feedback: 0.4, mix: 0.2,
		}),
		/commit failed/u,
	);
	assert.deepEqual(harness.rackConfigurations.at(-1)?.params, original);

	harness.setCommitFailure(null);
	harness.service.beginRackEffectGesture('track', 'track-1', 'delay-1');
	harness.setProject({ ...harness.project, id: 'project-c' }, true);
	assert.throws(
		() => harness.service.previewRackEffect('track', 'track-1', 'delay-1', { feedback: 0.5 }),
		EditorProjectChangedError,
	);
	assert.equal(harness.state.rackEffectGestures.size, 0);
});

test('rack stack validation and materialization preserve metadata and degraded effects', () => {
	const harness = createHarness();
	const delay = harness.project.tracks[0]!.effects![0]!;
	harness.setProject({
		...harness.project,
		tracks: [
			...harness.project.tracks,
			{ id: 'track-2', type: 'audio', effects: [] },
			{ id: 'label-1', type: 'label', effects: [] },
		],
		mixer: {
			groups: [{ id: 'group-1', effects: [delay] }],
			sends: [{ id: 'send-1', effects: [] }],
		},
	});
	assert.equal(harness.service.effectStack('master', null).length, 0);
	assert.equal(harness.service.effectStack('group', 'group-1').length, 1);
	assert.equal(harness.service.effectStack('send', 'send-1').length, 0);
	assert.throws(() => harness.service.effectStack('group', 'missing'), /Mixer bus/u);
	assert.throws(() => harness.service.effectStack('other', null), /scope must/u);
	assert.throws(() => harness.service.effectStack('track', 'label-1'), /Audio track/u);

	assert.throws(() => harness.service.addEffect(), /Effect type/u);
	assert.throws(() => harness.service.addEffect({ type: 'unsupported' }), /Unsupported/u);
	harness.state.selectedTrackId = null;
	assert.equal(harness.service.addEffect({ type: 'highpass' }), null);
	assert.match(harness.errors.at(-1)?.message || '', /Select/u);
	assert.throws(
		() => harness.service.addEffect({ type: 'highpass', scope: 'group' }),
		/mixer bus ID/u,
	);
	assert.equal(harness.service.addEffect({
		type: 'highpass',
		scope: 'track',
		trackId: 'track-1',
		options: { id: 'highpass-1', params: { frequency: 240, q: 1 } },
	}), 'highpass-1');
	assert.equal(harness.service.addEffect({
		type: 'audacity-auto-duck',
		scope: 'track',
		trackId: 'track-1',
	}), harness.commands.at(-1)?.type === 'effect/add'
		? (harness.commands.at(-1) as Extract<AudioEditorCommand, { readonly type: 'effect/add' }>).effect?.id
		: null);
	assert.ok(harness.service.addEffect({
		type: 'audacity-noise-reduction',
		scope: 'track',
		trackId: 'track-1',
	}));
	assert.equal(harness.statuses.at(-1), COPY.noiseReductionAddedDisabled);

	const metadataEffect = createEffect('delay', {
		id: 'metadata-delay',
		params: { time: 0.25, feedback: 0.3, mix: 0.2 },
		context: { routing: 'kept' },
		state: { cache: 'kept' },
	}) as ControllerRackEffect;
	const materialized = harness.service.materializeRackEffect(metadataEffect, 'track', 'track-1');
	assert.notEqual(materialized.id, metadataEffect.id);
	assert.deepEqual(materialized.context, metadataEffect.context);
	assert.deepEqual(materialized.state, metadataEffect.state);

	const missing: ControllerRackEffect = {
		id: 'missing-1',
		type: 'missing',
		enabled: false,
		bypassed: true,
		params: {},
		missing: { name: 'Native effect', nativeId: 'native', reason: 'Unavailable', source: 'aup4' },
	};
	const materializedMissing = harness.service.materializeRackEffect(
		missing, 'track', 'track-1', { forceEnabled: true },
	);
	assert.notEqual(materializedMissing.id, missing.id);
	assert.equal(materializedMissing.enabled, true);
	assert.equal(materializedMissing.bypassed, true);

	const noiseReduction = createEffect('audacity-noise-reduction', {
		id: 'noise-1',
		enabled: false,
	}) as ControllerRackEffect;
	assert.throws(
		() => harness.service.materializeRackEffect(
			noiseReduction, 'track', 'track-1', { requireNoiseProfile: true },
		),
		/Noise profile/u,
	);
	harness.state.audacityNoiseProfile = { meanPowers: new Float32Array([0.25]) };
	const withProfile = harness.service.materializeRackEffect(
		noiseReduction, 'track', 'track-1', { requireNoiseProfile: true },
	);
	assert.deepEqual(withProfile.context?.noiseProfile, { meanPowers: [0.25] });
});

test('effect stack copy and paste materializes independent effect identities', () => {
	const harness = createHarness();
	const copied = harness.service.copyEffectStack('track', 'track-1');
	assert.equal(copied.length, 2);
	assert.notEqual(copied, harness.project.tracks[0]?.effects);
	const pasted = harness.service.pasteEffectStack('track', 'track-1');
	assert.ok(pasted);
	assert.deepEqual(pasted.map((effect) => effect.type), ['delay', 'eq']);
	assert.equal(pasted.some((effect, index) => (
		effect.id === harness.project.tracks[0]?.effects?.[index]?.id
	)), false);
	assert.equal(harness.commands.at(-1)?.type, 'batch');
	assert.equal(harness.publications, 1);
	harness.setBlocked(true);
	assert.equal(harness.service.pasteEffectStack('track', 'track-1'), null);
});
