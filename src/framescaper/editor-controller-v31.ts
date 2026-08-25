/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createProductNativeRenderInputAuthorityBinding } from '../common/editor/controller/product-native-render-input-authority.ts';
import { createVideoRetimeProgramOrdinalBridge } from '../common/editor/video-retime-program-ordinal-bridge.ts';
import { resolveFramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import { createFramescaperNativeOpenFxFrameRuntimeV28 } from '../common/editor/ui/framescaper-native-openfx-frame-runtime.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV31,
	createFramescaperExistingVideoProxySchedulerV31,
} from './editor-captured-video-proxy-scheduler-v31.ts';
import type {
	FramescaperCapturedVideoProxyRuntimeComposition,
} from './editor-captured-video-proxy-scheduler.ts';
import { bindFramescaperInheritedProductRuntimesV31 } from './editor-controller-v31-inherited-bindings.ts';
import {
	assertFramescaperEditorProjectEnvironmentV31,
	type FramescaperEditorProjectEnvironmentV31,
} from './editor-project-environment-v31.ts';
import { createFramescaperMulticameraActionsV18 } from './editor-project-v18-multicam-actions.ts';
import { createFramescaperSequenceActionsV18 } from './editor-project-v18-sequence-actions.ts';
import { createFramescaperVideoRetimeActionsV20 } from './editor-project-v20-retime-actions.ts';
import { createFramescaperVideoProxyDetachCommandV27 } from './editor-project-v27-commands.ts';
import type { FramescaperProjectCommandV31 } from './editor-project-v31-commands.ts';
import { createFramescaperScapeNativeRuntimeV31 } from './editor-scape-native-v31.ts';
import { createFramescaperNativeRenderInputStreamProducerV31 } from './editor-native-render-input-stream-producer-v31.ts';
import { FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28 } from './editor-native-render-input-producer-v28.ts';
import { createFramescaperNativeProResProxyCandidateObserverV31 } from './editor-native-prores-proxy-candidate-v31.ts';
import { createFramescaperVideoExportStrategyV31 } from './video-export-strategy-v31.ts';
import { createFramescaperVideoProxyActions } from './editor-video-proxy-actions-v20.ts';
import type {
	FramescaperVideoProxyActionRuntime,
	FramescaperVideoProxyPreviewTrustV20,
} from './editor-video-proxy-action-runtime-v20.ts';
import { createFramescaperVideoProxyPreviewMediaResolverV28 } from './editor-video-proxy-preview-media-v20.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface FramescaperAudioEditorControllerPresentationV31 {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

/** Bind the complete selected-V28 product runtime to exact F31 document custody. */
export function createFramescaperAudioEditorControllerV31(
	environmentValue: FramescaperEditorProjectEnvironmentV31 | unknown,
	presentationValue: FramescaperAudioEditorControllerPresentationV31 | unknown = {},
): ReturnType<typeof createAudioEditorController> {
	const environment = assertFramescaperEditorProjectEnvironmentV31(environmentValue);
	const presentation = snapshotPresentation(presentationValue);
	let executeProductSequenceCommand: ((command: unknown) => unknown) | null = null;
	const execute = (command: FramescaperProjectCommandV31): unknown => {
		if (!executeProductSequenceCommand) throw new Error('The Framescaper F31 controller is not ready.');
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
	const prepareNativeRenderInputStreamV31 = createFramescaperNativeRenderInputStreamProducerV31(
		environment.runtime.profile,
		{ authority: nativeRenderInputAuthority, store: environment.controllerStore },
		openFxExecute ? Object.freeze({
			...FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28,
			openFxExecute,
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
		framescaperCaptureRouteSchemaVersion: 31,
		store: environment.controllerStore,
		sessionController,
		acquireProjectLock: environment.runtime.acquireProjectLock,
		projectRuntime: environment.runtime,
		playbackProjectService: environment.playback,
		createProjectIfAbsent: environment.createProjectIfAbsent,
		scapeProjectRuntime: createFramescaperScapeNativeRuntimeV31(environment.runtime.profile),
		productSequenceActions,
		createProductVideoRetimeProgramOrdinalBridge: createVideoRetimeProgramOrdinalBridge,
		productVideoExportStrategy: createFramescaperVideoExportStrategyV31(
			environment.runtime.profile, undefined, environment.controllerStore, openFxExecute,
		),
		resolveProductVideoPreviewMedia,
		reportProductVideoPreviewPressure: (
			sourceId: string,
			pressure: Parameters<FramescaperVideoProxyActionRuntime['reportPreviewPressure']>[1],
		) => proxyActions?.reportPreviewPressure(sourceId, pressure),
		createFramescaperCaptureProxyScheduler: (composition: Readonly<Record<string, unknown>>) => {
			const base = composition as unknown as FramescaperCapturedVideoProxyRuntimeComposition;
			const candidateObserver = createFramescaperNativeProResProxyCandidateObserverV31({
				profile: environment.runtime.profile,
				getProject: () => controller?.project ?? null,
				composition: base,
			});
			proxyComposition = candidateObserver === null ? base : Object.freeze({
				...base, candidateObserver,
			});
			return createFramescaperCapturedVideoProxySchedulerV31(
				environment, sessionController, proxyComposition,
			);
		},
		productNativeRenderInputAuthority: nativeRenderInputAuthority,
		...presentation,
	});
	Object.defineProperty(controller, 'prepareNativeRenderInputStreamV31', {
		enumerable: false, configurable: false, writable: false,
		value: prepareNativeRenderInputStreamV31,
	});
	executeProductSequenceCommand = (command) => controller.actions.edit.commit(command);
	const selectedProxyComposition = proxyComposition;
	if (!selectedProxyComposition) throw new Error('The selected F31 editor did not compose its proxy runtime.');
	proxyActions = createFramescaperVideoProxyActions({
		owner: controller,
		schemaVersion: 31,
		cleanup: environment.videoProxyCleanup,
		createScheduler: () => createFramescaperCapturedVideoProxySchedulerV31(
			environment, sessionController, selectedProxyComposition,
		),
		createAttachExistingScheduler: (candidate) => createFramescaperExistingVideoProxySchedulerV31(
			environment, sessionController, selectedProxyComposition, candidate,
		),
		createDetachCommand: createFramescaperVideoProxyDetachCommandV27,
		previewTrust: (sourceId, attachment) => {
			const entry = proxyTrust.get(sourceId);
			return entry !== undefined && entry.attachment === attachment
				? entry.status : 'unverified';
		},
	});
	bindFramescaperInheritedProductRuntimesV31({
		controller,
		environment,
		bridge: nativeBridge,
		prepareNativeRenderInputStreamV31,
		...(openFxExecute ? { openFxExecute } : {}),
	});
	return controller;
}

function snapshotPresentation(value: unknown): FramescaperAudioEditorControllerPresentationV31 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper F31 controller presentation must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !PRESENTATION_FIELDS.includes(
		key as (typeof PRESENTATION_FIELDS)[number],
	))) throw new TypeError('Framescaper F31 controller presentation contains unsupported authority.');
	const output: Record<string, unknown> = {};
	for (const key of PRESENTATION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper F31 presentation ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.locale !== undefined && typeof output.locale !== 'string') {
		throw new TypeError('Framescaper F31 controller locale must be a string.');
	}
	if (output.copy !== undefined && (!output.copy || typeof output.copy !== 'object'
		|| Array.isArray(output.copy))) {
		throw new TypeError('Framescaper F31 controller copy must be an object.');
	}
	return output as FramescaperAudioEditorControllerPresentationV31;
}
