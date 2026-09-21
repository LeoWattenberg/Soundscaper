/* SPDX-License-Identifier: AGPL-3.0-only */

/** Project-fenced renderer adapter for the menu-opened Vamp analyzer. */

import { createStableId } from '../../stable-id.js';
import {
	normalizeVampAnalysisRequest,
	normalizeVampAnalysisResult,
	normalizeVampAnalyzerCatalog,
	type VampAnalysisRequest,
	type VampAnalysisResult,
	type VampAnalysisScope,
	type VampAnalyzerDescriptor,
} from '../../vamp-analysis.ts';
import { planVampFeatureLabelTrack } from '../../vamp-analysis-labels.ts';

export interface SoundscaperVampAnalysisInput {
	readonly projectId: string;
	readonly projectRevision: number;
	/** Null for a master render; exact selected audio-track identity otherwise. */
	readonly selectedTrackId: string | null;
	readonly request: Readonly<VampAnalysisRequest>;
}

/**
 * Injectable controller action. It owns PCM rendering and native wire
 * adaptation; neither concern leaks into the dialog or its domain model.
 */
export interface SoundscaperVampAnalyzerPort {
	list(): Promise<unknown>;
	analyze(
		input: Readonly<SoundscaperVampAnalysisInput>,
		signal: AbortSignal,
	): Promise<unknown>;
}

interface VampWorkspaceProject {
	readonly id: string;
	readonly revision: number;
	readonly sampleRate: number;
	readonly selection?: Readonly<{ readonly startFrame?: unknown; readonly endFrame?: unknown }> | null;
	readonly tracks: readonly Readonly<{ readonly id?: unknown; readonly type?: unknown }>[];
}

export interface SoundscaperVampAnalyzerController {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): unknown }>;
		readonly analysis?: Readonly<{ readonly vamp?: SoundscaperVampAnalyzerPort }>;
	}>;
}

export interface SoundscaperVampAnalyzerSession {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly selectedTrackId: string | null;
	readonly analyzerPort: SoundscaperVampAnalyzerPort;
	readonly scope: VampAnalysisScope;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sampleRate: number;
	loadCatalog(): Promise<readonly Readonly<VampAnalyzerDescriptor>[]>;
	analyze(request: Readonly<VampAnalysisRequest>, signal: AbortSignal): Promise<Readonly<VampAnalysisResult>>;
	publishLabels(result: Readonly<VampAnalysisResult>, trackName: string): Promise<void>;
}

export interface SoundscaperVampAnalyzerSessionOptions {
	readonly controller: SoundscaperVampAnalyzerController;
	readonly durationFrames: number;
	readonly selectedTrackId?: string | null;
	readonly port?: SoundscaperVampAnalyzerPort | null;
	readonly createTrackId?: () => string;
}

