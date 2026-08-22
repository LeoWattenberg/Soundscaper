/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * One immutable, non-routed render session for dormant Framescaper candidates.
 * Plan creation and every picture consumer below share the same captured exact
 * project, timing, and transition authority.
 */

import {
	createUnifiedExactRenderClipExportFrameSource,
	createUnifiedExactRenderClipPreviewConsumer,
	createUnifiedExactRenderTransitionExportResolver,
	createUnifiedExactRenderTransitionPreviewResolver,
	type UnifiedExactRenderTransitionResolver,
} from '../common/editor/unified-exact-render-plan-consumers.ts';
import type { UnifiedExactRenderPlan } from '../common/editor/unified-exact-render-plan.ts';
import type { VideoRetimeFrameDescriptor } from '../common/editor/video-retime-frame-dispatch.ts';
import type {
	VideoRetimeExactExportFrameSource,
	VideoRetimeExactPreviewConsumer,
	VideoRetimePreviewMediaPort,
} from '../common/editor/video-retime-ordinal-consumers.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';
import {
	snapshotFramescaperUnifiedExactRenderAuthority,
	snapshotFramescaperUnifiedExactVisualRenderAuthority,
	type FramescaperUnifiedExactRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV22 } from './editor-project-unified-render-plan-v22.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV24 } from './editor-project-unified-render-plan-v24.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV25 } from './editor-project-unified-render-plan-v25.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV26 } from './editor-project-unified-render-plan-v26.ts';

export type FramescaperDormantRenderGeneration = 22 | 24 | 25 | 26;

export interface FramescaperDormantCandidateRenderSessionOptions {
	readonly generation: FramescaperDormantRenderGeneration;
	readonly profile: unknown;
	readonly project: unknown;
	readonly authority: unknown;
}

export interface FramescaperDormantCandidateRenderSession {
	readonly status: 'dormant-candidate-render-session';
	readonly generation: FramescaperDormantRenderGeneration;
	readonly plan: UnifiedExactRenderPlan;
	createClipExportFrameSource(clipId: string): VideoRetimeExactExportFrameSource;
	createClipPreviewConsumer(
		clipId: string,
		port: VideoRetimePreviewMediaPort,
		options: Readonly<{ readonly onPresented: (descriptor: VideoRetimeFrameDescriptor) => void }>,
	): VideoRetimeExactPreviewConsumer;
	createTransitionPreviewResolver(transitionId: string): UnifiedExactRenderTransitionResolver;
	createTransitionExportResolver(transitionId: string): UnifiedExactRenderTransitionResolver;
}

/** Capture a candidate render session without selecting or activating its route. */
export function createFramescaperDormantCandidateRenderSession(
	value: FramescaperDormantCandidateRenderSessionOptions,
): FramescaperDormantCandidateRenderSession {
	const options = sessionOptions(value);
	const captured = capturePlan(options);
	const timingBySourceId = bindExactTiming(options.project, captured.authority);
	return Object.freeze({
		status: 'dormant-candidate-render-session' as const,
		generation: options.generation,
		plan: captured.plan,
		createClipExportFrameSource: (clipId: string) => (
			createUnifiedExactRenderClipExportFrameSource(captured.plan, clipId, timingBySourceId)
		),
		createClipPreviewConsumer: (
			clipId: string,
			port: VideoRetimePreviewMediaPort,
			consumerOptions: Readonly<{
				readonly onPresented: (descriptor: VideoRetimeFrameDescriptor) => void;
			}>,
		) => createUnifiedExactRenderClipPreviewConsumer(
			captured.plan, clipId, timingBySourceId, port, consumerOptions,
		),
		createTransitionPreviewResolver: (transitionId: string) => (
			createUnifiedExactRenderTransitionPreviewResolver(captured.plan, transitionId, timingBySourceId)
		),
		createTransitionExportResolver: (transitionId: string) => (
			createUnifiedExactRenderTransitionExportResolver(captured.plan, transitionId, timingBySourceId)
		),
	});
}

function capturePlan(options: FramescaperDormantCandidateRenderSessionOptions): Readonly<{
	readonly plan: UnifiedExactRenderPlan;
	readonly authority: FramescaperUnifiedExactRenderAuthority;
}> {
	if (options.generation === 22) {
		const authority = snapshotFramescaperUnifiedExactRenderAuthority(options.authority);
		return Object.freeze({
			authority,
			plan: createFramescaperProjectUnifiedExactRenderPlanV22(
				options.profile, options.project, authority,
			),
		});
	}
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(options.authority);
	if (options.generation === 24) return Object.freeze({
		authority,
		plan: createFramescaperProjectUnifiedExactRenderPlanV24(
			options.profile, options.project, authority,
		),
	});
	if (options.generation === 25) return Object.freeze({
		authority,
		plan: createFramescaperProjectUnifiedExactRenderPlanV25(
			options.profile, options.project, authority,
		),
	});
	return Object.freeze({
		authority,
		plan: createFramescaperProjectUnifiedExactRenderPlanV26(
			options.profile, options.project, authority,
		),
	});
}

function bindExactTiming(
	projectValue: unknown,
	authority: FramescaperUnifiedExactRenderAuthority,
): ReadonlyMap<string, BoundVideoSourceTimingView> {
	if (!projectValue || typeof projectValue !== 'object' || Array.isArray(projectValue)) {
		throw new TypeError('A dormant render session requires one exact candidate project.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(projectValue, 'sources');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !Array.isArray(descriptor.value)) {
		throw new TypeError('A dormant render session requires an own project source collection.');
	}
	const result = new Map<string, BoundVideoSourceTimingView>();
	for (const source of descriptor.value as unknown[]) {
		if (!source || typeof source !== 'object' || Array.isArray(source)) {
			throw new TypeError('A dormant render session encountered an invalid project source.');
		}
		const kind = ownData(source, 'kind');
		if (kind !== 'video') continue;
		const sourceId = ownData(source, 'id');
		if (typeof sourceId !== 'string' || sourceId.length === 0 || result.has(sourceId)) {
			throw new TypeError('A dormant render session requires unique video source identities.');
		}
		result.set(sourceId, bindVideoSourceTimingView(authority.timingViews, source));
	}
	return result;
}

function sessionOptions(value: unknown): FramescaperDormantCandidateRenderSessionOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Dormant candidate render-session options must be a closed plain record.');
	}
	const fields = ['generation', 'profile', 'project', 'authority'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Dormant candidate render-session options have an invalid closed shape.');
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Dormant candidate render-session ${field} must be an own data property.`);
		}
	}
	const options = value as FramescaperDormantCandidateRenderSessionOptions;
	if (![22, 24, 25, 26].includes(options.generation)) {
		throw new RangeError('Dormant candidate render-session generation must be V22, V24, V25, or V26.');
	}
	return options;
}

function ownData(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Dormant candidate source.${key} must be an own data property.`);
	}
	return descriptor.value;
}
