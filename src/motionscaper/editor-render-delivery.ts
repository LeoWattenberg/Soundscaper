/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMotionRenderQueue, normalizeMotionRenderPlan, type MotionRenderSink, type MotionRenderQueue } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { createMotionscaperRenderRequest } from './editor-render-task.ts';
import { motionDocumentFileName } from './editor-document-file-name.ts';
import { createMotionscaperRevision } from './editor-project-revision.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import { loadMotionscaperAssetBytes, type MotionAssetReader } from './editor-render-resources.ts';
import { motionCompositionHasAudio } from '../common/editor/motion-composition-audio.ts';
import { createMotionMediaProvider } from '../common/editor/motion-media-provider.ts';
import { createMotionExpressionAudioPreparation, motionProjectUsesAudioAmplitude } from '../common/editor/motion-expression-audio-preparation.ts';
import { createMotionAudioMixer } from '../common/editor/motion-audio-mixer.ts';
import { aggregateScapeErrors } from '../common/editor/scape-abort.ts';
import { MotionDeliveryCleanupFailure, pendingMotionDeliveryCleanup } from '../common/editor/motion-delivery-cleanup.ts';
import type { MotionDesktopDeliveryReceipt } from './desktop-delivery-contract.ts';
import type { MotionVideoBackground } from '../common/editor/motion-video-delivery.ts';
import { admitMotionTemporalWork } from '../common/editor/motion-temporal-sampling.ts';
import { requireMotionTrackingReady } from '../common/editor/motion-tracking-admission.ts';

export interface MotionDeliveryOptions {
	readonly project: MotionscaperProject; readonly store: MotionAssetReader; readonly compositionId: string;
	readonly firstFrame: number; readonly endFrame: number; readonly format: 'png' | 'mp4' | 'webm' | 'prores'; readonly excludeAudio?: boolean;
	readonly background?: MotionVideoBackground; readonly writable?: WritableStream<Uint8Array>; readonly signal: AbortSignal;
	readonly onProgress: (completed: number, total: number) => void;
	readonly queue?: MotionRenderQueue; readonly maximumBlobBytes?: number;
}