/** Capture one immutable project/range session at the moment its menu opens. */
export function createSoundscaperVampAnalyzerSession(
	options: Readonly<SoundscaperVampAnalyzerSessionOptions>,
): Readonly<SoundscaperVampAnalyzerSession> | null {
	const project = admitProject(options.controller?.project);
	const port = options.port ?? options.controller?.actions?.analysis?.vamp ?? null;
	if (project === null || port === null) return null;
	const durationFrames = positiveSafeInteger(options.durationFrames, 'Vamp project duration');
	const range = selectedRange(project.selection, durationFrames);
	const selectedTrackId = selectedAudioTrackId(project, options.selectedTrackId ?? null);
	const scope: VampAnalysisScope = selectedTrackId === null ? 'master' : 'track';
	const projectId = project.id;
	const projectRevision = project.revision;
	let catalogOperation: Promise<readonly Readonly<VampAnalyzerDescriptor>[]> | null = null;
	const loadCatalog = (): Promise<readonly Readonly<VampAnalyzerDescriptor>[]> => {
		catalogOperation ??= Promise.resolve().then(() => port.list()).then(normalizeVampAnalyzerCatalog);
		return catalogOperation;
	};
	const assertCurrent = (): VampWorkspaceProject => {
		const current = admitProject(options.controller.project);
		if (current === null || current.id !== projectId || current.revision !== projectRevision) {
			throw new Error('The project changed during Vamp analysis.');
		}
		return current;
	};
	const admitSessionRequest = (requestValue: Readonly<VampAnalysisRequest>): Readonly<VampAnalysisRequest> => {
		const request = normalizeVampAnalysisRequest(requestValue);
		if (request.startFrame !== range.startFrame || request.endFrame !== range.endFrame
			|| request.sampleRate !== project.sampleRate) {
			throw new RangeError('The Vamp request range no longer matches the captured project selection.');
		}
		if (request.scope === 'track' && selectedTrackId === null) {
			throw new Error('Vamp track analysis requires a selected audio track.');
		}
		return request;
	};
	return Object.freeze({
		projectId, projectRevision, selectedTrackId, analyzerPort: port,
		scope, startFrame: range.startFrame, endFrame: range.endFrame,
		sampleRate: project.sampleRate,
		loadCatalog,
		async analyze(
			requestValue: Readonly<VampAnalysisRequest>,
			signal: AbortSignal,
		): Promise<Readonly<VampAnalysisResult>> {
			assertCurrent();
			const request = admitSessionRequest(requestValue);
			const result = await port.analyze(Object.freeze({
				projectId, projectRevision,
				selectedTrackId: request.scope === 'track' ? selectedTrackId : null,
				request,
			}), signal);
			assertCurrent();
			return normalizeVampAnalysisResult(result, request);
		},
		async publishLabels(
			resultValue: Readonly<VampAnalysisResult>,
			trackName: string,
		): Promise<void> {
			assertCurrent();
			const result = normalizeVampAnalysisResult(resultValue);
			admitSessionRequest(result.request);
			const catalog = await loadCatalog();
			assertCurrent();
			const analyzer = catalog.find(({ analyzerId, stableId, binarySha256 }) => (
				analyzerId === result.request.analyzerId
				&& stableId === result.request.stableId
				&& binarySha256 === result.request.binarySha256
			));
			const output = analyzer?.outputs.find(({ id }) => id === result.request.outputId);
			if (!output) throw new Error('The analyzed Vamp output is no longer available.');
			const plan = planVampFeatureLabelTrack(result, {
				createTrackId: options.createTrackId ?? (() => createStableId('vamp-labels')),
				trackName, outputName: output.name, outputUnit: output.unit,
			});
			assertCurrent();
			await options.controller.actions.edit.commit(plan.command);
		},
	});
}

function admitProject(value: unknown): VampWorkspaceProject | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const project = value as Partial<VampWorkspaceProject>;
	if (typeof project.id !== 'string' || project.id.length === 0
		|| !Number.isSafeInteger(project.revision) || Number(project.revision) < 0
		|| !Number.isSafeInteger(project.sampleRate) || Number(project.sampleRate) <= 0
		|| !Array.isArray(project.tracks)) return null;
	return project as VampWorkspaceProject;
}

function selectedRange(
	selection: VampWorkspaceProject['selection'],
	durationFrames: number,
): Readonly<{ startFrame: number; endFrame: number }> {
	const startFrame = selection?.startFrame;
	const endFrame = selection?.endFrame;
	if (Number.isSafeInteger(startFrame) && Number.isSafeInteger(endFrame)
		&& Number(startFrame) >= 0 && Number(endFrame) > Number(startFrame)
		&& Number(endFrame) <= durationFrames) {
		return Object.freeze({ startFrame: Number(startFrame), endFrame: Number(endFrame) });
	}
	return Object.freeze({ startFrame: 0, endFrame: durationFrames });
}

function selectedAudioTrackId(project: VampWorkspaceProject, selectedTrackId: string | null): string | null {
	if (typeof selectedTrackId !== 'string' || selectedTrackId.length === 0) return null;
	return project.tracks.some((track) => track.id === selectedTrackId && track.type === 'audio')
		? selectedTrackId : null;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
