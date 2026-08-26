/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	adoptFramescaperNativeOpenFxAuthoringRuntimeV28 as adoptRegisteredOpenFxAuthoringRuntime,
	bindFramescaperNativeOpenFxAuthoringRuntimeV28 as bindRegisteredOpenFxAuthoringRuntime,
} from '../common/editor/framescaper-native-openfx-authoring-runtime-registry.ts';
import {
	bindFramescaperNativeCarrierRegeneration,
	bindFramescaperNativeProjectActionRuntime,
	composeFramescaperNativeProjectActionRuntimes,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
	hasFramescaperNativeCarrierRegeneration,
	isFramescaperNativeProjectActionRuntime,
	runFramescaperNativeCarrierRegeneration,
	type FramescaperNativeProjectActionRuntime,
} from '../common/editor/ui/framescaper-native-project-actions.ts';
import type { FramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import {
	createFramescaperControllerFoundationViewV31,
} from './editor-controller-v31-foundation-view.ts';
import {
	bindFramescaperCubeLutActionsV27,
	createFramescaperCubeLutActionsV27,
} from './editor-cube-lut-actions-v27.ts';
import type { FramescaperEditorProjectEnvironmentV31 } from './editor-project-environment-v31.ts';
import type {
	BindFramescaperNativeImageSequenceActionV28Options,
} from './editor-native-image-sequence-action-v28.ts';
import type {
	BindFramescaperNativeOpenFxActionV28Options,
	FramescaperNativeOpenFxActionRuntimeCompositionV28,
	FramescaperNativeOpenFxAuthoringRuntimeV28,
} from './editor-native-openfx-action-v28.ts';
import type {
	FramescaperNativeRenderQueueProjectOwnerV28,
} from './editor-native-render-queue-action-v28.ts';
import type { FramescaperNativeRenderInputRequestV28 } from './editor-native-render-input-producer-v28.ts';
import type { FramescaperNativeRenderInputStreamV28 } from './editor-native-render-input-stream-producer-v28.ts';
import {
	bindFramescaperMotionAnalysisActionsV27,
	createFramescaperMotionAnalysisActionsV27,
} from './editor-motion-analysis-actions-v27.ts';
import { createFramescaperMotionAnalysisFrameProviderV27 } from './editor-motion-analysis-frame-provider-v27.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { bindFramescaperSelectedAuthoringControllerV31 } from './editor-selected-authoring-controller-v31.ts';
import { bindFramescaperSelectedRenderSessionRuntimeV31 } from './editor-selected-render-session-v31.ts';
import { bindFramescaperSelectedVisualPreviewControllerV31 } from './editor-selected-v31-visual-preview-controller.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';

const IMAGE_SEQUENCE_SURFACES = Object.freeze(['image-sequence-import'] as const);
const OPEN_FX_SURFACES = Object.freeze(['ofx-add'] as const);
const RENDER_QUEUE_SURFACES = Object.freeze(['render-queue-enqueue'] as const);

export type DeferredFramescaperNativeImageSequenceActionModuleV28 = Pick<
	typeof import('./editor-native-image-sequence-action-v28.ts'),
	'createFramescaperNativeImageSequenceActionRuntimeV28'
>;

export type DeferredFramescaperNativeImageSequenceActionLoaderV28 = () => Promise<
	DeferredFramescaperNativeImageSequenceActionModuleV28
>;

const DEFAULT_IMAGE_SEQUENCE_LOADER: DeferredFramescaperNativeImageSequenceActionLoaderV28 = () => (
	import('./editor-native-image-sequence-action-v28.ts')
);

export type DeferredFramescaperNativeOpenFxActionModuleV28 = Pick<
	typeof import('./editor-native-openfx-action-v28.ts'),
	'createFramescaperNativeOpenFxActionRuntimeV28'
>;

export type DeferredFramescaperNativeOpenFxActionLoaderV28 = () => Promise<
	DeferredFramescaperNativeOpenFxActionModuleV28
>;

const DEFAULT_OPEN_FX_LOADER: DeferredFramescaperNativeOpenFxActionLoaderV28 = () => (
	import('./editor-native-openfx-action-v28.ts')
);

export type DeferredFramescaperNativeRenderQueueActionModuleV28 = Pick<
	typeof import('./editor-native-render-queue-action-v28.ts'),
	'createFramescaperNativeRenderQueueActionRuntimeV28'
>;

export type DeferredFramescaperNativeRenderQueueActionLoaderV28 = () => Promise<
	DeferredFramescaperNativeRenderQueueActionModuleV28
>;

const DEFAULT_RENDER_QUEUE_LOADER: DeferredFramescaperNativeRenderQueueActionLoaderV28 = () => (
	import('./editor-native-render-queue-action-v28.ts')
);

export const FRAMESCAPER_V31_INHERITED_PRODUCT_BINDINGS = Object.freeze([
	'selected-authoring', 'selected-visual-preview', 'selected-render-session',
	'motion-analysis', 'cube-lut', 'native-render-queue', 'native-image-sequence',
	'native-openfx',
] as const);

/** Register queue admission and carrier recovery before loading their native execution pipeline. */
export function bindDeferredFramescaperNativeRenderQueueActionV28(
	profile: unknown,
	owner: FramescaperNativeRenderQueueProjectOwnerV28,
	loadModule: DeferredFramescaperNativeRenderQueueActionLoaderV28 = DEFAULT_RENDER_QUEUE_LOADER,
): FramescaperNativeProjectActionRuntime {
	if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) {
		throw new TypeError('The selected V28 render queue requires its controller owner.');
	}
	const loadAction = retryableRenderQueueActionLoader(profile, owner, loadModule);
	const runtime = createFramescaperNativeProjectActionSubsetRuntime(RENDER_QUEUE_SURFACES, {
		'render-queue-enqueue': async (request) => {
			await (await loadAction()).run('render-queue-enqueue', request);
		},
	});
	bindFramescaperNativeCarrierRegeneration(runtime, async (jobId) => {
		await runFramescaperNativeCarrierRegeneration(await loadAction(), jobId);
	});
	bindFramescaperNativeProjectActionRuntime(owner as object, runtime);
	return runtime;
}

