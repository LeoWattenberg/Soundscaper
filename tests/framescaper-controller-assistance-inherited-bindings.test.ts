/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperNativeOpenFxAuthoringRuntimeForNativeMedia as openFxAuthoringFor,
} from '../src/common/editor/framescaper-native-openfx-authoring-runtime-registry.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import {
	bindFramescaperNativeCarrierRegeneration,
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
	runFramescaperNativeCarrierRegeneration,
	type FramescaperNativeProjectActionRuntime,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import { productVideoVisualPreviewRuntimeFor } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import {
	FRAMESCAPER_ASSISTANCE_INHERITED_PRODUCT_BINDINGS as INHERITED_BINDINGS,
	bindDeferredFramescaperNativeImageSequenceActionNativeMedia as bindDeferredImageSequence,
	bindDeferredFramescaperNativeOpenFxActionNativeMedia as bindDeferredOpenFx,
	bindDeferredFramescaperNativeRenderQueueActionNativeMedia as bindDeferredRenderQueue,
	bindFramescaperInheritedProductRuntimesAssistance as bindInheritedRuntimes,
} from '../src/framescaper/editor-controller-assistance-inherited-bindings.ts';
import { framescaperCubeLutActionsFinishingFor } from '../src/framescaper/editor-cube-lut-actions-finishing.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperMotionAnalysisActionsFinishingFor } from '../src/framescaper/editor-motion-analysis-actions-finishing.ts';
import { createFramescaperProjectAssistance } from '../src/framescaper/editor-project-assistance.ts';
import {
	framescaperSelectedRenderSessionRuntimeNativeMediaFor,
} from '../src/framescaper/editor-selected-native-media-render-session.ts';

type Data = Record<string, unknown>;
type Loads = { count: number };
type Runtime = FramescaperNativeProjectActionRuntime;

interface AuthoringFacade {
	model(): Promise<unknown>;
	author(request: unknown): Promise<void>;
	interactModel(): Promise<unknown>;
	commitInteract(request: unknown, result: unknown): Promise<unknown>;
}

const JOB_ID = 'a'.repeat(40);

const IMAGE_SEQUENCE_BRIDGE_METHODS = Object.freeze([
	'capabilities', 'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
	'imageSequenceImport', 'writeImageSequenceImportChunk', 'readImageSequenceImportBody',
] as const);
const OPEN_FX_BRIDGE_METHODS = Object.freeze(['capabilities', 'listOpenFxPlugins'] as const);

function bridgeWith(methods: readonly string[]): Data {
	return Object.fromEntries(methods.map((method) => [method, () => undefined]));
}

function loader(exportName: string, factory: () => unknown, loads: Loads): never {
	return (async () => {
		loads.count += 1;
		return { [exportName]: factory };
	}) as unknown as never;
}

/** An owner that already carries an unrelated action slice, as the real view does. */
function ownerWithExistingRuntime(calls: string[]): Data {
	const owner: Data = {};
	bindFramescaperNativeProjectActionRuntime(owner, createFramescaperNativeProjectActionSubsetRuntime(
		['proxy-attach'] as const,
		{ 'proxy-attach': async () => { calls.push('proxy-attach'); } },
	));
	return owner;
}

function renderQueueSlice(jobs: string[], withRegeneration = true): Runtime {
	const runtime = createFramescaperNativeProjectActionSubsetRuntime(
		['render-queue-enqueue'] as const,
		{ 'render-queue-enqueue': async () => undefined },
	);
	if (withRegeneration) {
		bindFramescaperNativeCarrierRegeneration(runtime, async (jobId) => { jobs.push(jobId); });
	}
	return runtime;
}

function imageSequenceSlice(requests: unknown[]): Runtime {
	return createFramescaperNativeProjectActionSubsetRuntime(
		['image-sequence-import'] as const,
		{ 'image-sequence-import': async (request) => { requests.push(request); } },
	);
}

