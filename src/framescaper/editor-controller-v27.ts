/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createVideoRetimeProgramOrdinalBridge } from '../common/editor/video-retime-program-ordinal-bridge.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV27,
	type FramescaperCapturedVideoProxyRuntimeComposition,
} from './editor-captured-video-proxy-scheduler.ts';
import {
	assertFramescaperEditorProjectEnvironmentV27,
	type FramescaperEditorProjectEnvironmentV27,
} from './editor-project-environment-v27.ts';
import { createFramescaperExistingVideoProxySchedulerV27 } from './editor-existing-video-proxy-scheduler.ts';
import { createFramescaperMulticameraActionsV18 } from './editor-project-v18-multicam-actions.ts';
import { createFramescaperSequenceActionsV18 } from './editor-project-v18-sequence-actions.ts';
import { createFramescaperVideoRetimeActionsV20 } from './editor-project-v20-retime-actions.ts';
import {
	createFramescaperVideoProxyDetachCommandV27,
	type FramescaperProjectCommandV27,
} from './editor-project-v27-commands.ts';
import { createFramescaperScapeNativeRuntimeV27 } from './editor-scape-native-v27.ts';
import { bindFramescaperSelectedAuthoringControllerV27 } from './editor-selected-v27-authoring-controller.ts';
import { bindFramescaperSelectedRenderSessionRuntimeV27 } from './editor-selected-v27-render-session.ts';
import {
	bindFramescaperMotionAnalysisActionsV27,
	createFramescaperMotionAnalysisActionsV27,
} from './editor-motion-analysis-actions-v27.ts';
import {
	createFramescaperMotionAnalysisFrameProviderV27,
} from './editor-motion-analysis-frame-provider-v27.ts';
import { bindFramescaperSelectedVisualPreviewControllerV27 } from './editor-selected-v27-visual-preview-controller.ts';
import {
	bindFramescaperCubeLutActionsV27,
	createFramescaperCubeLutActionsV27,
} from './editor-cube-lut-actions-v27.ts';
import { createFramescaperVideoExportStrategyV27 } from './video-export-strategy-v27.ts';
import { createFramescaperVideoProxyActionsV27 } from './editor-video-proxy-actions-v20.ts';
import type {
	FramescaperVideoProxyActionRuntime,
	FramescaperVideoProxyPreviewTrustV20,
} from './editor-video-proxy-action-runtime-v20.ts';
import {
	createFramescaperVideoProxyPreviewMediaResolverV27,
} from './editor-video-proxy-preview-media-v20.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface FramescaperAudioEditorControllerPresentationV27 {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

/** Bind the common controller to selected V27 without dormant native/OpenFX actions. */
export function createFramescaperAudioEditorControllerV27(
	environmentValue: FramescaperEditorProjectEnvironmentV27 | unknown,
	presentationValue: FramescaperAudioEditorControllerPresentationV27 | unknown = {},
): ReturnType<typeof createAudioEditorController> {
	const environment = assertFramescaperEditorProjectEnvironmentV27(environmentValue);
	const presentation = snapshotPresentation(presentationValue);
	let executeProductSequenceCommand: ((command: unknown) => unknown) | null = null;
	const execute = (command: FramescaperProjectCommandV27): unknown => {
		if (!executeProductSequenceCommand) throw new Error('The Framescaper V27 controller is not ready.');
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
	const resolveProductVideoPreviewMedia = createFramescaperVideoProxyPreviewMediaResolverV27({
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
		scapeProjectRuntime: createFramescaperScapeNativeRuntimeV27(environment.runtime.profile),
		productSequenceActions,
		createProductVideoRetimeProgramOrdinalBridge: createVideoRetimeProgramOrdinalBridge,
		productVideoExportStrategy: createFramescaperVideoExportStrategyV27(
			environment.runtime.profile, undefined, environment.controllerStore,
		),
		resolveProductVideoPreviewMedia,
		reportProductVideoPreviewPressure: (
			sourceId: string,
			pressure: Parameters<FramescaperVideoProxyActionRuntime['reportPreviewPressure']>[1],
		) => proxyActions?.reportPreviewPressure(sourceId, pressure),
		createFramescaperCaptureProxyScheduler: (composition: Readonly<Record<string, unknown>>) => {
			proxyComposition = composition as unknown as FramescaperCapturedVideoProxyRuntimeComposition;
			return createFramescaperCapturedVideoProxySchedulerV27(
				environment, sessionController, proxyComposition,
			);
		},
		...presentation,
	});
	executeProductSequenceCommand = (command) => controller.actions.edit.commit(command);
	const selectedProxyComposition = proxyComposition;
	if (!selectedProxyComposition) throw new Error('The selected V27 editor did not compose its proxy runtime.');
	proxyActions = createFramescaperVideoProxyActionsV27({
		owner: controller,
		cleanup: environment.videoProxyCleanup,
		createScheduler: () => createFramescaperCapturedVideoProxySchedulerV27(
			environment, sessionController, selectedProxyComposition,
		),
		createAttachExistingScheduler: (candidate) => createFramescaperExistingVideoProxySchedulerV27(
			environment, sessionController, selectedProxyComposition, candidate,
		),
		createDetachCommand: createFramescaperVideoProxyDetachCommandV27,
		previewTrust: (sourceId, attachment) => {
			const entry = proxyTrust.get(sourceId);
			return entry !== undefined && entry.attachment === attachment
				? entry.status : 'unverified';
		},
	});
	bindFramescaperSelectedAuthoringControllerV27({
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
	bindFramescaperSelectedVisualPreviewControllerV27({
		controller,
		profile: environment.runtime.profile,
		store: environment.controllerStore,
	});
	bindFramescaperSelectedRenderSessionRuntimeV27(environment.runtime.profile, controller);
	return controller;
}

function snapshotPresentation(value: unknown): FramescaperAudioEditorControllerPresentationV27 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper V27 controller presentation must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !PRESENTATION_FIELDS.includes(
		key as (typeof PRESENTATION_FIELDS)[number],
	))) throw new TypeError('Framescaper V27 controller presentation contains unsupported authority.');
	const output: Record<string, unknown> = {};
	for (const key of PRESENTATION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper V27 presentation ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.locale !== undefined && typeof output.locale !== 'string') {
		throw new TypeError('Framescaper V27 controller locale must be a string.');
	}
	if (output.copy !== undefined && (!output.copy || typeof output.copy !== 'object' || Array.isArray(output.copy))) {
		throw new TypeError('Framescaper V27 controller copy must be an object.');
	}
	return output as FramescaperAudioEditorControllerPresentationV27;
}