/** Register the desktop menu action synchronously while deferring its import pipeline until use. */
export function bindDeferredFramescaperNativeImageSequenceActionV28(
	options: BindFramescaperNativeImageSequenceActionV28Options,
	loadModule: DeferredFramescaperNativeImageSequenceActionLoaderV28 = DEFAULT_IMAGE_SEQUENCE_LOADER,
): FramescaperNativeProjectActionRuntime {
	if (!framescaperNativeImageSequenceActionBridgeAvailableV28(options?.bridge)) {
		throw new Error('Selected V28 image-sequence import requires the complete authenticated desktop bridge.');
	}
	const existing = framescaperNativeProjectActionRuntimeFor(options.owner);
	if (!existing) throw new Error('Selected V28 image-sequence import requires its existing native action runtime.');
	if (existing.surfaces.includes('image-sequence-import')) {
		throw new Error('Selected V28 image-sequence import is already bound.');
	}
	const loadAction = retryableImageSequenceActionLoader(options, loadModule);
	const deferred = createFramescaperNativeProjectActionSubsetRuntime(IMAGE_SEQUENCE_SURFACES, {
		'image-sequence-import': async (request) => {
			await (await loadAction()).run('image-sequence-import', request);
		},
	});
	const runtime = composeFramescaperNativeProjectActionRuntimes([existing, deferred]);
	bindFramescaperNativeProjectActionRuntime(options.owner, runtime);
	return runtime;
}

/** Register the OpenFX menu and authoring surfaces while deferring native execution. */
export function bindDeferredFramescaperNativeOpenFxActionV28(
	options: BindFramescaperNativeOpenFxActionV28Options,
	loadModule: DeferredFramescaperNativeOpenFxActionLoaderV28 = DEFAULT_OPEN_FX_LOADER,
): FramescaperNativeProjectActionRuntime {
	if (!framescaperNativeOpenFxActionBridgeAvailableV28(options?.bridge)) {
		throw new Error('Selected V28 OpenFX authoring requires the authenticated desktop bridge.');
	}
	const existing = framescaperNativeProjectActionRuntimeFor(options.owner);
	if (!existing) throw new Error('Selected V28 OpenFX authoring requires its existing native action runtime.');
	if (existing.surfaces.includes('ofx-add')) throw new Error('Selected V28 OpenFX authoring is already bound.');
	const loadAction = retryableOpenFxActionLoader(options, loadModule);
	const deferred = createFramescaperNativeProjectActionSubsetRuntime(OPEN_FX_SURFACES, {
		'ofx-add': async (request) => {
			await (await loadAction()).actionRuntime.run('ofx-add', request);
		},
	});
	const authoringRuntime: FramescaperNativeOpenFxAuthoringRuntimeV28 = {
		model: async () => (await loadAction()).authoringRuntime.model(),
		author: async (request) => {
			await (await loadAction()).authoringRuntime.author(request);
		},
		interactModel: async () => (await loadAction()).authoringRuntime.interactModel(),
		commitInteract: async (request, result) => (
			(await loadAction()).authoringRuntime.commitInteract(request, result)
		),
	};
	Object.freeze(authoringRuntime);
	const runtime = composeFramescaperNativeProjectActionRuntimes([existing, deferred]);
	bindFramescaperNativeProjectActionRuntime(options.owner, runtime);
	bindRegisteredOpenFxAuthoringRuntime(options.owner, authoringRuntime);
	return runtime;
}