function ofxSlice(requests: unknown[]): Runtime {
	return createFramescaperNativeProjectActionSubsetRuntime(
		['ofx-add'] as const,
		{ 'ofx-add': async (request) => { requests.push(request); } },
	);
}

function authoringStub(calls: string[]): Data {
	return {
		model: async () => { calls.push('model'); return { plugins: [] }; },
		author: async (request: unknown) => { calls.push(`author:${String((request as Data).pluginHandle)}`); },
		interactModel: async () => { calls.push('interactModel'); return { instances: [] }; },
		commitInteract: async (request: unknown, result: unknown) => {
			calls.push('commitInteract');
			return { request, result };
		},
	};
}

function bindImageSequenceOn(owner: Data, bridge: unknown, factory: () => unknown, loads: Loads): Runtime {
	return bindDeferredImageSequence(
		{ profile: PROFILE, owner, store: {}, bridge } as never,
		loader('createFramescaperNativeImageSequenceActionRuntimeNativeMedia', factory, loads),
	);
}

function bindOpenFxOn(owner: Data, bridge: unknown, factory: () => unknown, loads: Loads): Runtime {
	return bindDeferredOpenFx(
		{ profile: PROFILE, owner, bridge } as never,
		loader('createFramescaperNativeOpenFxActionRuntimeNativeMedia', factory, loads),
	);
}

test('carrier regeneration reaches the deferred render-queue module only for a durable job id', async () => {
	const loads = { count: 0 };
	const jobs: string[] = [];
	const runtime = bindDeferredRenderQueue({}, {} as never, loader(
		'createFramescaperNativeRenderQueueActionRuntimeNativeMedia', () => renderQueueSlice(jobs), loads,
	));

	await assert.rejects(() => runFramescaperNativeCarrierRegeneration(runtime, 'not-a-job'), TypeError);
	assert.equal(loads.count, 0, 'a rejected job id must not pull in the execution module');

	await runFramescaperNativeCarrierRegeneration(runtime, JOB_ID);

	assert.equal(loads.count, 1);
	assert.deepEqual(jobs, [JOB_ID]);
});

test('a render-queue module whose slice cannot regenerate carriers is refused', async () => {
	const loads = { count: 0 };
	const runtime = bindDeferredRenderQueue({}, {} as never, loader(
		'createFramescaperNativeRenderQueueActionRuntimeNativeMedia',
		() => renderQueueSlice([], false),
		loads,
	));

	await assert.rejects(
		() => runFramescaperNativeCarrierRegeneration(runtime, JOB_ID),
		/returned an invalid action slice/u,
	);
	assert.equal(loads.count, 1);
});

test('the image-sequence surface composes onto the existing runtime without loading its module', () => {
	const loads = { count: 0 };
	const owner = ownerWithExistingRuntime([]);

	const runtime = bindImageSequenceOn(owner, bridgeWith(IMAGE_SEQUENCE_BRIDGE_METHODS), () => (
		imageSequenceSlice([])
	), loads);

	assert.deepEqual(runtime.surfaces, ['proxy-attach', 'image-sequence-import']);
	assert.equal(framescaperNativeProjectActionRuntimeFor(owner), runtime);
	assert.equal(loads.count, 0, 'registering the menu action must not import its pipeline');
});

test('an image-sequence import loads its module once and forwards the original request', async () => {
	const loads = { count: 0 };
	const requests: unknown[] = [];
	const existing: string[] = [];
	const owner = ownerWithExistingRuntime(existing);
	const runtime = bindImageSequenceOn(owner, bridgeWith(IMAGE_SEQUENCE_BRIDGE_METHODS), () => (
		imageSequenceSlice(requests)
	), loads);
	const request = Object.freeze({ directoryHandle: 'handle' });

	await runtime.run('image-sequence-import', request);
	await runtime.run('image-sequence-import', request);
	await runtime.run('proxy-attach');

	assert.equal(loads.count, 1, 'a resolved module must be memoised across imports');
	assert.deepEqual(requests, [request, request]);
	assert.deepEqual(existing, ['proxy-attach'], 'the pre-existing slice keeps its own owner');
});

