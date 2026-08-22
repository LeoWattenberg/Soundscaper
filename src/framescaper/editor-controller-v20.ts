/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createFramescaperCapturedVideoProxySchedulerV20 } from './editor-captured-video-proxy-scheduler.ts';
import { bindFramescaperNativeRenderQueueActionV20 } from './editor-native-render-queue-action-v20.ts';
import {
	assertFramescaperEditorProjectEnvironmentV20,
	type FramescaperEditorProjectEnvironmentV20,
} from './editor-project-environment-v20.ts';
import { createFramescaperMulticameraActionsV18 } from './editor-project-v18-multicam-actions.ts';
import { createFramescaperSequenceActionsV18 } from './editor-project-v18-sequence-actions.ts';
import type { FramescaperProjectCommandV18 } from './editor-project-v18-subsequence.ts';
import { createFramescaperScapeNativeRuntimeV20 } from './editor-scape-native-v20.ts';
import { createFramescaperVideoExportStrategyV20 } from './video-export-strategy-v20.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface FramescaperAudioEditorControllerPresentationV20 {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

/** Bind the common controller to the selected exact-V20 browser authority. */
export function createFramescaperAudioEditorControllerV20(
	environmentValue: FramescaperEditorProjectEnvironmentV20 | unknown,
	presentationValue: FramescaperAudioEditorControllerPresentationV20 | unknown = {},
): ReturnType<typeof createAudioEditorController> {
	const environment = assertFramescaperEditorProjectEnvironmentV20(environmentValue);
	const presentation = snapshotPresentation(presentationValue);
	const scapeProjectRuntime = createFramescaperScapeNativeRuntimeV20(environment.runtime.profile);
	let executeProductSequenceCommand: ((command: unknown) => unknown) | null = null;
	const execute = (command: FramescaperProjectCommandV18): unknown => {
		if (!executeProductSequenceCommand) throw new Error('The Framescaper controller is not ready.');
		return executeProductSequenceCommand(command);
	};
	const productSequenceActions = Object.freeze({
		...createFramescaperSequenceActionsV18(execute),
		...createFramescaperMulticameraActionsV18(execute),
	});
	const sessionController = environment.runtime.createSessionController();
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'framescaper',
		framescaperCaptureRouteSchemaVersion: 20,
		store: environment.controllerStore,
		sessionController,
		acquireProjectLock: environment.runtime.acquireProjectLock,
		projectRuntime: environment.runtime,
		playbackProjectService: environment.playback,
		createProjectIfAbsent: environment.createProjectIfAbsent,
		scapeProjectRuntime,
		productSequenceActions,
		productVideoExportStrategy: createFramescaperVideoExportStrategyV20(environment.runtime.profile),
		createFramescaperCaptureProxyScheduler: (composition: Readonly<Record<string, unknown>>) => (
			createFramescaperCapturedVideoProxySchedulerV20(environment, sessionController, composition as never)
		),
		...presentation,
	});
	executeProductSequenceCommand = (command) => controller.actions.edit.commit(command);
	bindFramescaperNativeRenderQueueActionV20(environment.runtime.profile, controller);
	return controller;
}

function snapshotPresentation(value: unknown): FramescaperAudioEditorControllerPresentationV20 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V20 controller presentation must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Framescaper V20 controller presentation must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !PRESENTATION_FIELDS.includes(
		key as (typeof PRESENTATION_FIELDS)[number],
	))) {
		throw new TypeError('Framescaper V20 controller presentation contains an unsupported authority option.');
	}
	const output: Record<string, unknown> = {};
	for (const key of PRESENTATION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper V20 controller presentation ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.locale !== undefined && typeof output.locale !== 'string') {
		throw new TypeError('Framescaper V20 controller locale must be a string.');
	}
	if (output.copy !== undefined && (
		!output.copy || typeof output.copy !== 'object' || Array.isArray(output.copy)
	)) {
		throw new TypeError('Framescaper V20 controller copy must be an object.');
	}
	return output as FramescaperAudioEditorControllerPresentationV20;
}