/** Install every controller-local selected-V28 runtime on the real F31 owner. */
export function bindFramescaperInheritedProductRuntimesV31(options: Readonly<{
	readonly controller: object;
	readonly environment: Readonly<FramescaperEditorProjectEnvironmentV31>;
	readonly bridge: FramescaperNativeServicesBridge | null;
	readonly prepareNativeRenderInputStreamV31: (
		request: FramescaperNativeRenderInputRequestV28,
	) => Promise<FramescaperNativeRenderInputStreamV28>;
	readonly openFxExecute?: FramescaperSelectedOpenFxExecutionV28['execute'];
}>): void {
	const { controller, environment } = options;
	const view = createFramescaperControllerFoundationViewV31(
		controller,
		options.prepareNativeRenderInputStreamV31 as unknown as (request: unknown) => Promise<unknown>,
	);
	bindFramescaperSelectedAuthoringControllerV31({
		controller: controller as never,
		store: environment.controllerStore,
	});
	bindFramescaperMotionAnalysisActionsV27(controller, createFramescaperMotionAnalysisActionsV27({
		owner: view as never,
		store: environment.store,
		frameProvider: createFramescaperMotionAnalysisFrameProviderV27({
			store: environment.controllerStore,
		}),
	}));
	bindFramescaperCubeLutActionsV27(controller, createFramescaperCubeLutActionsV27({
		owner: view as never,
		store: environment.store,
	}));
	bindFramescaperSelectedVisualPreviewControllerV31({
		controller,
		profile: environment.runtime.profile,
		store: environment.controllerStore,
		...(options.openFxExecute ? { openFxExecute: options.openFxExecute } : {}),
	});
	bindFramescaperSelectedRenderSessionRuntimeV31(environment.runtime.profile, controller as never);
	bindDeferredFramescaperNativeRenderQueueActionV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, view as never);
	if (framescaperNativeImageSequenceActionBridgeAvailableV28(options.bridge)) {
		bindDeferredFramescaperNativeImageSequenceActionV28({
			profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			owner: view as never,
			store: environment.store,
			bridge: options.bridge,
		});
	}
	if (framescaperNativeOpenFxActionBridgeAvailableV28(options.bridge)) {
		bindDeferredFramescaperNativeOpenFxActionV28({
			profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			owner: view as never,
			bridge: options.bridge,
		});
		adoptRegisteredOpenFxAuthoringRuntime(view, controller);
	}
	const nativeRuntime = framescaperNativeProjectActionRuntimeFor(view);
	if (!nativeRuntime) throw new Error('F31 lost its selected native project-action runtime.');
	bindFramescaperNativeProjectActionRuntime(controller, nativeRuntime);
}

function retryableRenderQueueActionLoader(
	profile: unknown,
	owner: FramescaperNativeRenderQueueProjectOwnerV28,
	loadModule: DeferredFramescaperNativeRenderQueueActionLoaderV28,
): () => Promise<FramescaperNativeProjectActionRuntime> {
	let actionPromise: Promise<FramescaperNativeProjectActionRuntime> | null = null;
	return () => {
		if (actionPromise) return actionPromise;
		const attempt = Promise.resolve().then(loadModule).then((module) => {
			const runtime = module.createFramescaperNativeRenderQueueActionRuntimeV28(profile, owner);
			if (!isFramescaperNativeProjectActionRuntime(runtime)
				|| runtime.surfaces.length !== 1
				|| runtime.surfaces[0] !== 'render-queue-enqueue'
				|| !hasFramescaperNativeCarrierRegeneration(runtime)) {
				throw new TypeError('Deferred render-queue execution returned an invalid action slice.');
			}
			return runtime;
		});
		actionPromise = attempt;
		void attempt.catch(() => {
			if (actionPromise === attempt) actionPromise = null;
		});
		return attempt;
	};
}

