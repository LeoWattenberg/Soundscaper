/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController } from '../common/editor/app.js';
import { importSoundscaperAudacityProjectV29 } from './editor-audacity-project-import-v29.ts';
import {
	embedSoundscaperNativePluginStatesInAup4V29,
	recoverSoundscaperNativePluginStatesFromAup4V29,
	type SoundscaperAup4NativePluginStateStoreV29,
} from './editor-native-plugin-state-aup4-v29.ts';
import {
	createSoundscaperAudioFreezeActionsV21,
	type SoundscaperAudioFreezeActionBindingV21,
	type SoundscaperAudioFreezeActionsV21,
} from './editor-audio-track-freeze-actions-v21.ts';
import {
	createSoundscaperAutomationControllerBindingV21,
	type SoundscaperAutomationControllerActionsV21,
	type SoundscaperAutomationControllerBindingV21,
} from './editor-automation-controller-v21.ts';
import {
	assertSoundscaperEditorProjectEnvironmentV29,
	type SoundscaperEditorProjectEnvironmentV29,
} from './editor-project-environment-v29.ts';
import { validateSoundscaperProjectV29 } from './editor-project-v29-validation.ts';
import { createSoundscaperScapeNativeRuntimeV29 } from './editor-scape-native-v29.ts';
import {
	createSoundscaperNativePluginActionsV29,
	type SoundscaperNativePluginActionsV29,
} from './editor-native-plugin-actions-v29.ts';
import {
	quiesceNativePluginState,
	type NativePluginStateQuiescencePurpose,
} from '../common/editor/native-plugin-state-quiescence.ts';
import { createSoundscaperVideoExportStrategyV29 } from './video-export-strategy-v29.ts';

const PRESENTATION_FIELDS = ['locale', 'copy', 'fileService'] as const;

export interface SoundscaperAudioEditorControllerPresentationV29 {
	readonly locale?: string;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly fileService?: unknown;
}

type CommonAudioEditorController = ReturnType<typeof createAudioEditorController>;

export type SoundscaperAudioEditorControllerV29 = CommonAudioEditorController & Readonly<{
	readonly actions: CommonAudioEditorController['actions'] & Readonly<{
		readonly audioAutomation: Readonly<SoundscaperAutomationControllerActionsV21>;
		readonly audioFreeze: Readonly<SoundscaperAudioFreezeActionsV21>;
		readonly nativePlugins: Readonly<SoundscaperNativePluginActionsV29>;
	}>;
}>;

/** Bind the common editor implementation to exact V29 product authority. */
export function createSoundscaperAudioEditorControllerV29(
	environmentValue: SoundscaperEditorProjectEnvironmentV29 | unknown,
	presentationValue: SoundscaperAudioEditorControllerPresentationV29 | unknown = {},
): SoundscaperAudioEditorControllerV29 {
	const environment = assertSoundscaperEditorProjectEnvironmentV29(environmentValue);
	const presentation = snapshotPresentation(presentationValue);
	const scapeProjectRuntime = createSoundscaperScapeNativeRuntimeV29();
	const productVideoExportStrategy = createSoundscaperVideoExportStrategyV29(environment.runtime);
	const nativePluginStateStore = environment.controllerStore as unknown as
		SoundscaperAup4NativePluginStateStoreV29;
	let productController: SoundscaperAudioEditorControllerV29 | null = null;
	const quiesce = (purpose: NativePluginStateQuiescencePurpose): Promise<void> => {
		if (productController === null) {
			return Promise.reject(new Error('Soundscaper native plug-in state authority is not ready.'));
		}
		return quiesceNativePluginState(productController, purpose);
	};
	const delegate = createAudioEditorController(null, {
		headless: true,
		productId: 'soundscaper',
		store: environment.controllerStore,
		sessionController: environment.runtime.createSessionController(),
		acquireProjectLock: environment.runtime.acquireProjectLock,
		projectRuntime: environment.runtime,
		playbackProjectService: environment.playback,
		createProjectIfAbsent: environment.createProjectIfAbsent,
		adaptAudacityProject: async (value: unknown) => recoverSoundscaperNativePluginStatesFromAup4V29(
			importSoundscaperAudacityProjectV29(value),
			nativePluginStateStore,
		),
		prepareProjectSnapshot: (purpose: NativePluginStateQuiescencePurpose) => quiesce(purpose),
		prepareProjectForExport: (purpose: NativePluginStateQuiescencePurpose) => quiesce(purpose),
		prepareAudacityProjectExport: async (project: unknown) => {
			await quiesce('aup4-save');
			const current = productController?.project;
			if (!current || typeof current !== 'object'
				|| (current as { id?: unknown }).id !== (project as { id?: unknown } | null)?.id) {
				throw new Error('The active project changed during native plug-in state capture.');
			}
			return embedSoundscaperNativePluginStatesInAup4V29(current, nativePluginStateStore);
		},
		scapeProjectRuntime,
		...(productVideoExportStrategy ? { productVideoExportStrategy } : {}),
		...presentation,
	});
	const automation = createSoundscaperAutomationControllerBindingV21(delegate, {
		validateProject: validateSoundscaperProjectV29,
	});
	const freeze = createSoundscaperAudioFreezeActionsV21(environment, delegate, {
		validateProject: validateSoundscaperProjectV29,
		prepareProject: () => quiesce('track-freeze'),
	});
	productController = createControllerFacade(
		delegate, automation, freeze, createSoundscaperNativePluginActionsV29(delegate),
	);
	return productController;
}

