/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	adoptFramescaperNativeOpenFxAuthoringRuntimeNativeMedia as adoptRegisteredOpenFxAuthoringRuntime,
	bindFramescaperNativeOpenFxAuthoringRuntimeNativeMedia as bindRegisteredOpenFxAuthoringRuntime,
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
	createFramescaperControllerFoundationViewAssistance,
} from './editor-controller-assistance-foundation-view.ts';
import {
	bindFramescaperCubeLutActionsFinishing,
	createFramescaperCubeLutActionsFinishing,
} from './editor-cube-lut-actions-finishing.ts';
import type { FramescaperEditorProjectEnvironment } from './editor-project-environment.ts';
import type {
	BindFramescaperNativeImageSequenceActionNativeMediaOptions,
} from './editor-native-image-sequence-action.ts';
import type {
	BindFramescaperNativeOpenFxActionNativeMediaOptions,
	FramescaperNativeOpenFxActionRuntimeCompositionNativeMedia,
	FramescaperNativeOpenFxAuthoringRuntimeNativeMedia,
} from './editor-native-openfx-action.ts';
import type {
	FramescaperNativeRenderQueueProjectOwnerNativeMedia,
} from './editor-native-render-queue-action.ts';
import type { FramescaperNativeRenderInputRequestNativeMedia } from './editor-native-render-input-producer.ts';
import type { FramescaperNativeRenderInputStreamNativeMedia } from './editor-native-render-input-stream-core.ts';
import {
	bindFramescaperMotionAnalysisActionsFinishing,
	createFramescaperMotionAnalysisActionsFinishing,
} from './editor-motion-analysis-actions-finishing.ts';
import { createFramescaperMotionAnalysisFrameProviderFinishing } from './editor-motion-analysis-frame-provider-finishing.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { bindFramescaperSelectedAuthoringController } from './editor-selected-authoring-controller-assistance.ts';
import { bindFramescaperSelectedRenderSessionRuntimeAssistance } from './editor-selected-render-session-assistance.ts';
import { bindFramescaperSelectedVisualPreviewControllerAssistance } from './editor-selected-assistance-visual-preview-controller.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';

const IMAGE_SEQUENCE_SURFACES = Object.freeze(['image-sequence-import'] as const);
const OPEN_FX_SURFACES = Object.freeze(['ofx-add'] as const);
const RENDER_QUEUE_SURFACES = Object.freeze(['render-queue-enqueue'] as const);

export type DeferredFramescaperNativeImageSequenceActionModuleNativeMedia = Pick<
	typeof import('./editor-native-image-sequence-action.ts'),
	'createFramescaperNativeImageSequenceActionRuntimeNativeMedia'
>;

export type DeferredFramescaperNativeImageSequenceActionLoaderNativeMedia = () => Promise<
	DeferredFramescaperNativeImageSequenceActionModuleNativeMedia
>;

const DEFAULT_IMAGE_SEQUENCE_LOADER: DeferredFramescaperNativeImageSequenceActionLoaderNativeMedia = () => (
	import('./editor-native-image-sequence-action.ts')
);

export type DeferredFramescaperNativeOpenFxActionModuleNativeMedia = Pick<
	typeof import('./editor-native-openfx-action.ts'),
	'createFramescaperNativeOpenFxActionRuntimeNativeMedia'
>;

export type DeferredFramescaperNativeOpenFxActionLoaderNativeMedia = () => Promise<
	DeferredFramescaperNativeOpenFxActionModuleNativeMedia
>;

const DEFAULT_OPEN_FX_LOADER: DeferredFramescaperNativeOpenFxActionLoaderNativeMedia = () => (
	import('./editor-native-openfx-action.ts')
);

export type DeferredFramescaperNativeRenderQueueActionModuleNativeMedia = Pick<
	typeof import('./editor-native-render-queue-action.ts'),
	'createFramescaperNativeRenderQueueActionRuntimeNativeMedia'
>;

export type DeferredFramescaperNativeRenderQueueActionLoaderNativeMedia = () => Promise<
	DeferredFramescaperNativeRenderQueueActionModuleNativeMedia
>;

const DEFAULT_RENDER_QUEUE_LOADER: DeferredFramescaperNativeRenderQueueActionLoaderNativeMedia = () => (
	import('./editor-native-render-queue-action.ts')
);