function retryableOpenFxActionLoader(
	options: BindFramescaperNativeOpenFxActionV28Options,
	loadModule: DeferredFramescaperNativeOpenFxActionLoaderV28,
): () => Promise<FramescaperNativeOpenFxActionRuntimeCompositionV28> {
	let actionPromise: Promise<FramescaperNativeOpenFxActionRuntimeCompositionV28> | null = null;
	return () => {
		if (actionPromise) return actionPromise;
		const attempt = Promise.resolve().then(loadModule).then((module) => {
			const created = module.createFramescaperNativeOpenFxActionRuntimeV28(options);
			if (!isExactOpenFxActionComposition(created)) {
				throw new TypeError('Deferred initialization returned an invalid OpenFX action composition.');
			}
			return created;
		});
		actionPromise = attempt;
		void attempt.catch(() => {
			if (actionPromise === attempt) actionPromise = null;
		});
		return attempt;
	};
}

function isExactOpenFxActionComposition(
	value: unknown,
): value is FramescaperNativeOpenFxActionRuntimeCompositionV28 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !exactOwnKeys(value, ['actionRuntime', 'authoringRuntime'])) return false;
	const action = ownDataValue(value, 'actionRuntime');
	const authoring = ownDataValue(value, 'authoringRuntime');
	return isFramescaperNativeProjectActionRuntime(action)
		&& action.surfaces.length === 1 && action.surfaces[0] === 'ofx-add'
		&& isExactOpenFxAuthoringRuntime(authoring);
}

function isExactOpenFxAuthoringRuntime(
	value: unknown,
): value is FramescaperNativeOpenFxAuthoringRuntimeV28 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !exactOwnKeys(value, ['model', 'author', 'interactModel', 'commitInteract'])) return false;
	return ['model', 'author', 'interactModel', 'commitInteract'].every((key) => (
		typeof ownDataValue(value, key) === 'function'
	));
}

function exactOwnKeys(value: object, expected: readonly string[]): boolean {
	const keys = Reflect.ownKeys(value);
	return keys.length === expected.length
		&& keys.every((key) => typeof key === 'string' && expected.includes(key));
}

function ownDataValue(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
		? descriptor.value : undefined;
}

function retryableImageSequenceActionLoader(
	options: BindFramescaperNativeImageSequenceActionV28Options,
	loadModule: DeferredFramescaperNativeImageSequenceActionLoaderV28,
): () => Promise<FramescaperNativeProjectActionRuntime> {
	let actionPromise: Promise<FramescaperNativeProjectActionRuntime> | null = null;
	return () => {
		if (actionPromise) return actionPromise;
		const attempt = Promise.resolve().then(loadModule).then((module) => {
			const runtime = module.createFramescaperNativeImageSequenceActionRuntimeV28(options);
			if (!isFramescaperNativeProjectActionRuntime(runtime)
				|| runtime.surfaces.length !== 1
				|| runtime.surfaces[0] !== 'image-sequence-import') {
				throw new TypeError('Deferred image-sequence execution returned an invalid action slice.');
			}
			return runtime;
		});
		actionPromise = attempt;
		void attempt.catch(() => {
			if (actionPromise === attempt) actionPromise = null;
		});
		return attempt;
	};
}

function framescaperNativeImageSequenceActionBridgeAvailableV28(
	value: unknown,
): value is BindFramescaperNativeImageSequenceActionV28Options['bridge'] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const bridge = value as Readonly<Record<string, unknown>>;
	return [
		'capabilities', 'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
		'imageSequenceImport', 'writeImageSequenceImportChunk', 'readImageSequenceImportBody',
	].every((method) => typeof bridge[method] === 'function');
}

function framescaperNativeOpenFxActionBridgeAvailableV28(
	value: unknown,
): value is BindFramescaperNativeOpenFxActionV28Options['bridge'] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const bridge = value as Readonly<Record<string, unknown>>;
	return typeof bridge.capabilities === 'function' && typeof bridge.listOpenFxPlugins === 'function';
}
