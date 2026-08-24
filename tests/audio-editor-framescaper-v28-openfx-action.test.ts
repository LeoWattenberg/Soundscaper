/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeMediaCapabilitySnapshotV1,
	NATIVE_MEDIA_CAPABILITY_IDS,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import type { FramescaperOpenFxPluginProjectionV1 } from '../src/common/editor/native-ofx-service-contract.ts';
import {
	framescaperOpenFxInteractEffectStateSha256V1,
	OFX_INTERACT_SURFACE_BYTES_V1,
} from '../src/common/editor/native-ofx-interact-contract.ts';
import {
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	bindFramescaperNativeOpenFxActionV28,
	framescaperNativeOpenFxActionBridgeAvailableV28,
	framescaperNativeOpenFxAuthoringRuntimeForV28,
} from '../src/framescaper/editor-native-openfx-action-v28.ts';
import { applyFramescaperProjectCommandV28 } from '../src/framescaper/editor-project-v28-commands.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import {
	cloneFramescaperProjectV28,
	createFramescaperProjectV28,
} from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
const SHA = 'a1'.repeat(32);
const HANDLE = '12'.repeat(20);

test('selected V28 adds one enabled pathless filter to the selected clip through history and save', async () => {
	const fixture = actionFixture();
	assert.equal(framescaperNativeOpenFxActionBridgeAvailableV28(fixture.bridge), true);
	bindFramescaperNativeOpenFxActionV28({
		profile: PROFILE, owner: fixture.controller, bridge: fixture.bridge,
		mintId: () => 'ofx-live-filter',
	});
	assert.deepEqual(framescaperNativeProjectActionRuntimeFor(fixture.controller)?.surfaces, [
		'render-queue-enqueue', 'ofx-add',
	]);
	await framescaperNativeProjectActionRuntimeFor(fixture.controller)!.run('ofx-add');
	assert.deepEqual(fixture.events, ['capabilities', 'inventory', 'commit', 'save']);
	assert.equal(fixture.controller.project.ofxEffects.length, 1);
	const effect = fixture.controller.project.ofxEffects[0]!;
	assert.equal(effect.instanceId, 'ofx-live-filter');
	assert.equal(effect.pluginId, 'net.example.Filter');
	assert.equal(effect.binarySha256, SHA);
	assert.equal(effect.context, 'filter');
	assert.deepEqual(effect.attachment, { kind: 'filter', targetId: 'video-clip' });
	assert.deepEqual(effect.inputs, [{ name: 'Source', sourceRef: 'video-source' }]);
	assert.deepEqual(effect.parameters, []);
	assert.equal(effect.enabled, true);
	assert.equal(effect.frozenFallback, null);
});

test('selected V28 OpenFX authoring refuses disabled capability, ambiguous filters, and non-video selection', async () => {
	for (const [label, mutate, expected] of [
		['disabled', (fixture: ReturnType<typeof actionFixture>) => { fixture.capabilityUsable = false; }, /unavailable/iu],
		['ambiguous', (fixture: ReturnType<typeof actionFixture>) => { fixture.plugins.push(plugin('34'.repeat(20))); }, /ambiguous|exactly one/iu],
		['selection', (fixture: ReturnType<typeof actionFixture>) => {
			fixture.controller.project = createFramescaperProjectV28(PROFILE, framescaperV20Options());
		}, /selected.*clip|selection/iu],
	] as const) {
		const fixture = actionFixture(); mutate(fixture);
		bindFramescaperNativeOpenFxActionV28({
			profile: PROFILE, owner: fixture.controller, bridge: fixture.bridge,
			mintId: () => `ofx-${label}`,
		});
		await assert.rejects(
			() => framescaperNativeProjectActionRuntimeFor(fixture.controller)!.run('ofx-add'),
			expected,
		);
		assert.equal(fixture.controller.project.ofxEffects.length, 0);
		assert.equal(fixture.events.includes('commit'), false);
	}
});

test('selected V28 OpenFX save failure restores the prior project and serializes repeat calls', async () => {
	const fixture = actionFixture(); fixture.failSave = true;
	bindFramescaperNativeOpenFxActionV28({
		profile: PROFILE, owner: fixture.controller, bridge: fixture.bridge,
		mintId: () => 'ofx-save-failure',
	});
	const runtime = framescaperNativeProjectActionRuntimeFor(fixture.controller)!;
	await assert.rejects(() => runtime.run('ofx-add'), /save refused/iu);
	assert.equal(fixture.controller.project.ofxEffects.length, 0);
	assert.deepEqual(fixture.events, ['capabilities', 'inventory', 'commit', 'save', 'undo']);
});