test('a deferred image-sequence module returning the wrong slice is refused', async () => {
	const loads = { count: 0 };
	const owner = ownerWithExistingRuntime([]);
	const runtime = bindImageSequenceOn(
		owner,
		bridgeWith(IMAGE_SEQUENCE_BRIDGE_METHODS),
		() => createFramescaperNativeProjectActionSubsetRuntime(
			['image-sequence-import', 'proxy-detach'] as const,
			{ 'image-sequence-import': async () => undefined, 'proxy-detach': async () => undefined },
		),
		loads,
	);

	await assert.rejects(
		() => runtime.run('image-sequence-import', {}),
		/Deferred image-sequence execution returned an invalid action slice/u,
	);
});

test('a failed image-sequence load is discarded so the next import retries it', async () => {
	const loads = { count: 0 };
	const requests: unknown[] = [];
	const owner = ownerWithExistingRuntime([]);
	let failing = true;
	const runtime = bindDeferredImageSequence(
		{ profile: PROFILE, owner, store: {}, bridge: bridgeWith(IMAGE_SEQUENCE_BRIDGE_METHODS) } as never,
		(async () => {
			loads.count += 1;
			if (failing) throw new Error('the image-sequence module is unavailable');
			return { createFramescaperNativeImageSequenceActionRuntimeNativeMedia: () => imageSequenceSlice(requests) };
		}) as never,
	);

	await assert.rejects(() => runtime.run('image-sequence-import', {}), /module is unavailable/u);
	failing = false;
	await runtime.run('image-sequence-import', { path: 'frames' });

	assert.equal(loads.count, 2);
	assert.deepEqual(requests, [{ path: 'frames' }]);
});

test('an image-sequence bridge missing any desktop method is refused', () => {
	const loads = { count: 0 };
	const rejected: unknown[] = [null, undefined, 'bridge', [], bridgeWith([])];
	for (const method of IMAGE_SEQUENCE_BRIDGE_METHODS) {
		rejected.push(bridgeWith(IMAGE_SEQUENCE_BRIDGE_METHODS.filter((name) => name !== method)));
	}

	for (const bridge of rejected) {
		const owner = ownerWithExistingRuntime([]);
		assert.throws(
			() => bindImageSequenceOn(owner, bridge, () => imageSequenceSlice([]), loads),
			/complete authenticated desktop bridge/u,
		);
		assert.deepEqual(framescaperNativeProjectActionRuntimeFor(owner)?.surfaces, ['proxy-attach']);
	}
});

test('the image-sequence binding requires an existing runtime and refuses a second binding', () => {
	const loads = { count: 0 };
	const bridge = bridgeWith(IMAGE_SEQUENCE_BRIDGE_METHODS);

	assert.throws(
		() => bindImageSequenceOn({}, bridge, () => imageSequenceSlice([]), loads),
		/requires its existing native action runtime/u,
	);

	const owner = ownerWithExistingRuntime([]);
	bindImageSequenceOn(owner, bridge, () => imageSequenceSlice([]), loads);
	assert.throws(
		() => bindImageSequenceOn(owner, bridge, () => imageSequenceSlice([]), loads),
		/image-sequence import is already bound/u,
	);
});

test('the OpenFX surfaces register a frozen authoring facade before the module loads', () => {
	const loads = { count: 0 };
	const owner = ownerWithExistingRuntime([]);

	const runtime = bindOpenFxOn(owner, bridgeWith(OPEN_FX_BRIDGE_METHODS), () => ({
		actionRuntime: ofxSlice([]),
		authoringRuntime: authoringStub([]),
	}), loads);
	const authoring = openFxAuthoringFor(owner);

	assert.deepEqual(runtime.surfaces, ['proxy-attach', 'ofx-add']);
	assert.ok(authoring !== null);
	assert.ok(Object.isFrozen(authoring));
	assert.deepEqual(Object.keys(authoring), ['model', 'author', 'interactModel', 'commitInteract']);
	assert.equal(loads.count, 0);
});

