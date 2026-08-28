/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductNativeRenderInputOperation } from '../common/editor/controller/product-native-render-input-authority.ts';
import type { ProductNativeRenderInputAuthorityBinding } from '../common/editor/controller/product-native-render-input-authority.ts';
import { framescaperProjectNativeMediaFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

export interface FramescaperControllerFoundationViewAssistance {
	readonly project: unknown;
	readonly actions: Readonly<Record<string, unknown>>;
	readonly getSnapshot: () => Readonly<Record<string, unknown>>;
	readonly getTelemetrySnapshot: () => Readonly<Record<string, unknown>>;
	readonly prepareNativeRenderInputStreamNativeMedia?: (request: unknown) => Promise<unknown>;
}

/** Give exact-nativeMedia helpers a detached view while their commits still target assistance. */
export function createFramescaperControllerFoundationViewAssistance(
	controllerValue: unknown,
	prepareNativeRenderInputStreamNativeMedia?: (request: unknown) => Promise<unknown>,
): Readonly<FramescaperControllerFoundationViewAssistance> {
	const controller = controllerRecord(controllerValue);
	const actions = data(controller, 'actions', 'assistance controller actions');
	const getSnapshot = operation(controller, 'getSnapshot');
	const getTelemetrySnapshot = operation(controller, 'getTelemetrySnapshot');
	return Object.freeze({
		get project(): unknown {
			return framescaperProjectNativeMediaFoundationShapeAssistance(foundationInput(
				data(controller, 'project', 'Framescaper controller project'),
			));
		},
		actions: actions as Readonly<Record<string, unknown>>,
		getSnapshot: () => getSnapshot.call(controller) as Readonly<Record<string, unknown>>,
		getTelemetrySnapshot: () => getTelemetrySnapshot.call(controller) as Readonly<Record<string, unknown>>,
		...(prepareNativeRenderInputStreamNativeMedia ? { prepareNativeRenderInputStreamNativeMedia } : {}),
	});
}

/** Project every controller-owned render lease before exact-nativeMedia planning. */
export function adaptFramescaperNativeRenderInputAuthorityAssistance(
	authority: ProductNativeRenderInputAuthorityBinding,
): ProductNativeRenderInputAuthorityBinding {
	if (!authority || typeof authority.begin !== 'function') {
		throw new TypeError('assistance native render input requires its controller-owned authority.');
	}
	return Object.freeze({
		begin(): ProductNativeRenderInputOperation {
			return projectOperation(authority.begin());
		},
	});
}

function projectOperation(operation: ProductNativeRenderInputOperation): ProductNativeRenderInputOperation {
	const foundation = framescaperProjectNativeMediaFoundationShapeAssistance(foundationInput(operation.project));
	return Object.freeze({
		project: foundation,
		signal: operation.signal,
		assertCurrent: () => operation.assertCurrent(),
		renderAudio: (project: Readonly<Record<string, unknown>>, range: Readonly<Record<string, unknown>>) => (
			operation.renderAudio(project, range)
		),
		...(operation.renderAudioToSink ? {
			renderAudioToSink: (
				project: Readonly<Record<string, unknown>>,
				range: Readonly<Record<string, unknown>>,
				sink: Parameters<NonNullable<ProductNativeRenderInputOperation['renderAudioToSink']>>[2],
			) => operation.renderAudioToSink!(project, range, sink),
		} : {}),
		finish: () => operation.finish(),
	});
}

function foundationInput(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	const family = Object.getOwnPropertyDescriptor(value, 'schemaFamily');
	return family?.enumerable && Object.hasOwn(family, 'value') && family.value === 'framescaper'
		? value
		: value;
}

function controllerRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An assistance common controller is required.');
	}
	return value as Record<string, unknown>;
}

function data(value: object, field: string, label: string): unknown {
	let owner: object | null = value;
	while (owner) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, field);
		if (descriptor) {
			if (Object.hasOwn(descriptor, 'value')) return descriptor.value;
			if (typeof descriptor.get === 'function') return descriptor.get.call(value) as unknown;
			break;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError(`${label} is unavailable.`);
}

function operation(value: object, field: string): (...args: unknown[]) => Awaitable<unknown> {
	const candidate = data(value, field, `assistance controller ${field}`);
	if (typeof candidate !== 'function') throw new TypeError(`assistance controller ${field} must be a function.`);
	return candidate as (...args: unknown[]) => Awaitable<unknown>;
}
