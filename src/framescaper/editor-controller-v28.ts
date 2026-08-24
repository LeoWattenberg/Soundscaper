/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createProductNativeRenderInputAuthorityBinding } from '../common/editor/controller/product-native-render-input-authority.ts';
import { createVideoRetimeProgramOrdinalBridge } from '../common/editor/video-retime-program-ordinal-bridge.ts';
import { resolveFramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import { createFramescaperNativeOpenFxFrameRuntimeV28 } from '../common/editor/ui/framescaper-native-openfx-frame-runtime.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV28,
	type FramescaperCapturedVideoProxyRuntimeComposition,
} from './editor-captured-video-proxy-scheduler.ts';
import {
	assertFramescaperEditorProjectEnvironmentV28,
	type FramescaperEditorProjectEnvironmentV28,
} from './editor-project-environment-v28.ts';
import { createFramescaperExistingVideoProxySchedulerV28 } from './editor-existing-video-proxy-scheduler.ts';
import { createFramescaperMulticameraActionsV18 } from './editor-project-v18-multicam-actions.ts';
import { createFramescaperSequenceActionsV18 } from './editor-project-v18-sequence-actions.ts';
import { createFramescaperVideoRetimeActionsV20 } from './editor-project-v20-retime-actions.ts';
import { createFramescaperVideoProxyDetachCommandV27 } from './editor-project-v27-commands.ts';
import type { FramescaperProjectCommandV28 } from './editor-project-v28-commands.ts';
import { createFramescaperScapeNativeRuntimeV28 } from './editor-scape-native-v28.ts';
import { bindFramescaperSelectedAuthoringControllerV28 } from './editor-selected-v27-authoring-controller.ts';
import { bindFramescaperSelectedVisualPreviewControllerV28 } from './editor-selected-v27-visual-preview-controller.ts';
import { bindFramescaperSelectedRenderSessionRuntimeV28 } from './editor-selected-v28-render-session.ts';
import { bindFramescaperNativeRenderQueueActionV28 } from './editor-native-render-queue-action-v28.ts';
import {
	bindFramescaperNativeImageSequenceActionV28,
	framescaperNativeImageSequenceActionBridgeAvailableV28,
} from './editor-native-image-sequence-action-v28.ts';
import {
	bindFramescaperNativeOpenFxActionV28,
	framescaperNativeOpenFxActionBridgeAvailableV28,
} from './editor-native-openfx-action-v28.ts';
import { createFramescaperNativeRenderInputStreamProducerV28 } from './editor-native-render-input-stream-producer-v28.ts';
import { FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28 } from './editor-native-render-input-producer-v28.ts';
import { createFramescaperNativeProResProxyCandidateObserverV28 } from './editor-native-prores-proxy-candidate-v28.ts';
import {
	bindFramescaperMotionAnalysisActionsV27,
	createFramescaperMotionAnalysisActionsV27,
} from './editor-motion-analysis-actions-v27.ts';
import { createFramescaperMotionAnalysisFrameProviderV27 } from './editor-motion-analysis-frame-provider-v27.ts';
import {
	bindFramescaperCubeLutActionsV27,
	createFramescaperCubeLutActionsV27,
} from './editor-cube-lut-actions-v27.ts';
import { createFramescaperVideoExportStrategyV28 } from './video-export-strategy-v28.ts';
import { createFramescaperVideoProxyActionsV28 } from './editor-video-proxy-actions-v20.ts';
import type {
	FramescaperVideoProxyActionRuntime,
	FramescaperVideoProxyPreviewTrustV20,
} from './editor-video-proxy-action-runtime-v20.ts';
import {
	createFramescaperVideoProxyPreviewMediaResolverV28,
} from './editor-video-proxy-preview-media-v20.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface FramescaperAudioEditorControllerPresentationV28 {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