/** Pin intent and its retained asset closure before a bounded renderer publishes any complete output. */
export async function renderMotionscaperDelivery(options: MotionDeliveryOptions): Promise<Blob | MotionDesktopDeliveryReceipt | null> {
	const queue = options.queue ?? createMotionRenderQueue(); let sink: MotionRenderSink<Blob | MotionDesktopDeliveryReceipt | null> | null = null;
	try {
		const snapshot = createMotionscaperRevision(options.project);
		requireMotionTrackingReady(snapshot.project);
		const composition = snapshot.project.compositions.find((entry) => entry.id === options.compositionId);
		if (!composition) throw new Error('The composition to render is unavailable.');
		admitMotionTemporalWork(snapshot.project, composition.id);
		const hasAudio = (options.format === 'mp4' || options.format === 'webm' || (options.format === 'prores' && !options.excludeAudio)) && motionCompositionHasAudio(snapshot.project, composition.id);
		const plan = normalizeMotionRenderPlan({ identity: { projectId: snapshot.projectId, revisionDigest: snapshot.digest, compositionId: composition.id },
			width: composition.width, height: composition.height, frameRate: composition.frameRate,
			firstFrame: options.firstFrame, frameCount: options.endFrame - options.firstFrame,
			...(composition.temporal ? { temporal: composition.temporal } : {}), ...(composition.depthOfFieldSamples === undefined ? {} : { depthOfFieldSamples: composition.depthOfFieldSamples }) });
		const { loadMotionRasterRuntime, createMotionBrowserRasterizer } = await import('../common/editor/controller/composition/motion-raster-runtime.ts');
		if (options.format === 'prores') {
			const { motionscaperDesktopDelivery, createMotionscaperDesktopProresSink } = await import('./desktop-delivery-adapter.ts');
			const delivery = motionscaperDesktopDelivery();
			const profile = await delivery?.getProfile();
			if (!delivery || !profile) throw new Error('Native ProRes export is unavailable.');
			if (hasAudio && profile.audio !== 'pcm-s24le') throw new Error('This native encoder requires an explicit choice to exclude composition audio.');
			const native = await createMotionscaperDesktopProresSink(delivery, { plan, suggestedName: motionDocumentFileName(snapshot.project.title).replace(/\.mscape$/u, '.mov'), signal: options.signal, ...(hasAudio ? { audio: { sampleRate: 48000, channels: 2 } as const } : {}) });
			if (!native) throw new DOMException('Native export was cancelled.', 'AbortError');
			sink = hasAudio ? native : { ...native, audioPolicy: 'exclude' };
		} else if (options.format === 'png') {
			const runtime = await loadMotionRasterRuntime(options.signal);
			const { createMotionPngSequenceSink } = await import('../common/editor/controller/export/motion-png-sequence.ts');
			const { encodeMotionPng } = await import('../common/editor/motion-png.ts');
			sink = createMotionPngSequenceSink({ plan, writable: options.writable, maximumBlobBytes: options.maximumBlobBytes,
				encode: (surface) => Promise.resolve(encodeMotionPng(runtime.kit, surface)) });
		} else {
			const { createMotionBrowserVideoSink } = await import('../common/editor/controller/export/motion-browser-video.ts');
			sink = await createMotionBrowserVideoSink({ plan, format: options.format, writable: options.writable, maximumBlobBytes: options.maximumBlobBytes, background: options.background, signal: options.signal,
				...(hasAudio ? { audio: { sampleRate: 48000, channels: 2 } as const } : {}) });
		}
		const request = createMotionscaperRenderRequest({ ...options, project: snapshot.project, sink,
			acquire: async (revision, signal) => {
				for (const asset of revision.project.assets) {
					signal?.throwIfAborted();
					const body = await options.store.readAsset(asset);
					if (!body || body.size !== asset.byteLength) throw new Error(`The retained asset ${asset.name} is unavailable.`);
				}
				const loadAsset = (asset: Parameters<typeof loadMotionscaperAssetBytes>[0], readSignal?: AbortSignal) => loadMotionscaperAssetBytes(asset, options.store, readSignal);
				const provider = createMotionMediaProvider({ loadAsset });
				const expressionAudio = motionProjectUsesAudioAmplitude(revision.project) ? createMotionExpressionAudioPreparation({ project: revision.project, provider }) : undefined;
				const audioMixer = hasAudio ? createMotionAudioMixer({ project: revision.project, provider, ...(expressionAudio ? { expressionAudio } : {}) }) : undefined;
				try {
					const rasterizer = await createMotionBrowserRasterizer({ assets: revision.project.assets, loadAsset, decodeFootage: provider.decodeFootage }, signal);
					return { rasterizer, audioMixer, expressionAudio, release: () => { expressionAudio?.dispose(); audioMixer?.dispose(); provider.dispose(); return Promise.resolve(); } };
				} catch (error) { expressionAudio?.dispose(); audioMixer?.dispose(); provider.dispose(); throw error; }
			},
		});
		return (await queue.enqueue(request).completion).output;
	} catch (error) {
		const cleanup: unknown[] = [];
		try {
			if (sink) await sink.abort(error);
			else if (options.writable && !options.writable.locked) await options.writable.abort(error);
		} catch (failure) {
			if (pendingMotionDeliveryCleanup(failure).length) cleanup.push(failure);
			else {
				const ownedSink = sink;
				throw new MotionDeliveryCleanupFailure([error, failure], 'Motion delivery and output cleanup both failed.', async () => {
					if (ownedSink) await ownedSink.abort(error); else await options.writable?.abort(error);
				});
			}
		}
		throw aggregateScapeErrors(error, cleanup, 'Motion delivery and output cleanup both failed.');
	} finally { if (!options.queue) await queue.close(); }
}