test('selected V28 exposes a branded menu authoring runtime for typed requests', async () => {
	const fixture = actionFixture();
	fixture.plugins.splice(0, 1, {
		...plugin(HANDLE),
		parameters: [{ name: 'amount', type: 'double' as const, animates: true }],
	});
	bindFramescaperNativeOpenFxActionV28({
		profile: PROFILE, owner: fixture.controller, bridge: fixture.bridge,
		mintId: () => 'ofx-typed-filter',
	});
	const authoring = framescaperNativeOpenFxAuthoringRuntimeForV28(fixture.controller);
	assert.ok(authoring);
	const model = await authoring.model();
	const target = model.targets.find(({ context, targetId }) => (
		context === 'filter' && targetId === 'video-clip'
	))!;
	await authoring.author({
		pluginHandle: HANDLE, context: 'filter', targetId: target.targetId, inputs: target.inputs,
		parameters: [{
			name: 'amount', type: 'double', value: [0.75],
			keyframes: [{ frame: 12, value: 1 }],
		}],
		customEncodings: {},
	});
	assert.deepEqual(fixture.controller.project.ofxEffects[0]?.parameters, [{
		name: 'amount', type: 'double', value: [0.75], keyframes: [{ frame: 12, value: 1 }],
	}]);
	assert.deepEqual(fixture.events, [
		'capabilities', 'inventory', 'capabilities', 'inventory', 'commit', 'save',
	]);
	assert.equal(framescaperNativeOpenFxAuthoringRuntimeForV28({}), null);
});

test('selected V28 Interact selects an authored instance and persists typed mutations through history', async () => {
	const fixture = actionFixture();
	fixture.plugins.splice(0, 1, {
		...plugin(HANDLE),
		parameters: [{ name: 'amount', type: 'double' as const, animates: true }],
	});
	bindFramescaperNativeOpenFxActionV28({
		profile: PROFILE, owner: fixture.controller, bridge: fixture.bridge,
		mintId: () => 'ofx-interact-filter',
	});
	const runtime = framescaperNativeOpenFxAuthoringRuntimeForV28(fixture.controller)!;
	const target = (await runtime.model()).targets.find(({ context, targetId }) => (
		context === 'filter' && targetId === 'video-clip'
	))!;
	await runtime.author({
		pluginHandle: HANDLE, context: 'filter', targetId: target.targetId, inputs: target.inputs,
		parameters: [{ name: 'amount', type: 'double', value: [0.25], keyframes: [] }],
		customEncodings: {},
	});
	const authored = await runtime.interactModel();
	assert.equal(authored.instances.length, 1);
	assert.match(authored.instances[0]!.label, /ofx-interact-filter/u);
	const instance = authored.instances[0]!;
	const request = {
		protocolVersion: 1 as const, project: instance.project, pluginHandle: instance.pluginHandle,
		effect: instance.effect,
		effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(instance.effect),
		context: instance.effect.context,
		target: 'overlay' as const, parameterName: null, events: [],
	};
	const committed = await runtime.commitInteract(request, interactResult(request, [{
		parameter: { name: 'amount', type: 'double', value: [0.75],
			keyframes: [{ frame: 12, value: 1 }] },
	}]));
	assert.deepEqual(committed.effect.parameters[0], {
		name: 'amount', type: 'double', value: [0.75], keyframes: [{ frame: 12, value: 1 }],
	});
	assert.equal(committed.project.revision, instance.project.revision + 1);
	assert.deepEqual(fixture.saved?.ofxEffects[0]?.parameters, committed.effect.parameters);
	const reopened = cloneFramescaperProjectV28(PROFILE, structuredClone(fixture.saved!));
	assert.deepEqual(reopened.ofxEffects[0]?.parameters, committed.effect.parameters);
	await assert.rejects(
		() => runtime.commitInteract(request, interactResult(request, [])),
		/stale|revision changed/iu,
	);
});

