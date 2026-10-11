/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMotionRenderQueue, normalizeMotionRenderPlan, type MotionRenderSink } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { createMotionscaperRenderRequest } from './editor-render-task.ts';
import { createMotionscaperRevision } from './editor-project-revision.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import { loadMotionscaperAssetBytes, type MotionAssetReader } from './editor-render-resources.ts';
import type { MotionVideoBackground } from '../common/editor/motion-video-delivery.ts';

export interface MotionDeliveryOptions {
	readonly project: MotionscaperProject; readonly store: MotionAssetReader; readonly compositionId: string;
	readonly firstFrame: number; readonly endFrame: number; readonly format: 'png' | 'mp4' | 'webm';
	readonly background?: MotionVideoBackground; readonly writable?: WritableStream<Uint8Array>; readonly signal: AbortSignal;
	readonly onProgress: (completed: number, total: number) => void;
}

/** Pin intent and its retained asset closure before a bounded renderer publishes any complete output. */
export async function renderMotionscaperDelivery(options: MotionDeliveryOptions): Promise<Blob | null> {
	const queue = createMotionRenderQueue(); let sink: MotionRenderSink<Blob | null> | null = null;
	try {
		const snapshot = createMotionscaperRevision(options.project);
		const composition = snapshot.project.compositions.find((entry) => entry.id === options.compositionId);
		if (!composition) throw new Error('The composition to render is unavailable.');
		const plan = normalizeMotionRenderPlan({ identity: { projectId: snapshot.projectId, revisionDigest: snapshot.digest, compositionId: composition.id },
			width: composition.width, height: composition.height, frameRate: composition.frameRate,
			firstFrame: options.firstFrame, frameCount: options.endFrame - options.firstFrame });
		const { loadMotionRasterRuntime, createMotionBrowserRasterizer } = await import('../common/editor/controller/composition/motion-raster-runtime.ts');
		const runtime = await loadMotionRasterRuntime(options.signal);
		if (options.format === 'png') {
			const { createMotionPngSequenceSink } = await import('../common/editor/controller/export/motion-png-sequence.ts');
			const { encodeMotionPng } = await import('../common/editor/motion-png.ts');
			sink = createMotionPngSequenceSink({ plan, writable: options.writable,
				encode: (surface) => Promise.resolve(encodeMotionPng(runtime.kit, surface)) });
		} else {
			const { createMotionBrowserVideoSink } = await import('../common/editor/controller/export/motion-browser-video.ts');
			sink = await createMotionBrowserVideoSink({ plan, format: options.format, writable: options.writable, background: options.background, signal: options.signal });
		}
		const request = createMotionscaperRenderRequest({ ...options, project: snapshot.project, sink,
			acquire: async (revision, signal) => {
				for (const asset of revision.project.assets) {
					signal?.throwIfAborted();
					const body = await options.store.readAsset(asset);
					if (!body || body.size !== asset.byteLength) throw new Error(`The retained asset ${asset.name} is unavailable.`);
				}
				const rasterizer = await createMotionBrowserRasterizer({ assets: revision.project.assets,
					loadAsset: (asset, readSignal) => loadMotionscaperAssetBytes(asset, options.store, readSignal) }, signal);
				return { rasterizer, release: () => Promise.resolve() };
			},
		});
		return (await queue.enqueue(request).completion).output;
	} catch (error) {
		if (sink) await sink.abort(error);
		else if (options.writable && !options.writable.locked) await options.writable.abort(error);
		throw error;
	} finally { await queue.close(); }
}
