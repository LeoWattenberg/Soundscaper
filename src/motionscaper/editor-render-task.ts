/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMotionRenderPlan, type MotionRenderLease, type MotionRenderRequest, type MotionRenderSink } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { motionInteger } from '../common/editor/motion-values.ts';
import { compileMotionscaperProject } from './editor-project-evaluation.ts';
import { createMotionscaperRevision, type MotionscaperRevision } from './editor-project-revision.ts';

export interface MotionscaperRenderRequestOptions<Result> {
	readonly project: unknown; readonly compositionId: string;
	readonly firstFrame?: number; readonly endFrame?: number;
	readonly acquire: (revision: MotionscaperRevision, signal?: AbortSignal) => Promise<Omit<MotionRenderLease, 'evaluator'>>;
	readonly sink: MotionRenderSink<Result>; readonly signal?: AbortSignal;
	readonly onProgress?: (completed: number, total: number) => void;
}

/** Freeze one intent revision before enqueueing, then retain that revision's complete asset closure. */
export function createMotionscaperRenderRequest<Result>(options: MotionscaperRenderRequestOptions<Result>): MotionRenderRequest<Result> {
	const snapshot = createMotionscaperRevision(options.project);
	const composition = snapshot.project.compositions.find((candidate) => candidate.id === options.compositionId);
	if (!composition) throw new Error('The requested motion composition is missing.');
	if (!options.sink.audio && options.sink.audioPolicy !== 'exclude' && hasAuthoredAudio(snapshot, composition.id)) throw new Error('This composition contains audio. Choose an audio-capable video encoder or an image sequence.');
	const totalFrames = composition.durationFrames;
	const firstFrame = motionInteger(options.firstFrame ?? 0, 'first render frame');
	const endFrame = motionInteger(options.endFrame ?? totalFrames, 'end render frame', 1);
	if (firstFrame >= endFrame || endFrame > totalFrames) throw new RangeError('Motion render range is outside its pinned composition.');
	const plan = normalizeMotionRenderPlan({ identity: { projectId: snapshot.projectId, revisionDigest: snapshot.digest, compositionId: composition.id },
		width: composition.width, height: composition.height, frameRate: composition.frameRate, firstFrame, frameCount: endFrame - firstFrame });
	const evaluator = compileMotionscaperProject(snapshot.project);
	return Object.freeze({ plan, sink: options.sink, signal: options.signal, onProgress: options.onProgress,
		acquire: async (signal?: AbortSignal) => ({ ...await options.acquire(snapshot, signal), evaluator }),
	});
}

/** Conservatively retain audio authority even when a placement falls between sampled video frames. */
function hasAuthoredAudio(revision: MotionscaperRevision, compositionId: string, visited = new Set<string>()): boolean {
	if (visited.has(compositionId)) return false; visited.add(compositionId);
	const composition = revision.project.compositions.find((candidate) => candidate.id === compositionId);
	return composition?.audio.some((placement) => placement.enabled) === true || composition?.layers.some((layer) => layer.enabled && (
		layer.kind === 'precomp' ? hasAuthoredAudio(revision, layer.compositionId, visited)
			: layer.kind === 'footage' && layer.audioEnabled && revision.project.assets.some((asset) => asset.id === layer.assetId && asset.kind === 'footage' && asset.hasAudio)
	)) === true;
}