/** Bind the common editor to the selected V28 document and V19 durability boundary. */
export function createFramescaperAudioEditorControllerV28(
	environmentValue: FramescaperEditorProjectEnvironmentV28 | unknown,
	presentationValue: FramescaperAudioEditorControllerPresentationV28 | unknown = {},
): ReturnType<typeof createAudioEditorController> {
	const environment = assertFramescaperEditorProjectEnvironmentV28(environmentValue);
	const presentation = snapshotPresentation(presentationValue);
	let executeProductSequenceCommand: ((command: unknown) => unknown) | null = null;
	const execute = (command: FramescaperProjectCommandV28): unknown => {
		if (!executeProductSequenceCommand) throw new Error('The Framescaper V28 controller is not ready.');
		return executeProductSequenceCommand(command);
	};
	const videoRetime = createFramescaperVideoRetimeActionsV20(execute);
	const productSequenceActions = Object.freeze({
		...createFramescaperSequenceActionsV18(execute),
		...createFramescaperMulticameraActionsV18(execute),
		retimeSet: videoRetime.set,
		retimeReset: videoRetime.reset,
		retimeConstant: videoRetime.constant,
		retimeReverse: videoRetime.reverse,
		retimeFreeze: videoRetime.freeze,
		retimeRamp: videoRetime.ramp,
	});
	const sessionController = environment.runtime.createSessionController();
	const nativeBridge = resolveFramescaperNativeServicesBridge();
	const openFxFrames = createFramescaperNativeOpenFxFrameRuntimeV28(nativeBridge);
	const openFxExecute = openFxFrames?.execute.bind(openFxFrames);
	const nativeRenderInputAuthority = createProductNativeRenderInputAuthorityBinding();
	const prepareNativeRenderInputStreamV28 = createFramescaperNativeRenderInputStreamProducerV28(
		environment.runtime.profile,
		{ authority: nativeRenderInputAuthority, store: environment.controllerStore },
		openFxExecute ? Object.freeze({
			...FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28, openFxExecute,
		}) : FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28,
	);
	let proxyComposition: FramescaperCapturedVideoProxyRuntimeComposition | null = null;
	let proxyActions: FramescaperVideoProxyActionRuntime | null = null;
	const proxyTrust = new Map<string, Readonly<{
		attachment: unknown;
		status: FramescaperVideoProxyPreviewTrustV20;
	}>>();
	let controller: ReturnType<typeof createAudioEditorController> | null = null;
	const resolveProductVideoPreviewMedia = createFramescaperVideoProxyPreviewMediaResolverV28({
		bodyStore: environment.store,
		originalStore: environment.controllerStore,
		getProject: () => controller?.project ?? null,
		getMode: (sourceId) => proxyActions?.mode(sourceId) ?? 'auto',
		getPressure: (sourceId) => proxyActions?.pressure(sourceId) ?? null,
		onTrustStatus: (sourceId, attachment, status) => {
			proxyTrust.set(sourceId, Object.freeze({ attachment, status }));
		},
	});
	controller = createAudioEditorController(null, {
		headless: true,
		productId: 'framescaper',
		store: environment.controllerStore,
		sessionController,
		acquireProjectLock: environment.runtime.acquireProjectLock,
		projectRuntime: environment.runtime,
		playbackProjectService: environment.playback,
		createProjectIfAbsent: environment.createProjectIfAbsent,
		scapeProjectRuntime: createFramescaperScapeNativeRuntimeV28(environment.runtime.profile),
		productSequenceActions,
		createProductVideoRetimeProgramOrdinalBridge: createVideoRetimeProgramOrdinalBridge,
		productVideoExportStrategy: createFramescaperVideoExportStrategyV28(
			environment.runtime.profile, undefined, environment.controllerStore, openFxExecute,
		),
		resolveProductVideoPreviewMedia,
		reportProductVideoPreviewPressure: (
			sourceId: string,
			pressure: Parameters<FramescaperVideoProxyActionRuntime['reportPreviewPressure']>[1],
		) => proxyActions?.reportPreviewPressure(sourceId, pressure),
		createFramescaperCaptureProxyScheduler: (composition: Readonly<Record<string, unknown>>) => {
			const base = composition as unknown as FramescaperCapturedVideoProxyRuntimeComposition;
			const candidateObserver = createFramescaperNativeProResProxyCandidateObserverV28({
				profile: environment.runtime.profile,
				getProject: () => controller?.project ?? null,
				composition: base,
			});
			proxyComposition = candidateObserver === null ? base : Object.freeze({
				...base, candidateObserver,
			});
			return createFramescaperCapturedVideoProxySchedulerV28(
				environment, sessionController, proxyComposition,
			);
		},
		productNativeRenderInputAuthority: nativeRenderInputAuthority,
		...presentation,
	});
	Object.defineProperty(controller, 'prepareNativeRenderInputStreamV28', {
		enumerable: false, configurable: false, writable: false,
		value: prepareNativeRenderInputStreamV28,
	});
	executeProductSequenceCommand = (command) => controller.actions.edit.commit(command);
	const selectedProxyComposition = proxyComposition;
	if (!selectedProxyComposition) throw new Error('The selected V28 editor did not compose its proxy runtime.');
	proxyActions = createFramescaperVideoProxyActionsV28({
		owner: controller,
		cleanup: environment.videoProxyCleanup,
		createScheduler: () => createFramescaperCapturedVideoProxySchedulerV28(
			environment, sessionController, selectedProxyComposition,
		),
		createAttachExistingScheduler: (candidate) => createFramescaperExistingVideoProxySchedulerV28(
			environment, sessionController, selectedProxyComposition, candidate,
		),
		createDetachCommand: createFramescaperVideoProxyDetachCommandV27,
		previewTrust: (sourceId, attachment) => {
			const entry = proxyTrust.get(sourceId);
			return entry !== undefined && entry.attachment === attachment
				? entry.status : 'unverified';
		},
	});
	bindFramescaperSelectedAuthoringControllerV28({
		controller,
		store: environment.controllerStore,
	});
	bindFramescaperMotionAnalysisActionsV27(controller, createFramescaperMotionAnalysisActionsV27({
		owner: controller,
		store: environment.store,
		frameProvider: createFramescaperMotionAnalysisFrameProviderV27({
			store: environment.controllerStore,
		}),
	}));
	bindFramescaperCubeLutActionsV27(controller, createFramescaperCubeLutActionsV27({
		owner: controller,
		store: environment.store,
	}));
	bindFramescaperSelectedVisualPreviewControllerV28({
		controller,
		profile: environment.runtime.profile,
		store: environment.controllerStore,
		...(openFxExecute ? { openFxExecute } : {}),
	});
	bindFramescaperSelectedRenderSessionRuntimeV28(environment.runtime.profile, controller);
	bindFramescaperNativeRenderQueueActionV28(environment.runtime.profile, controller);
	if (framescaperNativeImageSequenceActionBridgeAvailableV28(nativeBridge)) {
		bindFramescaperNativeImageSequenceActionV28({
			profile: environment.runtime.profile, owner: controller,
			store: environment.store, bridge: nativeBridge,
		});
	}
	if (framescaperNativeOpenFxActionBridgeAvailableV28(nativeBridge)) {
		bindFramescaperNativeOpenFxActionV28({
			profile: environment.runtime.profile, owner: controller, bridge: nativeBridge,
		});
	}
	return controller;
}

function snapshotPresentation(value: unknown): FramescaperAudioEditorControllerPresentationV28 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper V28 controller presentation must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !PRESENTATION_FIELDS.includes(
		key as (typeof PRESENTATION_FIELDS)[number],
	))) throw new TypeError('Framescaper V28 controller presentation contains unsupported authority.');
	const output: Record<string, unknown> = {};
	for (const key of PRESENTATION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper V28 presentation ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.locale !== undefined && typeof output.locale !== 'string') {
		throw new TypeError('Framescaper V28 controller locale must be a string.');
	}
	if (output.copy !== undefined && (!output.copy || typeof output.copy !== 'object')) {
		throw new TypeError('Framescaper V28 controller copy must be an object.');
	}
	return output as FramescaperAudioEditorControllerPresentationV28;
}
