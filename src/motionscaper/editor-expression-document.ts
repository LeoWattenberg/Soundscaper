/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionExpressionAudioPreparation } from '../common/editor/motion-expression-audio-preparation.ts';
import { createMotionExpressionRuntime } from '../common/editor/motion-expression-runtime.ts';
import type { MotionPropertyValue } from '../common/editor/motion-property-evaluation.ts';
import { motionRational } from '../common/editor/motion-values.ts';
import type { Rational } from '../common/editor/timeline-time.ts';
import { createMotionMediaProvider } from '../common/editor/motion-media-provider.ts';
import { createMotionscaperRevision } from './editor-project-revision.ts';
import { bakeMotionscaperExpressionWithAudio, type MotionscaperExpressionBake, type MotionscaperExpressionBakeOptions } from './editor-expression-commands.ts';
import { loadMotionscaperAssetBytes, type MotionAssetReader } from './editor-render-resources.ts';
import type { MotionscaperProjectCommand } from './editor-project-commands.ts';

/** Analyze retained media under one revision; asynchronous baking cannot overwrite intervening edits. */
export async function bakeMotionscaperDocumentExpression(options: MotionscaperExpressionBakeOptions & Readonly<{
	store: MotionAssetReader; currentProject: () => unknown; onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>;
	onProgress?: (completed: number, total: number) => void;
}>): Promise<MotionscaperExpressionBake> {
	const provider = createMotionMediaProvider({ loadAsset: (asset, signal) => loadMotionscaperAssetBytes(asset, options.store, signal) });
	let preparation: ReturnType<typeof createMotionExpressionAudioPreparation> | null = null;
	try {
		preparation = createMotionExpressionAudioPreparation({ project: options.project, provider });
		const result = await bakeMotionscaperExpressionWithAudio({ ...options, expressionAudio: preparation });
		options.signal?.throwIfAborted();
		if (createMotionscaperRevision(options.currentProject()).digest !== result.sourceRevisionDigest) throw new Error('The document changed during expression baking. Retry using its current revision.');
		await options.onEdit(result.commands); return result;
	} finally { preparation?.dispose(); provider.dispose(); }
}

/** Evaluate the selected authored property without mutating its expression or curves. */
export async function evaluateMotionscaperDocumentExpression(options: Readonly<{
	project: unknown; compositionId: string; layerId: string; propertyPath: string; frame: Rational; store: MotionAssetReader; signal?: AbortSignal;
}>): Promise<MotionPropertyValue> {
	const revision = createMotionscaperRevision(options.project); const frame = motionRational(options.frame, 'expression evaluation frame');
	const provider = createMotionMediaProvider({ loadAsset: (asset, signal) => loadMotionscaperAssetBytes(asset, options.store, signal) });
	let preparation: ReturnType<typeof createMotionExpressionAudioPreparation> | null = null;
	try {
		preparation = createMotionExpressionAudioPreparation({ project: revision.project, provider });
		const runtime = createMotionExpressionRuntime(revision.project.compositions, { revisionDigest: revision.digest, assets: revision.project.assets });
		return await preparation.evaluate((query) => runtime.createSession(query).sample({ compositionId: options.compositionId, layerId: options.layerId, propertyPath: options.propertyPath, frame }), options.signal);
	} finally { preparation?.dispose(); provider.dispose(); }
}
