/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { createFramescaperCapturedVideoProxySchedulerV18 } from './editor-captured-video-proxy-scheduler.ts';
import {
	assertFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from './editor-project-environment-v18.ts';
import {
	createFramescaperProjectMaintenanceRuntimeV18,
} from './editor-project-v18-maintenance-runtime.ts';
import { createFramescaperMulticameraActionsV18 } from './editor-project-v18-multicam-actions.ts';
import { createFramescaperSequenceActionsV18 } from './editor-project-v18-sequence-actions.ts';
import type { FramescaperProjectCommandV18 } from './editor-project-v18-subsequence.ts';
import { createFramescaperScapeNativeRuntimeV18 } from './editor-scape-native-v18.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface FramescaperAudioEditorControllerPresentationV18 {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

/**
 * The maintained controller boundary accepts presentation only. Every project,
 * store, session, lock, playback, and create-only authority comes from the one
 * already-authenticated product environment.
 */
export function createFramescaperAudioEditorControllerV18(
	environmentValue: FramescaperEditorProjectEnvironmentV18 | unknown,
	presentationValue: FramescaperAudioEditorControllerPresentationV18 | unknown = {},
): ReturnType<typeof createAudioEditorController> {
	const environment = assertFramescaperEditorProjectEnvironmentV18(environmentValue);
	const presentation = snapshotPresentation(presentationValue);
	const maintenance = createFramescaperProjectMaintenanceRuntimeV18(environment);
	const scapeProjectRuntime = createFramescaperScapeNativeRuntimeV18(
		environment.runtime.profile,
		environment.scapeProjectFile,
	);
	let executeProductSequenceCommand: ((command: unknown) => unknown) | null = null;
	const execute = (command: FramescaperProjectCommandV18): unknown => {
		if (!executeProductSequenceCommand) throw new Error('The Framescaper controller is not ready.');
		return executeProductSequenceCommand(command);
	};
	const productSequenceActions = Object.freeze({
		...createFramescaperSequenceActionsV18(execute),
		...createFramescaperMulticameraActionsV18(execute),
	});
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'framescaper',
		framescaperCaptureRouteSchemaVersion: 18,
		store: environment.controllerStore,
		sessionController: maintenance.sessionController,
		acquireProjectLock: environment.runtime.acquireProjectLock,
		projectRuntime: environment.runtime,
		playbackProjectService: environment.playback,
		createProjectIfAbsent: environment.createProjectIfAbsent,
		projectMaintenanceRuntime: maintenance,
		scapeProjectRuntime,
		productSequenceActions,
		createFramescaperCaptureProxyScheduler: (composition: Readonly<Record<string, unknown>>) => (
			createFramescaperCapturedVideoProxySchedulerV18(
				environment,
				maintenance.sessionController,
				composition as never,
			)
		),
		...presentation,
	});
	executeProductSequenceCommand = (command) => controller.actions.edit.commit(command);
	return controller;
}

function snapshotPresentation(value: unknown): FramescaperAudioEditorControllerPresentationV18 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V18 controller presentation must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Framescaper V18 controller presentation must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !PRESENTATION_FIELDS.includes(
		key as (typeof PRESENTATION_FIELDS)[number],
	))) {
		throw new TypeError('Framescaper V18 controller presentation contains an unsupported authority option.');
	}
	const output: Record<string, unknown> = {};
	for (const key of PRESENTATION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper V18 controller presentation ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.locale !== undefined && typeof output.locale !== 'string') {
		throw new TypeError('Framescaper V18 controller locale must be a string.');
	}
	if (output.copy !== undefined && (
		!output.copy || typeof output.copy !== 'object' || Array.isArray(output.copy)
	)) {
		throw new TypeError('Framescaper V18 controller copy must be an object.');
	}
	return output as FramescaperAudioEditorControllerPresentationV18;
}
