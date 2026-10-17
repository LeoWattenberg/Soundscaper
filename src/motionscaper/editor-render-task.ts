/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMotionRenderPlan, type MotionRenderLease, type MotionRenderRequest, type MotionRenderSink } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { motionCompositionHasAudio } from '../common/editor/motion-composition-audio.ts';
import { admitMotionTemporalWork } from '../common/editor/motion-temporal-sampling.ts';
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
	admitMotionTemporalWork(snapshot.project, composition.id);
	if (!options.sink.audio && options.sink.audioPolicy !== 'exclude' && motionCompositionHasAudio(snapshot.project, composition.id)) throw new Error('This composition contains audio. Choose an audio-capable video encoder or an image sequence.');
	const totalFrames = composition.durationFrames;
	const firstFrame = motionInteger(options.firstFrame ?? 0, 'first render frame');
	const endFrame = motionInteger(options.endFrame ?? totalFrames, 'end render frame', 1);
	if (firstFrame >= endFrame || endFrame > totalFrames) throw new RangeError('Motion render range is outside its pinned composition.');
	const plan = normalizeMotionRenderPlan({ identity: { projectId: snapshot.projectId, revisionDigest: snapshot.digest, compositionId: composition.id },
		width: composition.width, height: composition.height, frameRate: composition.frameRate, firstFrame, frameCount: endFrame - firstFrame,
		...(composition.temporal ? { temporal: composition.temporal } : {}), ...(composition.depthOfFieldSamples === undefined ? {} : { depthOfFieldSamples: composition.depthOfFieldSamples }) });
	const evaluator = compileMotionscaperProject(snapshot.project);
	return Object.freeze({ plan, sink: options.sink, signal: options.signal, onProgress: options.onProgress,
		acquire: async (signal?: AbortSignal) => ({ ...await options.acquire(snapshot, signal), evaluator }),
	});
}
