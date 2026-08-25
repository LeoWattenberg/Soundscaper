/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createVideoRetimeProgramOrdinalBridge } from '../common/editor/video-retime-program-ordinal-bridge.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV30,
	type FramescaperCapturedVideoProxyRuntimeComposition,
} from './editor-captured-video-proxy-scheduler.ts';
import { createFramescaperExistingVideoProxySchedulerV30 } from './editor-existing-video-proxy-scheduler.ts';
import {
	assertFramescaperEditorProjectEnvironmentV30,
	type FramescaperEditorProjectEnvironmentV30,
} from './editor-project-environment-v30.ts';
import { createFramescaperMulticameraActionsV18 } from './editor-project-v18-multicam-actions.ts';
import { createFramescaperSequenceActionsV18 } from './editor-project-v18-sequence-actions.ts';
import { createFramescaperVideoRetimeActionsV20 } from './editor-project-v20-retime-actions.ts';
import { createFramescaperVideoProxyDetachCommandV27 } from './editor-project-v27-commands.ts';
import type { FramescaperProjectCommandV30 } from './editor-project-v30-commands.ts';
import { createFramescaperScapeNativeRuntimeV30 } from './editor-scape-native-v30.ts';
import { bindFramescaperSelectedAuthoringControllerV30 } from './editor-selected-v27-authoring-controller.ts';
import {
	bindFramescaperSelectedImageAuthoringControllerV30,
	type FramescaperSelectedImageFileServiceV30,
} from './editor-selected-v30-image-authoring-controller.ts';
import {
	bindFramescaperSelectedImagePreviewControllerV30,
} from './editor-selected-v30-image-preview-controller.ts';
import type {
	FramescaperTimelineImagePublicationSessionV30,
} from './editor-timeline-image-current-project-publication-v30.ts';
import {
	bindFramescaperMotionAnalysisActionsV27,
	createFramescaperMotionAnalysisActionsV27,
} from './editor-motion-analysis-actions-v27.ts';
import { createFramescaperMotionAnalysisFrameProviderV27 } from './editor-motion-analysis-frame-provider-v27.ts';
import {
	bindFramescaperCubeLutActionsV27,
	createFramescaperCubeLutActionsV27,
} from './editor-cube-lut-actions-v27.ts';
import { createFramescaperVideoProxyActionsV30 } from './editor-video-proxy-actions-v20.ts';
import type {
	FramescaperVideoProxyActionRuntime,
	FramescaperVideoProxyPreviewTrustV20,
} from './editor-video-proxy-action-runtime-v20.ts';
import {
	createFramescaperVideoProxyPreviewMediaResolverV30,
} from './editor-video-proxy-preview-media-v20.ts';
import { createFramescaperVideoExportStrategyV30 } from './video-export-strategy-v30.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface FramescaperAudioEditorControllerPresentationV30 {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

/** Bind the common editor to exact V30 history, storage, image authoring, and preview. */
export function createFramescaperAudioEditorControllerV30(
	environmentValue: FramescaperEditorProjectEnvironmentV30 | unknown,
	presentationValue: FramescaperAudioEditorControllerPresentationV30 | unknown = {},
): ReturnType<typeof createAudioEditorController> {
	const environment = assertFramescaperEditorProjectEnvironmentV30(environmentValue);
	const presentation = snapshotPresentation(presentationValue);
	let executeProductSequenceCommand: ((command: unknown) => unknown) | null = null;
	const execute = (command: FramescaperProjectCommandV30): unknown => {
		if (!executeProductSequenceCommand) throw new Error('The Framescaper V30 controller is not ready.');
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
	let proxyComposition: FramescaperCapturedVideoProxyRuntimeComposition | null = null;
	let proxyActions: FramescaperVideoProxyActionRuntime | null = null;
	const proxyTrust = new Map<string, Readonly<{
		attachment: unknown;
		status: FramescaperVideoProxyPreviewTrustV20;
	}>>();
	let controller: ReturnType<typeof createAudioEditorController> | null = null;
	const resolveProductVideoPreviewMedia = createFramescaperVideoProxyPreviewMediaResolverV30({
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
		scapeProjectRuntime: createFramescaperScapeNativeRuntimeV30(environment.runtime.profile),
		productSequenceActions,
		createProductVideoRetimeProgramOrdinalBridge: createVideoRetimeProgramOrdinalBridge,
		productVideoExportStrategy: createFramescaperVideoExportStrategyV30(
			environment.runtime.profile, undefined, environment.controllerStore,
		),
		resolveProductVideoPreviewMedia,
		reportProductVideoPreviewPressure: (
			sourceId: string,
			pressure: Parameters<FramescaperVideoProxyActionRuntime['reportPreviewPressure']>[1],
		) => proxyActions?.reportPreviewPressure(sourceId, pressure),
		createFramescaperCaptureProxyScheduler: (composition: Readonly<Record<string, unknown>>) => {
			proxyComposition = composition as unknown as FramescaperCapturedVideoProxyRuntimeComposition;
			return createFramescaperCapturedVideoProxySchedulerV30(
				environment, sessionController, proxyComposition,
			);
		},
		...presentation,
	});
	executeProductSequenceCommand = (command) => controller.actions.edit.commit(command);
	const selectedProxyComposition = proxyComposition;
	if (!selectedProxyComposition) throw new Error('The selected V30 editor did not compose its proxy runtime.');
	proxyActions = createFramescaperVideoProxyActionsV30({
		owner: controller,
		cleanup: environment.videoProxyCleanup,
		createScheduler: () => createFramescaperCapturedVideoProxySchedulerV30(
			environment, sessionController, selectedProxyComposition,
		),
		createAttachExistingScheduler: (candidate) => createFramescaperExistingVideoProxySchedulerV30(
			environment, sessionController, selectedProxyComposition, candidate,
		),
		createDetachCommand: createFramescaperVideoProxyDetachCommandV27,
		previewTrust: (sourceId, attachment) => {
			const entry = proxyTrust.get(sourceId);
			return entry !== undefined && entry.attachment === attachment
				? entry.status : 'unverified';
		},
	});
	bindFramescaperSelectedAuthoringControllerV30({
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
	bindFramescaperSelectedImageAuthoringControllerV30({
		controller,
		session: sessionController as unknown as FramescaperTimelineImagePublicationSessionV30,
		executeCommand: (history, command, options) => environment.runtime.executeCommand(
			history, command, options,
		),
		publishIfCurrent: (request) => environment.timelineImages.publishIfCurrent(request),
		...(presentation.fileService === undefined ? {} : {
			fileService: presentation.fileService as FramescaperSelectedImageFileServiceV30,
		}),
	});
	bindFramescaperSelectedImagePreviewControllerV30({
		controller,
		profile: environment.runtime.profile,
		store: environment.controllerStore,
	});
	return controller;
}

function snapshotPresentation(value: unknown): FramescaperAudioEditorControllerPresentationV30 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper V30 controller presentation must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !PRESENTATION_FIELDS.includes(
		key as (typeof PRESENTATION_FIELDS)[number],
	))) throw new TypeError('Framescaper V30 controller presentation contains unsupported authority.');
	const output: Record<string, unknown> = {};
	for (const key of PRESENTATION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper V30 presentation ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.locale !== undefined && typeof output.locale !== 'string') {
		throw new TypeError('Framescaper V30 controller locale must be a string.');
	}
	if (output.copy !== undefined && (!output.copy || typeof output.copy !== 'object'
		|| Array.isArray(output.copy))) {
		throw new TypeError('Framescaper V30 controller copy must be an object.');
	}
	return output as FramescaperAudioEditorControllerPresentationV30;
}
