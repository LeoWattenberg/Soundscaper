/* SPDX-License-Identifier: AGPL-3.0-only */

import { FramescaperNativeServicesController } from './native-services-controller.ts';
import {
	registerFramescaperExternalDisplayFramePort,
	type FramescaperExternalDisplayFramePortRegistration,
} from './external-display-frame-port.ts';
import type {
	FramescaperNativeWatchImportBroker,
} from './native-services-watch-import-broker.ts';
import type {
	FramescaperNativeImageSequenceSelectionBroker,
} from './native-image-sequence-selection.ts';
import { framescaperNativeQueueEnqueueRequest } from './native-services-lifecycle.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS,
	registerFramescaperNativeRenderInputMainIpc,
} from './native-services-render-input-main-ipc.ts';
import type { FramescaperNativeRenderInputStaging } from './native-services-render-input-staging.ts';

export const FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS = Object.freeze({
	capabilities: 'framescaper:v1:native-services:capabilities',
	snapshot: 'framescaper:v1:native-services:snapshot',
	control: 'framescaper:v1:native-services:queue:control',
	reorder: 'framescaper:v1:native-services:queue:reorder',
	remove: 'framescaper:v1:native-services:queue:remove',
	enqueue: 'framescaper:v1:native-services:queue:enqueue',
	selectRoot: 'framescaper:v1:native-services:root:select',
	revalidateRoot: 'framescaper:v1:native-services:root:revalidate',
	revokeRoot: 'framescaper:v1:native-services:root:revoke',
	createWatch: 'framescaper:v1:native-services:watch:create',
	setWatchEnabled: 'framescaper:v1:native-services:watch:enabled',
	removeWatch: 'framescaper:v1:native-services:watch:remove',
	reconcileWatch: 'framescaper:v1:native-services:watch:reconcile',
	claimWatchImport: 'framescaper:v1:native-services:watch:claim',
	completeWatchImport: 'framescaper:v1:native-services:watch:complete',
	cleanupScratch: 'framescaper:v1:native-services:scratch:cleanup',
	settleScratch: 'framescaper:v1:native-services:scratch:settle',
	publish: 'framescaper:v1:native-services:publication:publish',
	checkpoint: 'framescaper:v1:native-services:publication:checkpoint',
	externalDisplays: 'framescaper:v1:native-services:display:list',
	setExternalDisplay: 'framescaper:v1:native-services:display:set',
	preferences: 'framescaper:v1:native-services:preferences',
	setPreference: 'framescaper:v1:native-services:preferences:set',
	selectImageSequence: 'framescaper:v1:native-services:image-sequence:select',
	readImageSequenceFile: 'framescaper:v1:native-services:image-sequence:read',
	releaseImageSequence: 'framescaper:v1:native-services:image-sequence:release',
	renderInputBegin: FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.begin,
	renderInputPort: FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.port,
	renderInputFinalize: FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.finalize,
	renderInputAbandon: FRAMESCAPER_NATIVE_RENDER_INPUT_MAIN_CHANNELS.abandon,
} as const);

type Handler = (
	event: unknown,
	value?: unknown,
	authorization?: boolean | object,
) => Promise<unknown> | unknown;

export interface FramescaperNativeServicesMainIpcOptions {
	readonly handle: (channel: string, handler: Handler) => void;
	readonly removeHandler: (channel: string) => void;
	readonly on?: (channel: string, listener: (event: unknown, value?: unknown) => void) => void;
	readonly removeListener?: (channel: string, listener: (event: unknown, value?: unknown) => void) => void;
	/** Connect this to the selected desktop generation's authenticated owner. */
	readonly authorizeOwner: (event: unknown) => boolean | object;
	readonly controller: FramescaperNativeServicesController;
	readonly renderInputs?: Pick<
		FramescaperNativeRenderInputStaging,
		'begin' | 'receive' | 'finalize' | 'abandon' | 'claim' | 'rollbackClaim'
	>;
	readonly watchImports?: Pick<FramescaperNativeWatchImportBroker, 'claim' | 'complete'>;
	readonly imageSequenceSelections?: Pick<
		FramescaperNativeImageSequenceSelectionBroker,
		'select' | 'read' | 'release'
	>;
}

export interface FramescaperNativeServicesMainIpcRegistration {
	readonly dispose: () => void;
}

