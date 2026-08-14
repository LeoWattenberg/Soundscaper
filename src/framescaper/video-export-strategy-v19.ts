/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../common/editor/track-folder-media-runtime.ts';
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/product-video-export-strategy.ts';
import { createFramescaperPlaybackProjectServiceV19 } from './editor-project-playback-v19.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import {
	validateFramescaperProjectV19,
	type FramescaperProjectV19,
} from './editor-project-v19-validation.ts';

/**
 * Bind exact V19 authoring authority to the legacy V17 delivery engine.
 *
 * V19 does not own a keyed encoder. It does own the clean-break projection:
 * the selected V19 runtime clone function must never be asked to clone the
 * transient V17 playback document used by the maintained legacy exporter.
 */
export function createFramescaperVideoExportStrategyV19(
	profile: unknown,
): ProductVideoExportStrategy {
	assertFramescaperProjectV19Profile(profile);
	const playback = createFramescaperPlaybackProjectServiceV19(profile);
	const authorities = new WeakMap<object, Readonly<Record<string, unknown>>>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const canonicalProject = request.canonicalProject as FramescaperProjectV19;
			validateFramescaperProjectV19(profile, canonicalProject);
			const delivery = playback.projectForVideoRenderedFallbackDelivery?.(canonicalProject);
			if (!delivery) throw new Error('Framescaper V19 video delivery projection is unavailable.');
			assertSameData(request.delivery, delivery, 'Framescaper V19 video delivery');
			const exportProject = detachedExportProject(delivery.project);
			authorities.set(exportProject, request.canonicalProject);
			return exportProject;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			if (authorities.get(request.exportProject) !== request.canonicalProject) {
				throw new TypeError('The V19 export projection is not owned by its exact canonical project.');
			}
			validateFramescaperProjectV19(profile, request.canonicalProject);
			const delivery = playback.projectForVideoRenderedFallbackDelivery?.(
				request.canonicalProject as FramescaperProjectV19,
			);
			if (!delivery) throw new Error('Framescaper V19 video delivery projection is unavailable.');
			assertSameData(
				request.exportProject,
				detachedExportProject(delivery.project),
				'Framescaper V19 export projection',
			);
			return null;
		},
		encode(_request: ProductVideoExportStrategyEncodeRequest): Promise<ProductVideoExportEncodedOutput> {
			return Promise.reject(new Error('Framescaper V19 video export uses the maintained legacy encoder.'));
		},
		encodeToSink<Output>(
			_request: ProductVideoExportStrategyEncodeRequest,
			_sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			return Promise.reject(new Error('Framescaper V19 video export uses the maintained legacy encoder.'));
		},
	});
}

function detachedExportProject(
	project: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const mediaProjection = projectTrackFolderMediaStateV12(project);
	const clone = structuredClone(mediaProjection);
	const trusted = inheritTrackFolderMediaStateProjectionV12(mediaProjection, clone);
	return freezeDataGraph(trusted, 'Framescaper V19 export projection');
}

function freezeDataGraph<Value extends object>(value: Value, name: string): Value {
	const pending: object[] = [value];
	const seen = new WeakSet<object>();
	const order: object[] = [];
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (seen.has(current)) continue;
		seen.add(current);
		order.push(current);
		if (order.length > 2_000_000) throw new RangeError(`${name} exceeds its freeze budget.`);
		for (const key of Reflect.ownKeys(current)) {
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`${name} must contain only data properties.`);
			}
			const child = descriptor.value;
			if (child && typeof child === 'object') pending.push(child as object);
		}
	}
	for (let index = order.length - 1; index >= 0; index -= 1) Object.freeze(order[index]);
	return value;
}

function assertSameData(left: unknown, right: unknown, name: string): void {
	const pending: Array<readonly [unknown, unknown]> = [[left, right]];
	const paired = new WeakMap<object, object>();
	let nodeCount = 0;
	while (pending.length > 0) {
		const [leftValue, rightValue] = pending.pop()!;
		if (Object.is(leftValue, rightValue)) continue;
		if (!leftValue || typeof leftValue !== 'object'
			|| !rightValue || typeof rightValue !== 'object') {
			throw new Error(`${name} diverges from its exact canonical project.`);
		}
		const leftObject = leftValue as object;
		const rightObject = rightValue as object;
		const prior = paired.get(leftObject);
		if (prior) {
			if (prior !== rightObject) throw new Error(`${name} has divergent object aliases.`);
			continue;
		}
		paired.set(leftObject, rightObject);
		nodeCount += 1;
		if (nodeCount > 2_000_000) throw new RangeError(`${name} exceeds its comparison budget.`);
		if (Array.isArray(leftObject) !== Array.isArray(rightObject)) {
			throw new Error(`${name} diverges from its exact canonical project.`);
		}
		const leftKeys = Reflect.ownKeys(leftObject);
		const rightKeys = Reflect.ownKeys(rightObject);
		if (leftKeys.length !== rightKeys.length
			|| leftKeys.some((key, index) => key !== rightKeys[index])) {
			throw new Error(`${name} diverges from its exact canonical project.`);
		}
		for (const key of leftKeys) {
			const leftDescriptor = Object.getOwnPropertyDescriptor(leftObject, key);
			const rightDescriptor = Object.getOwnPropertyDescriptor(rightObject, key);
			if (!leftDescriptor || !rightDescriptor
				|| !Object.hasOwn(leftDescriptor, 'value')
				|| !Object.hasOwn(rightDescriptor, 'value')
				|| leftDescriptor.enumerable !== rightDescriptor.enumerable) {
				throw new TypeError(`${name} must contain matching data properties.`);
			}
			pending.push([leftDescriptor.value, rightDescriptor.value]);
		}
	}
}