export const FRAMESCAPER_ASSISTANCE_INHERITED_PRODUCT_BINDINGS = Object.freeze([
	'selected-authoring', 'selected-visual-preview', 'selected-render-session',
	'motion-analysis', 'cube-lut', 'native-render-queue', 'native-image-sequence',
	'native-openfx',
] as const);

/** Register queue admission and carrier recovery before loading their native execution pipeline. */
export function bindDeferredFramescaperNativeRenderQueueActionNativeMedia(
	profile: unknown,
	owner: FramescaperNativeRenderQueueProjectOwnerNativeMedia,
	loadModule: DeferredFramescaperNativeRenderQueueActionLoaderNativeMedia = DEFAULT_RENDER_QUEUE_LOADER,
): FramescaperNativeProjectActionRuntime {
	if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) {
		throw new TypeError('The selected nativeMedia render queue requires its controller owner.');
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
export function bindDeferredFramescaperNativeImageSequenceActionNativeMedia(
	options: BindFramescaperNativeImageSequenceActionNativeMediaOptions,
	loadModule: DeferredFramescaperNativeImageSequenceActionLoaderNativeMedia = DEFAULT_IMAGE_SEQUENCE_LOADER,
): FramescaperNativeProjectActionRuntime {
	if (!framescaperNativeImageSequenceActionBridgeAvailableNativeMedia(options?.bridge)) {
		throw new Error('Selected nativeMedia image-sequence import requires the complete authenticated desktop bridge.');
	}
	const existing = framescaperNativeProjectActionRuntimeFor(options.owner);
	if (!existing) throw new Error('Selected nativeMedia image-sequence import requires its existing native action runtime.');
	if (existing.surfaces.includes('image-sequence-import')) {
		throw new Error('Selected nativeMedia image-sequence import is already bound.');
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
export function bindDeferredFramescaperNativeOpenFxActionNativeMedia(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
	loadModule: DeferredFramescaperNativeOpenFxActionLoaderNativeMedia = DEFAULT_OPEN_FX_LOADER,
): FramescaperNativeProjectActionRuntime {
	if (!framescaperNativeOpenFxActionBridgeAvailableNativeMedia(options?.bridge)) {
		throw new Error('Selected nativeMedia OpenFX authoring requires the authenticated desktop bridge.');
	}
	const existing = framescaperNativeProjectActionRuntimeFor(options.owner);
	if (!existing) throw new Error('Selected nativeMedia OpenFX authoring requires its existing native action runtime.');
	if (existing.surfaces.includes('ofx-add')) throw new Error('Selected nativeMedia OpenFX authoring is already bound.');
	const loadAction = retryableOpenFxActionLoader(options, loadModule);
	const deferred = createFramescaperNativeProjectActionSubsetRuntime(OPEN_FX_SURFACES, {
		'ofx-add': async (request) => {
			await (await loadAction()).actionRuntime.run('ofx-add', request);
		},
	});
	const authoringRuntime: FramescaperNativeOpenFxAuthoringRuntimeNativeMedia = {
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

/** Install every controller-local selected-baseline runtime on the real assistance owner. */
export function bindFramescaperInheritedProductRuntimesAssistance(options: Readonly<{
	readonly controller: object;
	readonly environment: Readonly<FramescaperEditorProjectEnvironment>;
	readonly bridge: FramescaperNativeServicesBridge | null;
	readonly prepareNativeRenderInputStreamAssistance: (
		request: FramescaperNativeRenderInputRequestNativeMedia,
	) => Promise<FramescaperNativeRenderInputStreamNativeMedia>;
	readonly openFxExecute?: FramescaperSelectedOpenFxExecutionNativeMedia['execute'];
}>): void {
	const { controller, environment } = options;
	const view = createFramescaperControllerFoundationViewAssistance(
		controller,
		options.prepareNativeRenderInputStreamAssistance as unknown as (request: unknown) => Promise<unknown>,
	);
	bindFramescaperSelectedAuthoringController({
		controller: controller as never,
		store: environment.controllerStore,
	});
	bindFramescaperMotionAnalysisActionsFinishing(controller, createFramescaperMotionAnalysisActionsFinishing({
		owner: view as never,
		store: environment.store,
		frameProvider: createFramescaperMotionAnalysisFrameProviderFinishing({
			store: environment.controllerStore,
		}),
	}));
	bindFramescaperCubeLutActionsFinishing(controller, createFramescaperCubeLutActionsFinishing({
		owner: view as never,
		store: environment.store,
	}));
	bindFramescaperSelectedVisualPreviewControllerAssistance({
		controller,
		profile: environment.runtime.profile,
		store: environment.controllerStore,
		...(options.openFxExecute ? { openFxExecute: options.openFxExecute } : {}),
	});
	bindFramescaperSelectedRenderSessionRuntimeAssistance(environment.runtime.profile, controller as never);
	bindDeferredFramescaperNativeRenderQueueActionNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, view as never);
	if (framescaperNativeImageSequenceActionBridgeAvailableNativeMedia(options.bridge)) {
		bindDeferredFramescaperNativeImageSequenceActionNativeMedia({
			profile: FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
			owner: view as never,
			store: environment.store,
			bridge: options.bridge,
		});
	}
	if (framescaperNativeOpenFxActionBridgeAvailableNativeMedia(options.bridge)) {
		bindDeferredFramescaperNativeOpenFxActionNativeMedia({
			profile: FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
			owner: view as never,
			bridge: options.bridge,
		});
		adoptRegisteredOpenFxAuthoringRuntime(view, controller);
	}
	const nativeRuntime = framescaperNativeProjectActionRuntimeFor(view);
	if (!nativeRuntime) throw new Error('assistance lost its selected native project-action runtime.');
	bindFramescaperNativeProjectActionRuntime(controller, nativeRuntime);
}

function retryableRenderQueueActionLoader(
	profile: unknown,
	owner: FramescaperNativeRenderQueueProjectOwnerNativeMedia,
	loadModule: DeferredFramescaperNativeRenderQueueActionLoaderNativeMedia,
): () => Promise<FramescaperNativeProjectActionRuntime> {
	let actionPromise: Promise<FramescaperNativeProjectActionRuntime> | null = null;
	return () => {
		if (actionPromise) return actionPromise;
		const attempt = Promise.resolve().then(loadModule).then((module) => {
			const runtime = module.createFramescaperNativeRenderQueueActionRuntimeNativeMedia(profile, owner);
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
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
	loadModule: DeferredFramescaperNativeOpenFxActionLoaderNativeMedia,
): () => Promise<FramescaperNativeOpenFxActionRuntimeCompositionNativeMedia> {
	let actionPromise: Promise<FramescaperNativeOpenFxActionRuntimeCompositionNativeMedia> | null = null;
	return () => {
		if (actionPromise) return actionPromise;
		const attempt = Promise.resolve().then(loadModule).then((module) => {
			const created = module.createFramescaperNativeOpenFxActionRuntimeNativeMedia(options);
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
): value is FramescaperNativeOpenFxActionRuntimeCompositionNativeMedia {
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
): value is FramescaperNativeOpenFxAuthoringRuntimeNativeMedia {
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
	options: BindFramescaperNativeImageSequenceActionNativeMediaOptions,
	loadModule: DeferredFramescaperNativeImageSequenceActionLoaderNativeMedia,
): () => Promise<FramescaperNativeProjectActionRuntime> {
	let actionPromise: Promise<FramescaperNativeProjectActionRuntime> | null = null;
	return () => {
		if (actionPromise) return actionPromise;
		const attempt = Promise.resolve().then(loadModule).then((module) => {
			const runtime = module.createFramescaperNativeImageSequenceActionRuntimeNativeMedia(options);
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

function framescaperNativeImageSequenceActionBridgeAvailableNativeMedia(
	value: unknown,
): value is BindFramescaperNativeImageSequenceActionNativeMediaOptions['bridge'] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const bridge = value as Readonly<Record<string, unknown>>;
	return [
		'capabilities', 'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
		'imageSequenceImport', 'writeImageSequenceImportChunk', 'readImageSequenceImportBody',
	].every((method) => typeof bridge[method] === 'function');
}

function framescaperNativeOpenFxActionBridgeAvailableNativeMedia(
	value: unknown,
): value is BindFramescaperNativeOpenFxActionNativeMediaOptions['bridge'] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const bridge = value as Readonly<Record<string, unknown>>;
	return typeof bridge.capabilities === 'function' && typeof bridge.listOpenFxPlugins === 'function';
}
