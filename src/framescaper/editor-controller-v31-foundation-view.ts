/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductNativeRenderInputOperation } from '../common/editor/controller/product-native-render-input-authority.ts';
import type { ProductNativeRenderInputAuthorityBinding } from '../common/editor/controller/product-native-render-input-authority.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

export interface FramescaperControllerFoundationViewV31 {
	readonly project: unknown;
	readonly actions: Readonly<Record<string, unknown>>;
	readonly getSnapshot: () => Readonly<Record<string, unknown>>;
	readonly getTelemetrySnapshot: () => Readonly<Record<string, unknown>>;
	readonly prepareNativeRenderInputStreamV28?: (request: unknown) => Promise<unknown>;
}

/** Give exact-V28 helpers a detached view while their commits still target F31. */
export function createFramescaperControllerFoundationViewV31(
	controllerValue: unknown,
	prepareNativeRenderInputStreamV28?: (request: unknown) => Promise<unknown>,
): Readonly<FramescaperControllerFoundationViewV31> {
	const controller = controllerRecord(controllerValue);
	const actions = data(controller, 'actions', 'F31 controller actions');
	const getSnapshot = operation(controller, 'getSnapshot');
	const getTelemetrySnapshot = operation(controller, 'getTelemetrySnapshot');
	return Object.freeze({
		get project(): unknown {
			return framescaperProjectV28FoundationShapeV31(data(controller, 'project', 'F31 controller project'));
		},
		actions: actions as Readonly<Record<string, unknown>>,
		getSnapshot: () => getSnapshot.call(controller) as Readonly<Record<string, unknown>>,
		getTelemetrySnapshot: () => getTelemetrySnapshot.call(controller) as Readonly<Record<string, unknown>>,
		...(prepareNativeRenderInputStreamV28 ? { prepareNativeRenderInputStreamV28 } : {}),
	});
}

/** Project every controller-owned render lease before exact-V28 planning. */
export function adaptFramescaperNativeRenderInputAuthorityV31(
	authority: ProductNativeRenderInputAuthorityBinding,
): ProductNativeRenderInputAuthorityBinding {
	if (!authority || typeof authority.begin !== 'function') {
		throw new TypeError('F31 native render input requires its controller-owned authority.');
	}
	return Object.freeze({
		begin(): ProductNativeRenderInputOperation {
			return projectOperation(authority.begin());
		},
	});
}

function projectOperation(operation: ProductNativeRenderInputOperation): ProductNativeRenderInputOperation {
	const foundation = framescaperProjectV28FoundationShapeV31(operation.project);
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

function controllerRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An F31 common controller is required.');
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
	const candidate = data(value, field, `F31 controller ${field}`);
	if (typeof candidate !== 'function') throw new TypeError(`F31 controller ${field} must be a function.`);
	return candidate as (...args: unknown[]) => Awaitable<unknown>;
}