export function registerFramescaperNativeServicesMainIpc(
	value: unknown,
): FramescaperNativeServicesMainIpcRegistration {
	const hasPortSeams = Boolean(value && typeof value === 'object'
		&& (Object.hasOwn(value, 'on') || Object.hasOwn(value, 'removeListener')));
	const hasWatchImports = Boolean(value && typeof value === 'object' && Object.hasOwn(value, 'watchImports'));
	const hasImageSequenceSelections = Boolean(value && typeof value === 'object'
		&& Object.hasOwn(value, 'imageSequenceSelections'));
	const hasRenderInputs = Boolean(value && typeof value === 'object' && Object.hasOwn(value, 'renderInputs'));
	const fields = ['handle', 'removeHandler', 'authorizeOwner', 'controller',
		...(hasPortSeams ? ['on', 'removeListener'] : []),
		...(hasWatchImports ? ['watchImports'] : []),
		...(hasImageSequenceSelections ? ['imageSequenceSelections'] : []),
		...(hasRenderInputs ? ['renderInputs'] : []),
	] as const;
	const options = closedRecord(
		value, fields,
		'Framescaper native-services main IPC options',
	);
	if (typeof options.handle !== 'function' || typeof options.removeHandler !== 'function'
		|| typeof options.authorizeOwner !== 'function'
		|| !(options.controller instanceof FramescaperNativeServicesController)) {
		throw new TypeError('Framescaper native-services IPC requires exact main-owned seams.');
	}
	const handle = options.handle as FramescaperNativeServicesMainIpcOptions['handle'];
	const removeHandler = options.removeHandler as FramescaperNativeServicesMainIpcOptions['removeHandler'];
	const authorizeOwner = options.authorizeOwner as FramescaperNativeServicesMainIpcOptions['authorizeOwner'];
	const controller = options.controller;
	if (hasPortSeams && (typeof options.on !== 'function' || typeof options.removeListener !== 'function')) {
		throw new TypeError('Framescaper native-services IPC requires both MessagePort listener seams.');
	}
	const watchImports = hasWatchImports ? options.watchImports as Record<string, unknown> : null;
	if (watchImports && (typeof watchImports.claim !== 'function' || typeof watchImports.complete !== 'function'
		|| Reflect.ownKeys(watchImports).length !== 2)) {
		throw new TypeError('Framescaper native-services IPC requires an exact watch-import broker.');
	}
	const imageSequenceSelections = hasImageSequenceSelections
		? options.imageSequenceSelections as Record<string, unknown> : null;
	if (imageSequenceSelections && (typeof imageSequenceSelections.select !== 'function'
		|| typeof imageSequenceSelections.read !== 'function'
		|| typeof imageSequenceSelections.release !== 'function'
		|| Reflect.ownKeys(imageSequenceSelections).length !== 3)) {
		throw new TypeError('Framescaper native-services IPC requires an exact image-sequence selection broker.');
	}
	const renderInputs = hasRenderInputs
		? options.renderInputs as FramescaperNativeServicesMainIpcOptions['renderInputs'] : null;
	if (renderInputs && (!hasPortSeams || ['begin', 'receive', 'finalize', 'claim', 'rollbackClaim']
		.some((method) => typeof renderInputs[method as keyof typeof renderInputs] !== 'function'))) {
		throw new TypeError('Framescaper native-services IPC requires exact render-input staging and port seams.');
	}
	const registered: string[] = [];
	let framePort: FramescaperExternalDisplayFramePortRegistration | null = null;
	let renderInputPort: FramescaperNativeServicesMainIpcRegistration | null = null;
	let disposed = false;
	const authorize = (event: unknown): boolean | object => {
		if (disposed) throw new Error('Framescaper native-services IPC is disposed.');
		const authorization = authorizeOwner(event);
		if (!authorization) throw new Error('The Framescaper renderer is not authorized for native services.');
		return authorization;
	};
	const register = (channel: string, handler: Handler): void => {
		handle(channel, (event, request) => {
			const authorization = authorize(event);
			return handler(event, request, authorization);
		});
		registered.push(channel);
	};
	try {
		if (hasPortSeams) {
			framePort = registerFramescaperExternalDisplayFramePort({
				on: options.on as NonNullable<FramescaperNativeServicesMainIpcOptions['on']>,
				removeListener: options.removeListener as NonNullable<FramescaperNativeServicesMainIpcOptions['removeListener']>,
				authorizeOwner: (event) => Boolean(authorizeOwner(event)),
				controller,
			});
			if (renderInputs) renderInputPort = registerFramescaperNativeRenderInputMainIpc({
				handle, removeHandler,
				on: options.on as NonNullable<FramescaperNativeServicesMainIpcOptions['on']>,
				removeListener: options.removeListener as NonNullable<FramescaperNativeServicesMainIpcOptions['removeListener']>,
				authorizeOwner, staging: renderInputs,
			});
		}
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.capabilities, () => controller.capabilities());
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.snapshot, () => controller.snapshot());
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.control, (_event, request) => controller.control(request));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.reorder, (_event, request) => controller.reorder(request));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.remove, (_event, request) => controller.remove(request));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.enqueue, async (_event, value, authorization) => {
			const request = framescaperNativeQueueEnqueueRequest(value);
			controller.authorizeQueueEnqueue(request);
			if (request.planVersion !== 7) return controller.enqueue(request);
			if (!renderInputs) throw new Error('Durable V7 render-input staging is unavailable.');
			const owner = requiredOwner(authorization);
			await renderInputs.claim(owner, request);
			try { return controller.enqueue(request); }
			catch (error) {
				await renderInputs.rollbackClaim(owner, { stageId: request.derivedInputStageId });
				throw error;
			}
		});
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.selectRoot, () => controller.selectRoot());
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.revalidateRoot, (_event, request) => (
			controller.revalidateRoot(request)
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.revokeRoot, (_event, request) => (
			controller.revokeRoot(request)
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.createWatch, (_event, request) => (
			controller.createWatch(request)
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.setWatchEnabled, (_event, request) => (
			controller.setWatchEnabled(request)
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.removeWatch, (_event, request) => (
			controller.removeWatch(request)
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.reconcileWatch, () => (
			controller.reconcileWatch()
		));
		if (watchImports) {
			register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.claimWatchImport, (_event, request, authorization) => {
				controller.authorizeWatchProject(projectIdFromRequest(request));
				const owner = requiredOwner(authorization);
				return Reflect.apply(watchImports.claim as (...args: unknown[]) => unknown, watchImports, [owner, request]);
			});
			register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.completeWatchImport, (_event, request, authorization) => {
				const owner = requiredOwner(authorization);
				return Reflect.apply(watchImports.complete as (...args: unknown[]) => unknown, watchImports, [owner, request]);
			});
		}
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.cleanupScratch, () => (
			controller.cleanupScratch()
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.settleScratch, (_event, request) => (
			controller.settleScratch(request)
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.publish, (_event, request) => (
			controller.publish(request)
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.checkpoint, (_event, request) => (
			controller.checkpoint(request)
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.externalDisplays, () => (
			controller.externalDisplays()
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.setExternalDisplay, (_event, request) => (
			controller.setExternalDisplay(request)
		));
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.preferences, () => controller.preferences());
		register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.setPreference, (_event, request) => (
			controller.setPreference(request)
		));
		if (imageSequenceSelections) {
			register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.selectImageSequence,
				(_event, request, authorization) => {
					controller.authorizeImageSequenceSelection();
					return Reflect.apply(
						imageSequenceSelections.select as (...args: unknown[]) => unknown,
						imageSequenceSelections,
						[requiredOwner(authorization), request],
					);
				});
			register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.readImageSequenceFile,
				(_event, request, authorization) => {
					controller.authorizeImageSequenceSelection();
					return Reflect.apply(
						imageSequenceSelections.read as (...args: unknown[]) => unknown,
						imageSequenceSelections,
						[requiredOwner(authorization), request],
					);
				});
			register(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.releaseImageSequence,
				(_event, request, authorization) => Reflect.apply(
					imageSequenceSelections.release as (...args: unknown[]) => unknown,
					imageSequenceSelections,
					[requiredOwner(authorization), request],
				));
		}
	} catch (error) {
		renderInputPort?.dispose();
		framePort?.dispose();
		for (const channel of registered.reverse()) removeHandler(channel);
		throw error;
	}
	return Object.freeze({
		dispose: () => {
			if (disposed) return;
			disposed = true;
			renderInputPort?.dispose();
			renderInputPort = null;
			framePort?.dispose();
			framePort = null;
			for (const channel of registered.splice(0).reverse()) removeHandler(channel);
		},
	});
}

function requiredOwner(value: boolean | object | undefined): object {
	if (typeof value !== 'object' || value === null) {
		throw new Error('Native services require the exact renderer save owner.');
	}
	return value;
}

function projectIdFromRequest(value: unknown): unknown {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>).projectId : null;
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<Field, unknown>>;
}
