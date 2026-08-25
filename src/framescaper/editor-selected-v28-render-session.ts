/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createUnifiedExactRenderClipExportFrameSource,
	createUnifiedExactRenderClipPreviewConsumer,
	createUnifiedExactRenderTransitionExportResolver,
	createUnifiedExactRenderTransitionPreviewResolver,
	type UnifiedExactRenderTransitionResolver,
} from '../common/editor/unified-exact-render-plan-consumers.ts';
import type {
	UnifiedExactRenderFinishingConsumerV14,
} from '../common/editor/unified-exact-render-finishing-consumers-v14.ts';
import type {
	VideoMotionAnalysisRequestV1,
	VideoMotionAnalysisResultV1,
} from '../common/editor/video-motion-analysis-v27.ts';
import type {
	DisposableVideoMotionWebGl2AcceleratorV1,
} from '../common/editor/video-motion-webgl2-v27.ts';
import type { UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
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
	snapshotFramescaperUnifiedExactVisualRenderAuthority,
	type FramescaperUnifiedExactVisualRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from './editor-project-unified-render-plan-v28.ts';

export interface FramescaperSelectedRenderSessionOptionsV28 {
	readonly profile: unknown;
	readonly project: unknown;
	readonly authority: unknown;
}

export interface FramescaperSelectedRenderSessionV28 {
	readonly status: 'selected-v28-render-session';
	readonly generation: 28;
	readonly plan: UnifiedExactRenderPlanV14;
	createClipExportFrameSource(clipId: string): VideoRetimeExactExportFrameSource;
	createClipPreviewConsumer(
		clipId: string,
		port: VideoRetimePreviewMediaPort,
		options: Readonly<{ readonly onPresented: (descriptor: VideoRetimeFrameDescriptor) => void }>,
	): VideoRetimeExactPreviewConsumer;
	createTransitionPreviewResolver(transitionId: string): UnifiedExactRenderTransitionResolver;
	createTransitionExportResolver(transitionId: string): UnifiedExactRenderTransitionResolver;
	createFinishingPreviewConsumer(): Promise<UnifiedExactRenderFinishingConsumerV14>;
	createFinishingExportConsumer(): Promise<UnifiedExactRenderFinishingConsumerV14>;
	analyzeMotion(request: VideoMotionAnalysisRequestV1): Promise<VideoMotionAnalysisResultV1>;
	createMotionWebGl2Accelerator(
		canvas: unknown,
	): Promise<DisposableVideoMotionWebGl2AcceleratorV1 | null>;
}

export interface FramescaperSelectedRenderSessionRuntimeV28 {
	create(authority: unknown): FramescaperSelectedRenderSessionV28;
}

const OWNER_RUNTIMES = new WeakMap<object, FramescaperSelectedRenderSessionRuntimeV28>();

/** Capture the selected V14 plan once for every preview/export picture consumer. */
export function createFramescaperSelectedRenderSessionV28(
	value: FramescaperSelectedRenderSessionOptionsV28,
): FramescaperSelectedRenderSessionV28 {
	const options = exactOptions(value);
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(options.authority);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		options.profile, options.project, authority,
	);
	const timingBySourceId = bindExactTiming(options.project, authority);
	return Object.freeze({
		status: 'selected-v28-render-session' as const,
		generation: 28 as const,
		plan,
		createClipExportFrameSource: (clipId: string) => (
			createUnifiedExactRenderClipExportFrameSource(plan, clipId, timingBySourceId)
		),
		createClipPreviewConsumer: (
			clipId: string,
			port: VideoRetimePreviewMediaPort,
			consumerOptions: Readonly<{
				readonly onPresented: (descriptor: VideoRetimeFrameDescriptor) => void;
			}>,
		) => createUnifiedExactRenderClipPreviewConsumer(
			plan, clipId, timingBySourceId, port, consumerOptions,
		),
		createTransitionPreviewResolver: (transitionId: string) => (
			createUnifiedExactRenderTransitionPreviewResolver(plan, transitionId, timingBySourceId)
		),
		createTransitionExportResolver: (transitionId: string) => (
			createUnifiedExactRenderTransitionExportResolver(plan, transitionId, timingBySourceId)
		),
		createFinishingPreviewConsumer: async () => {
			const module = await import('../common/editor/unified-exact-render-finishing-consumers-v14.ts');
			return module.createUnifiedExactRenderFinishingPreviewConsumerV14(plan, timingBySourceId);
		},
		createFinishingExportConsumer: async () => {
			const module = await import('../common/editor/unified-exact-render-finishing-consumers-v14.ts');
			return module.createUnifiedExactRenderFinishingExportConsumerV14(plan, timingBySourceId);
		},
		analyzeMotion: async (request: VideoMotionAnalysisRequestV1) => {
			const module = await import('../common/editor/video-motion-analysis-v27.ts');
			return module.analyzeVideoMotionV1(request);
		},
		createMotionWebGl2Accelerator: async (canvas: unknown) => {
			const module = await import('../common/editor/video-motion-webgl2-v27.ts');
			return module.tryCreateVideoMotionWebGl2AcceleratorV1(canvas);
		},
	});
}

/** Bind a factory to the selected controller without exposing a visible control. */
export function bindFramescaperSelectedRenderSessionRuntimeV28(
	profile: unknown,
	controller: Readonly<{ readonly project: unknown }>,
): void {
	if (!controller || typeof controller !== 'object') {
		throw new TypeError('The selected V28 render-session owner must be a controller.');
	}
	OWNER_RUNTIMES.set(controller, Object.freeze({
		create: (authority: unknown) => createFramescaperSelectedRenderSessionV28({
			profile,
			project: structuredClone(controller.project),
			authority,
		}),
	}));
}

export function framescaperSelectedRenderSessionRuntimeV28For(
	owner: unknown,
): FramescaperSelectedRenderSessionRuntimeV28 | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? OWNER_RUNTIMES.get(owner as object) ?? null : null;
}

/** Product-version adapter seam; the runtime still executes exact selected V28 authority. */
export function bindFramescaperSelectedRenderSessionRuntimeV28Instance(
	owner: object,
	runtime: FramescaperSelectedRenderSessionRuntimeV28,
): void {
	if (!owner || typeof owner !== 'object' || typeof runtime?.create !== 'function') {
		throw new TypeError('A selected V28 render-session runtime and owner are required.');
	}
	OWNER_RUNTIMES.set(owner, runtime);
}

function bindExactTiming(
	projectValue: unknown,
	authority: FramescaperUnifiedExactVisualRenderAuthority,
): ReadonlyMap<string, BoundVideoSourceTimingView> {
	const project = record(projectValue, 'Selected V28 render project');
	const sources = array(project.sources, 'Selected V28 render sources');
	const result = new Map<string, BoundVideoSourceTimingView>();
	for (const sourceValue of sources) {
		const source = record(sourceValue, 'Selected V28 render source');
		if (source.kind !== 'video') continue;
		if (typeof source.id !== 'string' || !source.id || result.has(source.id)) {
			throw new TypeError('Selected V28 render video source identities must be unique.');
		}
		result.set(source.id, bindVideoSourceTimingView(authority.timingViews, source));
	}
	return result;
}

function exactOptions(value: unknown): FramescaperSelectedRenderSessionOptionsV28 {
	const options = record(value, 'Selected V28 render-session options');
	const fields = ['profile', 'project', 'authority'];
	const keys = Reflect.ownKeys(options);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Selected V28 render-session options must be an exact record.');
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(options, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Selected V28 render-session ${field} must be an own data property.`);
		}
	}
	return options as unknown as FramescaperSelectedRenderSessionOptionsV28;
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
