/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareTransformClipsCommand as prepareLegacyTransformClipsCommand } from '../commands/clip-transform-runtime.js';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type {
	FrameCanonicalEdgeTrimPlan,
	FrameCanonicalEdgeTrimRequest,
	FrameCanonicalEdgeTrimTransform,
} from '../frame-canonical-edge-trim-domain.ts';
import { planFrameCanonicalEdgeTrim } from '../frame-canonical-edge-trim-planner.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';
import type { VideoEdgeTrimResultReporter } from './video-edge-trim-feedback.ts';

type TransformManyCommand = Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }>;

const prepareTransformClipsCommand = prepareLegacyTransformClipsCommand as unknown as (
	project: unknown,
	transforms: readonly FrameCanonicalEdgeTrimTransform[],
) => TransformManyCommand;

export interface VideoEdgeTrimServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	/** A fresh branded command projection for the live persisted project. */
	getProject(): unknown;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	/** Optional existing-status adapter; preview and failed operations never call it. */
	readonly reportResult?: VideoEdgeTrimResultReporter;
}

export interface VideoEdgeTrimService {
	/** Plan immutable presentation geometry without changing document state. */
	preview(request: FrameCanonicalEdgeTrimRequest): FrameCanonicalEdgeTrimPlan;
	/** Replan against the live document and commit at most one transform command. */
	commit(request: FrameCanonicalEdgeTrimRequest): FrameCanonicalEdgeTrimPlan;
}

/**
 * One controller boundary for frame-canonical, video-bearing edge trims.
 * Preview data is never accepted as commit authority: commit always reads and
 * replans the current command projection before preparing the command.
 */
export function createVideoEdgeTrimService(
	dependencies: VideoEdgeTrimServiceDependencies,
): Readonly<VideoEdgeTrimService> {
	function preview(request: FrameCanonicalEdgeTrimRequest): FrameCanonicalEdgeTrimPlan {
		dependencies.lifetime.assertActive();
		return planFrameCanonicalEdgeTrim(dependencies.getProject(), request);
	}

	function commit(request: FrameCanonicalEdgeTrimRequest): FrameCanonicalEdgeTrimPlan {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
		const project = dependencies.getProject();
		const plan = planFrameCanonicalEdgeTrim(project, request);
		if (plan.kind === 'noop') {
			dependencies.reportResult?.(plan);
			return plan;
		}
		dependencies.commit(prepareTransformClipsCommand(project, plan.transforms));
		dependencies.reportResult?.(plan);
		return plan;
	}

	return Object.freeze({ preview, commit });
}
