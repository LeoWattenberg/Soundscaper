/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createProductNativeRenderInputAuthorityBinding } from
	'../common/editor/controller/product-native-render-input-authority.ts';
import { createVideoRetimeProgramOrdinalBridge } from
	'../common/editor/video-retime-program-ordinal-bridge.ts';
import { resolveFramescaperNativeServicesBridge } from
	'../common/editor/ui/framescaper-native-services-bridge.ts';
import { createFramescaperNativeOpenFxFrameRuntimeNativeMedia } from
	'../common/editor/ui/framescaper-native-openfx-frame-runtime.ts';
import {
	createFramescaperCapturedVideoProxyScheduler,
	createFramescaperExistingVideoProxyScheduler,
} from './editor-captured-video-proxy-scheduler-runtime.ts';
import { FRAMESCAPER_EDITOR_CAPTURE_RUNTIME } from './editor-capture-runtime.ts';
import type { FramescaperCapturedVideoProxyRuntimeComposition } from
	'./editor-captured-video-proxy-scheduler.ts';
import { bindFramescaperInheritedProductRuntimesAssistance } from
	'./editor-controller-assistance-inherited-bindings.ts';
import {
	assertFramescaperEditorProjectEnvironment,
	type FramescaperEditorProjectEnvironment,
} from './editor-project-environment.ts';
import { createFramescaperMulticameraActionsSequence } from './editor-project-sequence-multicam-actions.ts';
import { createFramescaperSequenceActionsSequence } from './editor-project-sequence-sequence-actions.ts';
import { createFramescaperVideoRetimeActionsRetime } from './editor-project-retime-retime-actions.ts';
import { createFramescaperVideoProxyDetachCommandFinishing } from './editor-project-finishing-commands.ts';
import type { FramescaperProjectCommand } from './editor-project-commands.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { createFramescaperScapeNativeRuntime } from './editor-scape-native.ts';
import { createFramescaperNativeRenderInputStreamProducer } from
	'./editor-native-render-input-stream-producer.ts';
import { FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA } from
	'./editor-native-render-input-producer.ts';
import { createFramescaperNativeProResProxyCandidateObserver } from
	'./editor-native-prores-proxy-candidate.ts';
import { createFramescaperVideoExportStrategy } from './video-export-strategy.ts';
import { createFramescaperVideoProxyActions } from './editor-video-proxy-actions-retime.ts';
import type {
	FramescaperVideoProxyActionRuntime,
	FramescaperVideoProxyPreviewTrust,
} from './editor-video-proxy-action-runtime.ts';
import { createFramescaperVideoProxyPreviewMediaResolverNativeMedia } from
	'./editor-video-proxy-preview-media-retime.ts';
import {
	bindFramescaperSelectedImageAuthoringControllerTimelineImage,
	type FramescaperSelectedImageFileServiceTimelineImage,
} from './editor-selected-timeline-image-image-authoring-controller.ts';
import { bindFramescaperSelectedImagePreviewControllerTimelineImage } from
	'./editor-selected-timeline-image-image-preview-controller.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface FramescaperAudioEditorControllerPresentation {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

