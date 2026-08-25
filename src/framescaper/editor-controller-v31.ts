/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createVideoRetimeProgramOrdinalBridge } from '../common/editor/video-retime-program-ordinal-bridge.ts';
import {
	assertFramescaperEditorProjectEnvironmentV31,
	type FramescaperEditorProjectEnvironmentV31,
} from './editor-project-environment-v31.ts';
import { createFramescaperMulticameraActionsV18 } from './editor-project-v18-multicam-actions.ts';
import { createFramescaperSequenceActionsV18 } from './editor-project-v18-sequence-actions.ts';
import { createFramescaperVideoRetimeActionsV20 } from './editor-project-v20-retime-actions.ts';
import type { FramescaperProjectCommandV31 } from './editor-project-v31-commands.ts';
import { createFramescaperScapeNativeRuntimeV31 } from './editor-scape-native-v31.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface FramescaperAudioEditorControllerPresentationV31 {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

/** Prepared F31 common controller; native route binders remain selected by the activation commit. */
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
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'framescaper',
		store: environment.controllerStore,
		sessionController: environment.runtime.createSessionController(),
		acquireProjectLock: environment.runtime.acquireProjectLock,
		projectRuntime: environment.runtime,
		playbackProjectService: environment.playback,
		createProjectIfAbsent: environment.createProjectIfAbsent,
		scapeProjectRuntime: createFramescaperScapeNativeRuntimeV31(environment.runtime.profile),
		productSequenceActions,
		createProductVideoRetimeProgramOrdinalBridge: createVideoRetimeProgramOrdinalBridge,
		...presentation,
	});
	executeProductSequenceCommand = (command) => controller.actions.edit.commit(command);
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
