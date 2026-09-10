/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The offline render one delivery asks for.
 *
 * Split out of the export service so that "orchestrate a delivery" and "render
 * one span of the project" stay separate concerns — the video export action and
 * the mastering-sequence assembler both take this renderer, and neither wants
 * the rest of the service to reach it.
 *
 * The progress wiring lives here too, because whether a render reports progress
 * as the export's or as whatever task is active is a property of the render, not
 * of the caller.
 */

// The export service's legacy JavaScript ports are narrowed as their owners migrate.
/* eslint-disable @typescript-eslint/no-explicit-any */
type RuntimeValue = any;

export interface ExportSnapshotRendererRuntime {
	readonly options: RuntimeValue;
	readonly sourceBuffers: RuntimeValue;
	readonly taskProgress: RuntimeValue;
	createCacheAwareRenderEngine(): RuntimeValue;
	prepareCommittedTimePitchCaches(snapshot: RuntimeValue, signal: RuntimeValue): Promise<unknown>;
	throwIfAborted(signal: RuntimeValue): void;
	updateExportProgress(value: RuntimeValue): void;
}

export function createExportSnapshotRenderer(runtime: ExportSnapshotRendererRuntime) {
	const {
		options, sourceBuffers, taskProgress,
		createCacheAwareRenderEngine, prepareCommittedTimePitchCaches,
		throwIfAborted, updateExportProgress,
	} = runtime;
	const exportProgressObservers = new Set<(value: RuntimeValue) => void>();
	const observeExportProgress = (observer: (value: RuntimeValue) => void) => {
		exportProgressObservers.add(observer);
		return () => { exportProgressObservers.delete(observer); };
	};

async function renderSnapshot(
	snapshot: RuntimeValue,
	range: RuntimeValue,
	sourceMap: RuntimeValue = sourceBuffers,
	signal: RuntimeValue = null,
	chunkSources: RuntimeValue = null,
	prepareTimePitchCaches = true,
) {
	throwIfAborted(signal);
	if (typeof options.renderSnapshot === 'function') {
		const rendered = chunkSources === null
			? await options.renderSnapshot(snapshot, range, sourceMap, signal)
			: await options.renderSnapshot(snapshot, range, sourceMap, signal, chunkSources);
		throwIfAborted(signal);
		return rendered;
	}
	if (prepareTimePitchCaches) await prepareCommittedTimePitchCaches(snapshot, signal);
	const renderEngine = createCacheAwareRenderEngine();
	try {
		if (chunkSources === null) renderEngine.loadProject(snapshot, sourceMap);
		else renderEngine.loadProject(snapshot, sourceMap, { chunkSources });
		const rendered = await renderEngine.renderMix({ ...withRenderProgress(range), signal });
		throwIfAborted(signal);
		return rendered;
	} finally { await renderEngine.dispose(); }
}

function withRenderProgress(range: RuntimeValue) {
	const activeKind = taskProgress?.getSnapshot?.()?.kind;
	if (!activeKind) return range;
	return {
		...range,
		onProgress: (progress: RuntimeValue) => {
			const value = typeof progress === 'number' ? progress : progress?.progress;
			if (activeKind === 'export') {
				updateExportProgress(value);
				const mapped = taskProgress?.getSnapshot?.()?.value;
				for (const observer of exportProgressObservers) {
					observer(typeof mapped === 'number' && Number.isFinite(mapped) ? mapped : value);
				}
			}
			else taskProgress.updateActive(value);
		},
	};
}

	return { observeExportProgress, renderSnapshot, withRenderProgress };
}