function createControllerFacade(
	delegate: CommonAudioEditorController,
	automation: Readonly<SoundscaperAutomationControllerBindingV21>,
	freeze: Readonly<SoundscaperAudioFreezeActionBindingV21>,
	nativePlugins: Readonly<SoundscaperNativePluginActionsV29>,
): SoundscaperAudioEditorControllerV29 {
	const actions = decorateActions(delegate.actions, automation, freeze, nativePlugins);
	const descriptors = Object.getOwnPropertyDescriptors(delegate);
	const actionsDescriptor = descriptors.actions;
	const disposeDescriptor = descriptors.dispose;
	if (!actionsDescriptor || !Object.hasOwn(actionsDescriptor, 'value')
		|| !disposeDescriptor || !Object.hasOwn(disposeDescriptor, 'value')) {
		throw new TypeError('The common editor controller has unsupported action or disposal descriptors.');
	}
	let disposal: Promise<void> | null = null;
	descriptors.actions = { ...actionsDescriptor, value: actions };
	descriptors.dispose = {
		...disposeDescriptor,
		value: () => {
			disposal ??= disposeControllerBindings(delegate, automation, freeze);
			return disposal;
		},
	};
	return Object.freeze(Object.create(
		Object.getPrototypeOf(delegate),
		descriptors,
	)) as SoundscaperAudioEditorControllerV29;
}

function decorateActions(
	actionsValue: CommonAudioEditorController['actions'],
	automation: Readonly<SoundscaperAutomationControllerBindingV21>,
	freeze: Readonly<SoundscaperAudioFreezeActionBindingV21>,
	nativePlugins: Readonly<SoundscaperNativePluginActionsV29>,
): SoundscaperAudioEditorControllerV29['actions'] {
	const actions = actionRecord(actionsValue, 'common editor actions');
	const descriptors = Object.getOwnPropertyDescriptors(actions);
	descriptors.project = replacementDescriptor(
		descriptors.project,
		lifecycleActions(actions.project, [
			'create', 'open', 'openRecent', 'openById', 'close',
		], automation.actions.resetProject),
		'project actions',
	);
	descriptors.edit = replacementDescriptor(
		descriptors.edit,
		lifecycleActions(actions.edit, ['undo', 'redo'], automation.actions.resetProject),
		'edit actions',
	);
	descriptors.audioAutomation = immutableDataDescriptor(automation.actions);
	descriptors.audioFreeze = immutableDataDescriptor(freeze.actions);
	descriptors.nativePlugins = immutableDataDescriptor(nativePlugins);
	return Object.freeze(Object.create(
		Object.getPrototypeOf(actions),
		descriptors,
	)) as SoundscaperAudioEditorControllerV29['actions'];
}

function lifecycleActions(
	value: unknown,
	methodNames: readonly string[],
	reset: () => void,
): Readonly<Record<string, unknown>> {
	const actions = actionRecord(value, 'controller lifecycle actions');
	const descriptors = Object.getOwnPropertyDescriptors(actions);
	for (const name of methodNames) {
		const descriptor = descriptors[name];
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
			throw new TypeError(`The common editor controller requires lifecycle action ${name}.`);
		}
		const operation = descriptor.value as (...args: unknown[]) => unknown;
		descriptors[name] = {
			...descriptor,
			value: (...args: unknown[]) => {
				reset();
				return Reflect.apply(operation, actions, args);
			},
		};
	}
	return Object.freeze(Object.create(Object.getPrototypeOf(actions), descriptors));
}

async function disposeControllerBindings(
	delegate: CommonAudioEditorController,
	automation: Readonly<SoundscaperAutomationControllerBindingV21>,
	freeze: Readonly<SoundscaperAudioFreezeActionBindingV21>,
): Promise<void> {
	const failures: unknown[] = [];
	try { automation.dispose(); } catch (error) { failures.push(error); }
	try { await freeze.dispose(); } catch (error) { failures.push(error); }
	try { await delegate.dispose(); } catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) {
		throw new AggregateError(failures, 'Soundscaper V29 controller disposal failed.', {
			cause: failures[0],
		});
	}
}

function actionRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function replacementDescriptor(
	descriptor: PropertyDescriptor | undefined,
	value: unknown,
	name: string,
): PropertyDescriptor {
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`The common editor controller requires ${name}.`);
	}
	return { ...descriptor, value };
}

function immutableDataDescriptor(value: unknown): PropertyDescriptor {
	return { configurable: false, enumerable: true, writable: false, value };
}

function snapshotPresentation(value: unknown): SoundscaperAudioEditorControllerPresentationV29 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper V29 controller presentation must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Soundscaper V29 controller presentation must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !PRESENTATION_FIELDS.includes(
		key as (typeof PRESENTATION_FIELDS)[number],
	))) {
		throw new TypeError('Soundscaper V29 controller presentation contains an unsupported authority option.');
	}
	const output: Record<string, unknown> = {};
	for (const key of PRESENTATION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Soundscaper V29 controller presentation ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.locale !== undefined && typeof output.locale !== 'string') {
		throw new TypeError('Soundscaper V29 controller locale must be a string.');
	}
	if (output.copy !== undefined && (
		!output.copy || typeof output.copy !== 'object' || Array.isArray(output.copy)
	)) {
		throw new TypeError('Soundscaper V29 controller copy must be an object.');
	}
	return output as SoundscaperAudioEditorControllerPresentationV29;
}