test('the authoring facade forwards every call to the deferred authoring runtime', async () => {
	const loads = { count: 0 };
	const calls: string[] = [];
	const owner = ownerWithExistingRuntime([]);
	bindOpenFxOn(owner, bridgeWith(OPEN_FX_BRIDGE_METHODS), () => ({
		actionRuntime: ofxSlice([]),
		authoringRuntime: authoringStub(calls),
	}), loads);
	const authoring = openFxAuthoringFor(owner) as unknown as AuthoringFacade;
	const request = Object.freeze({ instanceId: 'instance' });
	const result = Object.freeze({ mutations: [] });

	assert.deepEqual(await authoring.model(), { plugins: [] });
	await authoring.author({ pluginHandle: 'blur' });
	assert.deepEqual(await authoring.interactModel(), { instances: [] });
	assert.deepEqual(await authoring.commitInteract(request, result), { request, result });

	assert.deepEqual(calls, ['model', 'author:blur', 'interactModel', 'commitInteract']);
	assert.equal(loads.count, 1, 'one deferred module serves the whole authoring facade');
});

test('the ofx-add action forwards to the deferred action runtime', async () => {
	const loads = { count: 0 };
	const requests: unknown[] = [];
	const owner = ownerWithExistingRuntime([]);
	const runtime = bindOpenFxOn(owner, bridgeWith(OPEN_FX_BRIDGE_METHODS), () => ({
		actionRuntime: ofxSlice(requests),
		authoringRuntime: authoringStub([]),
	}), loads);

	await runtime.run('ofx-add', { pluginHandle: 'blur' });

	assert.deepEqual(requests, [{ pluginHandle: 'blur' }]);
	assert.equal(loads.count, 1);
});

test('a deferred OpenFX module returning an inexact composition is refused', async () => {
	const loads = { count: 0 };
	const compositions: readonly (readonly [string, () => unknown])[] = [
		['a null composition', () => null],
		['an array composition', () => []],
		['a composition carrying an extra key', () => ({
			actionRuntime: ofxSlice([]), authoringRuntime: authoringStub([]), extra: 1,
		})],
		['a composition without its authoring runtime', () => ({ actionRuntime: ofxSlice([]) })],
		['a composition whose action runtime was never created by the factory', () => ({
			actionRuntime: { surfaces: ['ofx-add'], run: async () => undefined },
			authoringRuntime: authoringStub([]),
		})],
		['a composition whose action runtime owns more than ofx-add', () => ({
			actionRuntime: createFramescaperNativeProjectActionSubsetRuntime(
				['ofx-add', 'proxy-detach'] as const,
				{ 'ofx-add': async () => undefined, 'proxy-detach': async () => undefined },
			),
			authoringRuntime: authoringStub([]),
		})],
		['a composition exposing its action runtime through a getter', () => Object.defineProperty(
			{ authoringRuntime: authoringStub([]) },
			'actionRuntime',
			{ get: () => ofxSlice([]), enumerable: true, configurable: true },
		)],
		['a composition hiding its authoring runtime behind a non-enumerable key', () => Object.defineProperty(
			{ actionRuntime: ofxSlice([]) },
			'authoringRuntime',
			{ value: authoringStub([]), enumerable: false, configurable: true },
		)],
		['an authoring runtime missing commitInteract', () => {
			const authoring = authoringStub([]);
			delete authoring.commitInteract;
			return { actionRuntime: ofxSlice([]), authoringRuntime: authoring };
		}],
		['an authoring runtime whose model is not callable', () => ({
			actionRuntime: ofxSlice([]),
			authoringRuntime: { ...authoringStub([]), model: 'not-callable' },
		})],
	];

	for (const [label, factory] of compositions) {
		const owner = ownerWithExistingRuntime([]);
		const runtime = bindOpenFxOn(owner, bridgeWith(OPEN_FX_BRIDGE_METHODS), factory, loads);
		await assert.rejects(
			() => runtime.run('ofx-add', {}),
			/returned an invalid OpenFX action composition/u,
			label,
		);
	}
});