test('selected V28 Interact validates a no-op result without creating history or save state', async () => {
	const fixture = actionFixture();
	bindFramescaperNativeOpenFxActionV28({
		profile: PROFILE, owner: fixture.controller, bridge: fixture.bridge,
		mintId: () => 'ofx-no-op-filter',
	});
	await framescaperNativeProjectActionRuntimeFor(fixture.controller)!.run('ofx-add');
	const runtime = framescaperNativeOpenFxAuthoringRuntimeForV28(fixture.controller)!;
	const instance = (await runtime.interactModel()).instances[0]!;
	const request = {
		protocolVersion: 1 as const, project: instance.project, pluginHandle: instance.pluginHandle,
		effect: instance.effect,
		effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(instance.effect),
		context: instance.effect.context,
		target: 'overlay' as const, parameterName: null, events: [],
	};
	const before = fixture.events.length;
	const unchanged = await runtime.commitInteract(request, interactResult(request, []));
	assert.equal(unchanged.project.revision, request.project.revision);
	assert.equal(fixture.events.length, before + 2); // capability + authenticated inventory only
});

function actionFixture() {
	const events: string[] = [];
	const plugins = [plugin(HANDLE)];
	let capabilityUsable = true;
	let failSave = false;
	let saved: ReturnType<typeof project> | null = null;
	let prior = project();
	const controller = {
		project: prior,
		actions: {
			edit: {
				commit(command: unknown) {
					events.push('commit'); prior = controller.project;
					controller.project = applyFramescaperProjectCommandV28(
						PROFILE, controller.project, command,
						{ now: '2026-08-24T12:00:00.000Z' },
					);
				},
				undo() { events.push('undo'); controller.project = prior; },
			},
			project: { async save() {
				events.push('save'); if (failSave) throw new Error('save refused');
				saved = structuredClone(controller.project) as ReturnType<typeof project>;
			} },
		},
	};
	bindFramescaperNativeProjectActionRuntime(controller,
		createFramescaperNativeProjectActionSubsetRuntime(['render-queue-enqueue'], {
			'render-queue-enqueue': async () => undefined,
		}));
	const bridge = {
		capabilities: async () => {
			events.push('capabilities'); return capabilities(capabilityUsable);
		},
		listOpenFxPlugins: async () => { events.push('inventory'); return structuredClone(plugins); },
	};
	return {
		controller, bridge, plugins, events,
		get capabilityUsable() { return capabilityUsable; },
		set capabilityUsable(value: boolean) { capabilityUsable = value; },
		get failSave() { return failSave; },
		set failSave(value: boolean) { failSave = value; },
		get saved() { return saved; },
	};
}

function interactResult(
	request: Readonly<{ project: Readonly<{ id: string; revision: number }>;
		effect: ReturnType<typeof project>['ofxEffects'][number] }>,
	parameterMutations: readonly unknown[],
) {
	return {
		protocolVersion: 1 as const, project: request.project, instanceId: request.effect.instanceId,
		effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(request.effect),
		width: 64 as const, height: 64 as const, rowBytes: 256 as const,
		target: 'overlay' as const, parameterName: null, acceptedSequences: [],
		redrawRequested: false, surfaceDisposition: 'retained' as const,
		parameterMutations: parameterMutations as never,
		rgba: new Uint8Array(OFX_INTERACT_SURFACE_BYTES_V1),
	};
}

function project() {
	return createFramescaperProjectV28(PROFILE, {
		...framescaperV20Options(), id: 'selected-v28-openfx-action',
		selection: {
			startFrame: 0, endFrame: 0, trackIds: ['video-track'], clipIds: ['video-clip'],
		},
	});
}

function capabilities(usable: boolean) {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: [Object.freeze({
			...NATIVE_MEDIA_CAPABILITY_IDS.ofxHost,
			policyCleared: usable, buildSupported: usable, probeSucceeded: usable,
			selfTestPassed: usable, userEnabled: usable,
		})],
	});
}

function plugin(pluginHandle: string): FramescaperOpenFxPluginProjectionV1 {
	return {
		pluginHandle, pluginId: 'net.example.Filter', vendor: 'Example',
		version: { major: 1, minor: 0 }, binarySha256: SHA,
		supportedContexts: ['filter'] as const, parameters: [], components: ['RGBA'] as const,
		pixelDepths: ['byte'] as const, threading: 'instance-safe' as const,
		state: 'enabled' as const, quarantined: false,
	};
}