/** Bind the complete Framescaper 1.0 product runtime. */
export function createFramescaperAudioEditorController(
	environmentValue: FramescaperEditorProjectEnvironment | unknown,
	presentationValue: FramescaperAudioEditorControllerPresentation | unknown = {},
): ReturnType<typeof createAudioEditorController> {
	const environment = assertFramescaperEditorProjectEnvironment(environmentValue);
	const presentation = snapshotPresentation(presentationValue);
	let executeProductSequenceCommand: ((command: unknown) => unknown) | null = null;
	const execute = (command: FramescaperProjectCommand): unknown => {
		if (!executeProductSequenceCommand) throw new Error('The Framescaper controller is not ready.');
		return executeProductSequenceCommand(command);
	};
	const videoRetime = createFramescaperVideoRetimeActionsRetime(execute);
	const productSequenceActions = Object.freeze({
		...createFramescaperSequenceActionsSequence(execute),
		...createFramescaperMulticameraActionsSequence(execute),
		retimeSet: videoRetime.set,
		retimeReset: videoRetime.reset,
		retimeConstant: videoRetime.constant,
		retimeReverse: videoRetime.reverse,
		retimeFreeze: videoRetime.freeze,
		retimeRamp: videoRetime.ramp,
	});
	const sessionController = environment.runtime.createSessionController();
	const nativeBridge = resolveFramescaperNativeServicesBridge();
	const openFxFrames = createFramescaperNativeOpenFxFrameRuntimeNativeMedia(nativeBridge);
	const openFxExecute = openFxFrames?.execute.bind(openFxFrames);
	const nativeRenderInputAuthority = createProductNativeRenderInputAuthorityBinding();
	const prepareNativeRenderInputStream = createFramescaperNativeRenderInputStreamProducer(
		environment.runtime.profile,
		{ authority: nativeRenderInputAuthority, store: environment.controllerStore },
		openFxExecute ? Object.freeze({
			...FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA,
			openFxExecute,
		}) : FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA,
	);
	let proxyComposition: FramescaperCapturedVideoProxyRuntimeComposition | null = null;
	let proxyActions: FramescaperVideoProxyActionRuntime | null = null;
	const proxyTrust = new Map<string, Readonly<{
		attachment: unknown;
		status: FramescaperVideoProxyPreviewTrust;
	}>>();
	let controller: ReturnType<typeof createAudioEditorController> | null = null;
	const resolveProductVideoPreviewMedia = createFramescaperVideoProxyPreviewMediaResolverNativeMedia({
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
		framescaperCaptureRuntime: FRAMESCAPER_EDITOR_CAPTURE_RUNTIME,
		framescaperCaptureRouteSchemaVersion: 1,
		store: environment.controllerStore,
		sessionController,
		acquireProjectLock: environment.runtime.acquireProjectLock,
		projectRuntime: environment.runtime,
		playbackProjectService: environment.playback,
		createProjectIfAbsent: environment.createProjectIfAbsent,
		scapeProjectRuntime: createFramescaperScapeNativeRuntime(environment.runtime.profile),
		productSequenceActions,
		createProductVideoRetimeProgramOrdinalBridge: createVideoRetimeProgramOrdinalBridge,
		productVideoExportStrategy: createFramescaperVideoExportStrategy(
			environment.runtime.profile,
			undefined,
			environment.controllerStore,
			openFxExecute,
		),
		resolveProductVideoPreviewMedia,
		reportProductVideoPreviewPressure: (
			sourceId: string,
			pressure: Parameters<FramescaperVideoProxyActionRuntime['reportPreviewPressure']>[1],
		) => proxyActions?.reportPreviewPressure(sourceId, pressure),
		createFramescaperCaptureProxyScheduler: (composition: Readonly<Record<string, unknown>>) => {
			const base = composition as unknown as FramescaperCapturedVideoProxyRuntimeComposition;
			const candidateObserver = createFramescaperNativeProResProxyCandidateObserver({
				profile: environment.runtime.profile,
				getProject: () => controller?.project ?? null,
				composition: base,
			});
			proxyComposition = candidateObserver === null ? base : Object.freeze({
				...base,
				candidateObserver,
			});
			return createFramescaperCapturedVideoProxyScheduler(
				environment,
				sessionController,
				proxyComposition,
			);
		},
		productNativeRenderInputAuthority: nativeRenderInputAuthority,
		...presentation,
	});
	Object.defineProperty(controller, 'prepareNativeRenderInputStream', {
		enumerable: false,
		configurable: false,
		writable: false,
		value: prepareNativeRenderInputStream,
	});
	executeProductSequenceCommand = (command) => controller!.actions.edit.commit(command);
	const selectedProxyComposition = proxyComposition;
	if (!selectedProxyComposition) {
		throw new Error('The Framescaper editor did not compose its proxy runtime.');
	}
	proxyActions = createFramescaperVideoProxyActions({
		owner: controller,
		cleanup: environment.videoProxyCleanup,
		createScheduler: () => createFramescaperCapturedVideoProxyScheduler(
			environment, sessionController, selectedProxyComposition,
		),
		createAttachExistingScheduler: (candidate) => createFramescaperExistingVideoProxyScheduler(
			environment, sessionController, selectedProxyComposition, candidate,
		),
		createDetachCommand: createFramescaperVideoProxyDetachCommandFinishing,
		previewTrust: (sourceId, attachment) => {
			const entry = proxyTrust.get(sourceId);
			return entry !== undefined && entry.attachment === attachment ? entry.status : 'unverified';
		},
	});
	bindFramescaperInheritedProductRuntimesAssistance({
		controller,
		environment,
		bridge: nativeBridge,
		prepareNativeRenderInputStreamAssistance: prepareNativeRenderInputStream,
		...(openFxExecute ? { openFxExecute } : {}),
	} as never);
	bindFramescaperSelectedImageAuthoringControllerTimelineImage({
		controller: controller as never,
		session: sessionController as never,
		executeCommand: (history, command, options) => environment.runtime.executeCommand(
			history as never, command as never, options,
		) as never,
		publishIfCurrent: (request) => environment.timelineImages.publishIfCurrent(request),
		...(presentation.fileService === undefined ? {} : {
			fileService: presentation.fileService as FramescaperSelectedImageFileServiceTimelineImage,
		}),
	});
	bindFramescaperSelectedImagePreviewControllerTimelineImage({
		controller,
		profile: environment.runtime.profile,
		store: environment.controllerStore,
		cloneProject: (_profile, project) => framescaperProjectTimelineImageFoundationShapeAssistance(
			project,
		) as never,
	});
	return controller;
}

function snapshotPresentation(value: unknown): FramescaperAudioEditorControllerPresentation {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper controller presentation must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !PRESENTATION_FIELDS.includes(
		key as (typeof PRESENTATION_FIELDS)[number],
	))) throw new TypeError('Framescaper controller presentation contains unsupported authority.');
	const output: Record<string, unknown> = {};
	for (const key of PRESENTATION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper presentation ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.locale !== undefined && typeof output.locale !== 'string') {
		throw new TypeError('Framescaper controller locale must be a string.');
	}
	if (output.copy !== undefined && (!output.copy || typeof output.copy !== 'object'
		|| Array.isArray(output.copy))) {
		throw new TypeError('Framescaper controller copy must be an object.');
	}
	return output as FramescaperAudioEditorControllerPresentation;
}
