/* SPDX-License-Identifier: AGPL-3.0-only */
import { acquireVideoExportTimingIndexes } from '../common/editor/controller/export/video-export-timing.ts';
import { captureProductVideoExportTimingSourceIds } from '../common/editor/controller/export/product-video-export-strategy.ts';
import { loadVideoExportOriginal } from '../common/editor/controller/export/video-export-original-loader.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import { findClip, findSource } from '../common/editor/project.js';
import { createFramescaperVideoExportStrategySuccessor } from './video-export-strategy-successor.ts';
import { framescaperSuccessorBaselineProject } from './editor-project-successor-commands.ts';
import type { FramescaperSuccessorEnvironment } from './editor-project-successor-environment.ts';
import type { FramescaperSuccessorProject } from './editor-project-successor.ts';
import type { ProductVideoExportStrategyEncodeRequest } from '../common/editor/controller/export/product-video-export-strategy.ts';
/** Capture the same saved scene, timing and ordinary originals used by maintained Frame finishing. */
export async function prepareFramescaperSuccessorNativePicture(options: {
	readonly environment: FramescaperSuccessorEnvironment; readonly project: FramescaperSuccessorProject; readonly canvas: unknown;
	readonly signal: AbortSignal; readonly assertCurrent: () => void;
}) {
	const { environment, project, signal, assertCurrent } = options;
	const strategy = createFramescaperVideoExportStrategySuccessor({ store: environment.controllerStore, readAsset: asset => environment.owners.readAsset(asset) });
	const exportProject = strategy.createExportProject({ canonicalProject: project, delivery: { project: framescaperSuccessorBaselineProject(project),
		audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
	// The MP4 discriminator belongs only to the maintained picture planner. No encoded MP4 or fake output is produced here.
	const plan = strategy.createPlan({ canonicalProject: project, exportProject, format: 'mp4', range: 'project', includeAudio: false, canvas: options.canvas });
	if (!plan) throw new Error('This Frame sequence has no exact finishing picture plan.');
	const store = { async loadMediaAsset(key: string, readOptions?: { signal?: AbortSignal }) {
		const value = await environment.controllerStore.loadMediaAsset(key, readOptions); return value ? await canonicalMediaContentBlob(value) : null;
	} };
	const timing = await acquireVideoExportTimingIndexes(exportProject, store, { findClip, findSource }, { signal, assertCurrent,
		requiredSourceIds: captureProductVideoExportTimingSourceIds(strategy, plan), allowInactiveRequiredSources: true });
	try {
		const generatedSources = strategy.captureGeneratedSources?.(plan); const generated = new Set(generatedSources?.sourceIds);
		const videoBlobs = new Map<string, Blob>();
		for (const input of plan.inputs) {
			if (input.kind !== 'video-source') continue;
			if (typeof input.sourceId !== 'string' || typeof input.storageKey !== 'string') throw new Error('Frame video input has no exact retained identity.');
			if (generated.has(input.sourceId)) continue;
			const blob = await loadVideoExportOriginal({ store, project, sourceId: input.sourceId, storageKey: input.storageKey, signal, assertCurrent });
			if (!blob) throw new Error(`Frame original ${input.sourceId} is unavailable. Restore its retained media before exporting.`);
			videoBlobs.set(input.sourceId, blob);
		}
		assertCurrent(); signal.throwIfAborted();
		const request: ProductVideoExportStrategyEncodeRequest = { canonicalProject: project, exportProject, plan, videoBlobs, generatedSources,
			timingBySourceId: timing.timingBySourceId, timingViewsBySourceId: timing.timingViewsBySourceId, audioMix: null,
			editorFfmpeg: null, webCodecs: null, maximumOutputBytes: undefined, signal, assertCurrent };
		return { strategy, request, hasAudio: strategy.hasAudio?.(exportProject) ?? false, release: () => { timing.release(); videoBlobs.clear(); } };
	} catch (error) { timing.release(); throw error; }
}