test('a failed OpenFX load is discarded so the next authoring call retries it', async () => {
	const loads = { count: 0 };
	const calls: string[] = [];
	const owner = ownerWithExistingRuntime([]);
	let failing = true;
	bindDeferredOpenFx(
		{ profile: PROFILE, owner, bridge: bridgeWith(OPEN_FX_BRIDGE_METHODS) } as never,
		(async () => {
			loads.count += 1;
			if (failing) throw new Error('the OpenFX module is unavailable');
			return {
				createFramescaperNativeOpenFxActionRuntimeNativeMedia: () => ({
					actionRuntime: ofxSlice([]), authoringRuntime: authoringStub(calls),
				}),
			};
		}) as never,
	);
	const authoring = openFxAuthoringFor(owner) as unknown as AuthoringFacade;

	await assert.rejects(() => authoring.model(), /OpenFX module is unavailable/u);
	failing = false;
	assert.deepEqual(await authoring.model(), { plugins: [] });

	assert.equal(loads.count, 2);
	assert.deepEqual(calls, ['model']);
});

test('the OpenFX binding refuses an unauthenticated bridge, a bare owner and a second binding', () => {
	const loads = { count: 0 };
	const bridge = bridgeWith(OPEN_FX_BRIDGE_METHODS);
	const composition = () => ({ actionRuntime: ofxSlice([]), authoringRuntime: authoringStub([]) });

	for (const rejected of [null, undefined, [], bridgeWith(['capabilities']), bridgeWith(['listOpenFxPlugins'])]) {
		assert.throws(
			() => bindOpenFxOn(ownerWithExistingRuntime([]), rejected, composition, loads),
			/requires the authenticated desktop bridge/u,
		);
	}
	assert.throws(
		() => bindOpenFxOn({}, bridge, composition, loads),
		/requires its existing native action runtime/u,
	);

	const owner = ownerWithExistingRuntime([]);
	bindOpenFxOn(owner, bridge, composition, loads);
	assert.throws(
		() => bindOpenFxOn(owner, bridge, composition, loads),
		/OpenFX authoring is already bound/u,
	);
});

interface ControllerStub {
	readonly project: unknown;
	readonly actions: Readonly<{ readonly edit: Readonly<{ commit(command: unknown): Promise<unknown> }> }>;
	getSnapshot(): Data;
	getTelemetrySnapshot(): Data;
}

function controllerStub(): ControllerStub {
	return {
		project: createFramescaperProjectAssistance(PROFILE, {}),
		actions: { edit: { commit: async (command: unknown) => command } },
		getSnapshot: () => ({ selectedClipId: null }),
		getTelemetrySnapshot: () => ({ positionFrame: 0 }),
	};
}

function controllerWithout(field: string): Data {
	const controller = { ...controllerStub() } as Data;
	delete controller[field];
	return controller;
}

function environmentStub(): Data {
	const store = {
		getMediaAssetMetadata: async () => null,
		beginMediaAssetWrite: async () => { throw new Error('the stub store writes nothing.'); },
		writeMediaAsset: async () => undefined,
		deleteMediaAsset: async () => undefined,
		loadMediaAsset: async () => null,
	};
	return { runtime: { profile: PROFILE }, store, controllerStore: store };
}

function inherit(controller: unknown, bridge: unknown): void {
	bindInheritedRuntimes({
		controller,
		environment: environmentStub(),
		bridge,
		prepareNativeRenderInputStreamAssistance: async () => ({}),
	} as never);
}

function surfacesFor(owner: unknown): readonly string[] {
	return framescaperNativeProjectActionRuntimeFor(owner)?.surfaces ?? [];
}

