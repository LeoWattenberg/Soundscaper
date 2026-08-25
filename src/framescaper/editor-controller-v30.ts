/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createVideoRetimeProgramOrdinalBridge } from '../common/editor/video-retime-program-ordinal-bridge.ts';
import {
	assertFramescaperEditorProjectEnvironmentV30,
	type FramescaperEditorProjectEnvironmentV30,
} from './editor-project-environment-v30.ts';
import { createFramescaperMulticameraActionsV18 } from './editor-project-v18-multicam-actions.ts';
import { createFramescaperSequenceActionsV18 } from './editor-project-v18-sequence-actions.ts';
import { createFramescaperVideoRetimeActionsV20 } from './editor-project-v20-retime-actions.ts';
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
	const controller = createAudioEditorController(null, {
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
		...presentation,
	});
	executeProductSequenceCommand = (command) => controller.actions.edit.commit(command);
	bindFramescaperSelectedAuthoringControllerV30({
		controller,
		store: environment.controllerStore,
	});
	bindFramescaperSelectedImageAuthoringControllerV30({
		controller,
		session: sessionController,
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
