/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createVideoRetimeProgramOrdinalBridge } from '../common/editor/video-retime-program-ordinal-bridge.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV32,
	type FramescaperCapturedVideoProxyRuntimeComposition,
} from './editor-captured-video-proxy-scheduler.ts';
import { createFramescaperExistingVideoProxySchedulerV32 } from './editor-existing-video-proxy-scheduler.ts';
import {
	assertFramescaperEditorProjectEnvironmentV32,
	type FramescaperEditorProjectEnvironmentV32,
} from './editor-project-environment-v32.ts';
import { createFramescaperMulticameraActionsV18 } from './editor-project-v18-multicam-actions.ts';
import { createFramescaperSequenceActionsV18 } from './editor-project-v18-sequence-actions.ts';
import { createFramescaperVideoRetimeActionsV20 } from './editor-project-v20-retime-actions.ts';
import { createFramescaperVideoProxyDetachCommandV27 } from './editor-project-v27-commands.ts';
import type { FramescaperProjectCommandV32 } from './editor-project-v32-commands.ts';
import { createFramescaperScapeNativeRuntimeV32 } from './editor-scape-native-v32.ts';
import { bindFramescaperSelectedAuthoringControllerV32 } from './editor-selected-v27-authoring-controller.ts';
import {
	bindFramescaperSelectedImageAuthoringControllerV32,
	type FramescaperSelectedImageFileServiceV32,
} from './editor-selected-v32-image-authoring-controller.ts';
import {
	bindFramescaperSelectedImagePreviewControllerV32,
} from './editor-selected-v32-image-preview-controller.ts';
import type {
	FramescaperTimelineImagePublicationSessionV32,
} from './editor-timeline-image-current-project-publication-v32.ts';
import {
	bindFramescaperMotionAnalysisActionsV27,
	createFramescaperMotionAnalysisActionsV27,
} from './editor-motion-analysis-actions-v27.ts';
import { createFramescaperMotionAnalysisFrameProviderV27 } from './editor-motion-analysis-frame-provider-v27.ts';
import {
	bindFramescaperCubeLutActionsV27,
	createFramescaperCubeLutActionsV27,
} from './editor-cube-lut-actions-v27.ts';
import { createFramescaperVideoProxyActionsV32 } from './editor-video-proxy-actions-v20.ts';
import type {
	FramescaperVideoProxyActionRuntime,
	FramescaperVideoProxyPreviewTrustV20,
} from './editor-video-proxy-action-runtime-v20.ts';
import {
	createFramescaperVideoProxyPreviewMediaResolverV32,
} from './editor-video-proxy-preview-media-v20.ts';
import { createFramescaperVideoExportStrategyV32 } from './video-export-strategy-v32.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface FramescaperAudioEditorControllerPresentationV32 {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

/** Bind the common editor to exact V32 history, storage, image authoring, and preview. */
export function createFramescaperAudioEditorControllerV32(
	environmentValue: FramescaperEditorProjectEnvironmentV32 | unknown,
	presentationValue: FramescaperAudioEditorControllerPresentationV32 | unknown = {},
): ReturnType<typeof createAudioEditorController> {
	const environment = assertFramescaperEditorProjectEnvironmentV32(environmentValue);
	const presentation = snapshotPresentation(presentationValue);
	let executeProductSequenceCommand: ((command: unknown) => unknown) | null = null;
	const execute = (command: FramescaperProjectCommandV32): unknown => {
		if (!executeProductSequenceCommand) throw new Error('The Framescaper V32 controller is not ready.');
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
	const resolveProductVideoPreviewMedia = createFramescaperVideoProxyPreviewMediaResolverV32({
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
		scapeProjectRuntime: createFramescaperScapeNativeRuntimeV32(environment.runtime.profile),
		productSequenceActions,
		createProductVideoRetimeProgramOrdinalBridge: createVideoRetimeProgramOrdinalBridge,
		productVideoExportStrategy: createFramescaperVideoExportStrategyV32(
			environment.runtime.profile, undefined, environment.controllerStore,
		),
		resolveProductVideoPreviewMedia,
		reportProductVideoPreviewPressure: (
			sourceId: string,
			pressure: Parameters<FramescaperVideoProxyActionRuntime['reportPreviewPressure']>[1],
		) => proxyActions?.reportPreviewPressure(sourceId, pressure),
		createFramescaperCaptureProxyScheduler: (composition: Readonly<Record<string, unknown>>) => {
			proxyComposition = composition as unknown as FramescaperCapturedVideoProxyRuntimeComposition;
			return createFramescaperCapturedVideoProxySchedulerV32(
				environment, sessionController, proxyComposition,
			);
		},
		...presentation,
	});
	executeProductSequenceCommand = (command) => controller.actions.edit.commit(command);
	const selectedProxyComposition = proxyComposition;
	if (!selectedProxyComposition) throw new Error('The selected V32 editor did not compose its proxy runtime.');
	proxyActions = createFramescaperVideoProxyActionsV32({
		owner: controller,
		cleanup: environment.videoProxyCleanup,
		createScheduler: () => createFramescaperCapturedVideoProxySchedulerV32(
			environment, sessionController, selectedProxyComposition,
		),
		createAttachExistingScheduler: (candidate) => createFramescaperExistingVideoProxySchedulerV32(
			environment, sessionController, selectedProxyComposition, candidate,
		),
		createDetachCommand: createFramescaperVideoProxyDetachCommandV27,
		previewTrust: (sourceId, attachment) => {
			const entry = proxyTrust.get(sourceId);
			return entry !== undefined && entry.attachment === attachment
				? entry.status : 'unverified';
		},
	});
	bindFramescaperSelectedAuthoringControllerV32({
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
	bindFramescaperSelectedImageAuthoringControllerV32({
		controller,
		session: sessionController as unknown as FramescaperTimelineImagePublicationSessionV32,
		executeCommand: (history, command, options) => environment.runtime.executeCommand(
			history, command, options,
		),
		publishIfCurrent: (request) => environment.timelineImages.publishIfCurrent(request),
		...(presentation.fileService === undefined ? {} : {
			fileService: presentation.fileService as FramescaperSelectedImageFileServiceV32,
		}),
	});
	bindFramescaperSelectedImagePreviewControllerV32({
		controller,
		profile: environment.runtime.profile,
		store: environment.controllerStore,
	});
	return controller;
}

function snapshotPresentation(value: unknown): FramescaperAudioEditorControllerPresentationV32 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper V32 controller presentation must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !PRESENTATION_FIELDS.includes(
		key as (typeof PRESENTATION_FIELDS)[number],
	))) throw new TypeError('Framescaper V32 controller presentation contains unsupported authority.');
	const output: Record<string, unknown> = {};
	for (const key of PRESENTATION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper V32 presentation ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.locale !== undefined && typeof output.locale !== 'string') {
		throw new TypeError('Framescaper V32 controller locale must be a string.');
	}
	if (output.copy !== undefined && (!output.copy || typeof output.copy !== 'object'
		|| Array.isArray(output.copy))) {
		throw new TypeError('Framescaper V32 controller copy must be an object.');
	}
	return output as FramescaperAudioEditorControllerPresentationV32;
}