const INSTALLED: Readonly<Record<string, (owner: unknown) => boolean>> = Object.freeze({
	'selected-authoring': (owner) => framescaperCandidateAuthoringActionRuntimeFor(owner) !== null,
	'selected-visual-preview': (owner) => productVideoVisualPreviewRuntimeFor(owner) !== null,
	'selected-render-session': (owner) => framescaperSelectedRenderSessionRuntimeNativeMediaFor(owner) !== null,
	'motion-analysis': (owner) => framescaperMotionAnalysisActionsFinishingFor(owner) !== null,
	'cube-lut': (owner) => framescaperCubeLutActionsFinishingFor(owner) !== null,
	'native-render-queue': (owner) => surfacesFor(owner).includes('render-queue-enqueue'),
	'native-image-sequence': (owner) => surfacesFor(owner).includes('image-sequence-import'),
	'native-openfx': (owner) => surfacesFor(owner).includes('ofx-add') && openFxAuthoringFor(owner) !== null,
});

test('a complete desktop bridge installs every inherited product binding on the controller', () => {
	const controller = controllerStub();
	const bridge = bridgeWith([...IMAGE_SEQUENCE_BRIDGE_METHODS, ...OPEN_FX_BRIDGE_METHODS]);

	inherit(controller, bridge);

	assert.deepEqual(
		INHERITED_BINDINGS.filter((binding) => !INSTALLED[binding](controller)),
		[],
		'every declared inherited binding must be reachable from the controller',
	);
	assert.deepEqual(
		surfacesFor(controller),
		['render-queue-enqueue', 'image-sequence-import', 'ofx-add'],
	);
});

test('without a desktop bridge only the render-queue surface is inherited', () => {
	const controller = controllerStub();

	inherit(controller, null);

	assert.deepEqual(surfacesFor(controller), ['render-queue-enqueue']);
	assert.equal(openFxAuthoringFor(controller), null);
	assert.deepEqual(
		INHERITED_BINDINGS.filter((binding) => !INSTALLED[binding](controller)),
		['native-image-sequence', 'native-openfx'],
	);
});

test('a bridge that only lists OpenFX plug-ins adds ofx-add without the image-sequence import', () => {
	const controller = controllerStub();

	inherit(controller, bridgeWith(OPEN_FX_BRIDGE_METHODS));

	assert.deepEqual(surfacesFor(controller), ['render-queue-enqueue', 'ofx-add']);
	assert.ok(openFxAuthoringFor(controller) !== null, 'the authoring runtime is adopted from the detached view');
});

test('a bridge that only imports image sequences adds the import surface without ofx-add', () => {
	const controller = controllerStub();

	inherit(controller, bridgeWith(IMAGE_SEQUENCE_BRIDGE_METHODS));

	assert.deepEqual(surfacesFor(controller), ['render-queue-enqueue', 'image-sequence-import']);
	assert.equal(openFxAuthoringFor(controller), null);
});

test('the inherited finishing runtimes read the controller project through its detached view', () => {
	const controller = controllerStub();

	inherit(controller, null);

	assert.deepEqual(framescaperMotionAnalysisActionsFinishingFor(controller)?.targets(), []);
	assert.deepEqual(framescaperCubeLutActionsFinishingFor(controller)?.targets(), []);
});

test('a controller that cannot supply the detached foundation view is refused', () => {
	const rejected: readonly (readonly [unknown, RegExp])[] = [
		[null, /assistance common controller is required/u],
		[[], /assistance common controller is required/u],
		[controllerWithout('actions'), /controller actions is unavailable/u],
		[controllerWithout('getTelemetrySnapshot'), /getTelemetrySnapshot is unavailable/u],
		[{ ...controllerStub(), getSnapshot: 'snapshot' }, /getSnapshot must be a function/u],
	];

	for (const [controller, message] of rejected) {
		assert.throws(() => inherit(controller, null), message);
		assert.deepEqual(surfacesFor(controller), [], 'a refused controller keeps no partial runtime');
	}
});
