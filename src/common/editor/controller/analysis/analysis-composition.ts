/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbsentAnalysisService } from '../composition/absent-audio-subsystems.ts';
import { createAnalysisRenderer, type AnalysisRenderDependencies, type AnalysisRenderProject } from './internal/analysis-renderer.ts';
import type { AnalysisDependencies, AnalysisState } from './analysis-service.ts';
import { createEditorAnalysisVisuals } from './internal/analysis-visuals.ts';
import { createDeferredAudioAnalysisService } from './internal/deferred-analysis-service.ts';
import type { EditorProjectGeneration } from '../shared/lifecycle.ts';
import type { EditorTaskProgressCoordinator } from '../shared/task-progress.ts';
import { analyzeChannelsInWorker } from '../source/waveform-analysis.ts';

type AnalysisProject = AnalysisRenderProject & ReturnType<AnalysisDependencies['getProject']>;
export type AnalysisCompositionState = AnalysisState & {
	selectedTrackId: string | null;
	analysisProcessing: boolean;
	contrastSelections: ReturnType<AnalysisDependencies['getContrastSelections']>;
	preferences?: { readonly spectrogram?: { readonly windowSize?: number } };
};

export type AnalysisActions = ReturnType<typeof createDeferredAudioAnalysisService>;

export interface AnalysisCompositionDependencies<Project extends AnalysisProject, Buffers>
	extends Omit<AnalysisRenderDependencies<Project, Buffers>, 'getProject' | 'getSelectedTrackId' | 'copy'> {
	readonly enabled: boolean;
	readonly productName: string;
	readonly state: AnalysisCompositionState;
	readonly copy: AnalysisDependencies['copy'] & AnalysisRenderDependencies<Project, Buffers>['copy']
		& Parameters<typeof analyzeChannelsInWorker>[2];
	readonly lifetime: AnalysisDependencies['lifetime'];
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly getProject: () => Project | null;
	readonly getActiveSelection: AnalysisDependencies['getActiveSelection'];
	readonly projectDurationFrames: (project: Project) => number;
	readonly store: Pick<AnalysisDependencies, 'loadAnalysis' | 'saveAnalysis'>;
	readonly taskProgress: Pick<EditorTaskProgressCoordinator, 'run'>;
	readonly showAnalysis: AnalysisDependencies['showAnalysis'];
	readonly setStatus: AnalysisDependencies['setStatus'];
	readonly publish: AnalysisDependencies['publish'];
	readonly handleError: AnalysisDependencies['handleError'];
	/** Browser worker transport; hosts may supply their own analysis backend. */
	readonly analyzeChannels?: typeof analyzeChannelsInWorker;
}

/** Own analysis wiring, lazy execution and progress while retaining eager cancellation. */
export function createAnalysisComposition<Project extends AnalysisProject, Buffers>(
	dependencies: AnalysisCompositionDependencies<Project, Buffers>,
): AnalysisActions {
	const { state, copy } = dependencies;
	const analyzeChannels = dependencies.analyzeChannels ?? analyzeChannelsInWorker;
	const requireProject = (): Project => {
		const project = dependencies.getProject();
		if (!project) throw new Error('Analysis requires an open project.');
		return project;
	};
	const service: AnalysisActions = dependencies.enabled ? createDeferredAudioAnalysisService({
		lifetime: dependencies.lifetime, copy, state,
		captureProject: () => dependencies.projectGeneration.capture(dependencies.getProject()?.id ?? null),
		assertProject: (token) => dependencies.projectGeneration.assertCurrent(token),
		getProject: requireProject,
		getSelectedTrackId: () => state.selectedTrackId,
		getRange: () => {
			const selection = dependencies.getActiveSelection();
			return Object.freeze({
				startFrame: selection?.startFrame ?? 0,
				endFrame: selection?.endFrame ?? dependencies.projectDurationFrames(requireProject()),
			});
		},
		getActiveSelection: dependencies.getActiveSelection,
		getSpectrumWindowSize: () => state.preferences?.spectrogram?.windowSize ?? 2048,
		getContrastSelections: () => state.contrastSelections,
		setContrastSelections: (value) => { state.contrastSelections = value; },
		loadAnalysis: (key) => dependencies.store.loadAnalysis(key),
		saveAnalysis: (key, value) => dependencies.store.saveAnalysis(key, value),
		renderAudio: createAnalysisRenderer({
			getProject: requireProject, getSelectedTrackId: () => state.selectedTrackId,
			cloneProject: dependencies.cloneProject, projectSampleRate: dependencies.projectSampleRate,
			hasMissingTimelineSources: dependencies.hasMissingTimelineSources,
			copy, sourceBuffers: dependencies.sourceBuffers, renderSnapshot: dependencies.renderSnapshot,
		}),
		analyzeChannels: async (channels, sampleRate, signal, options) => {
			const result = await analyzeChannels(channels, sampleRate, copy, 65536, signal, options);
			if (!isAnalysisResult(result)) throw new TypeError('The analysis worker returned an invalid result.');
			return result;
		},
		createVisuals: createEditorAnalysisVisuals,
		showAnalysis: dependencies.showAnalysis,
		setProcessing: (processing) => { state.analysisProcessing = processing; },
		setStatus: dependencies.setStatus, publish: dependencies.publish, handleError: dependencies.handleError,
	}) : createAbsentAnalysisService({ productName: dependencies.productName });
	return Object.freeze({
		...service,
		run: (...args) => dependencies.taskProgress.run('analysis', copy.analysisRendering, () => service.run(...args)),
		plotSpectrum: (...args) => dependencies.taskProgress.run('analysis', copy.analysisRendering, () => service.plotSpectrum(...args)),
		findClipping: (...args) => dependencies.taskProgress.run('analysis', copy.analysisRendering, () => service.findClipping(...args)),
		captureContrast: (...args) => dependencies.taskProgress.run('analysis', copy.contrastAnalyzing, () => service.captureContrast(...args)),
		repeatLast: (...args) => dependencies.taskProgress.run('analysis', copy.analysisRendering, () => service.repeatLast(...args)),
		measureLoudness: (...args) => dependencies.taskProgress.run('analysis', copy.measuringLoudness, () => service.measureLoudness(...args)),
	});
}

function isAnalysisResult(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
