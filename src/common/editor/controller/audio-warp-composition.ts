/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { AudioWarpRenderPathStatus } from '../audio-warp-runtime.ts';
import {
	MAXIMUM_AUDIO_WARP_TRANSIENTS,
	type AudioWarpMap,
	type AudioWarpQuantizeOptions,
} from '../audio-warp-domain.ts';
import type { AudioEditorProjectV17 } from '../project-v17-validation.ts';
import type { Rational } from '../timeline-time.ts';
import {
	createAudioWarpAuthoringService,
	type AudioWarpGrooveApplicationOptions,
	type PreparedAudioWarpClipEdit,
} from './audio-warp-authoring-service.ts';
import type { EditorControllerLifetime, EditorProjectToken } from './lifecycle.ts';
import {
	createTransientAnalysisPcmAccess,
	type TransientAnalysisPcmAccess,
	type TransientAnalysisPcmStore,
} from './transient-analysis-pcm-access.ts';
import {
	createTransientAnalysisService,
	type ClipTransientAnalysisOutcome,
	type TransientAnalysisControllerProject,
	type TransientAnalysisServiceDependencies,
} from './transient-analysis-service.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export type AudioWarpControllerBlockReason =
	| 'no-audio-clip'
	| 'busy-or-read-only'
	| 'locked';

export interface AudioWarpControllerView {
	readonly selectedClipId: string | null;
	readonly clipName: string;
	readonly sourceName: string;
	readonly hasWarpMap: boolean;
	readonly warpMap: unknown;
	readonly blockReason: AudioWarpControllerBlockReason | null;
	readonly renderStatus: Readonly<AudioWarpRenderPathStatus>;
}

export interface AudioWarpControllerCompositionDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly store: TransientAnalysisPcmStore & Readonly<{
		loadAnalysis(key: string): Promise<unknown>;
		saveAnalysis(key: string, value: unknown): Promise<unknown>;
		deleteAnalysis(key: string): Promise<unknown>;
	}>;
	readonly pcmAccess?: TransientAnalysisPcmAccess;
	readonly analyzeChannels?: TransientAnalysisServiceDependencies['analyzeChannels'];
	getProject(): AudioEditorProjectV17;
	getSelectedClipId(): string | null;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	getRenderStatus(): Readonly<AudioWarpRenderPathStatus>;
	setAnalysisProcessing?(processing: boolean): void;
	publish?(): void;
}

export interface AudioWarpControllerComposition {
	view(): Readonly<AudioWarpControllerView>;
	analyzeSelected(): Promise<Readonly<ClipTransientAnalysisOutcome>>;
	createIdentityMapSelected(): unknown;
	quantizeSelected(options: AudioWarpQuantizeOptions): Promise<unknown>;
	applyGrooveSelected(options: AudioWarpGrooveApplicationOptions): Promise<unknown>;
	clearSelected(): unknown;
	dispose(): void;
}

/** Compose disposable transient analysis with stale-safe persistent warp edits. */
export function createAudioWarpControllerComposition(
	dependencies: Readonly<AudioWarpControllerCompositionDependencies>,
): Readonly<AudioWarpControllerComposition> {
	let pcmAccess = dependencies.pcmAccess;
	let transientAnalysis: ReturnType<typeof createTransientAnalysisService> | null = null;
	const authoring = createAudioWarpAuthoringService({
		lifetime: dependencies.lifetime,
		getProject: dependencies.getProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
	});
	let analysisDepth = 0;
	return Object.freeze({
		view,
		analyzeSelected,
		createIdentityMapSelected,
		quantizeSelected,
		applyGrooveSelected,
		clearSelected,
		dispose,
	});

	function view(): Readonly<AudioWarpControllerView> {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const selectedClipId = dependencies.getSelectedClipId();
		const clip = selectedAudioClip(project, selectedClipId);
		const source = clip ? project.sources.find((candidate) => candidate.id === clip.sourceId) : null;
		const owner = clip ? owningTrack(project, String(clip.id)) : null;
		const blockReason = !clip || !source
			? 'no-audio-clip'
			: dependencies.editingBlocked()
				? 'busy-or-read-only'
				: owner?.locked === true ? 'locked' : null;
		return Object.freeze({
			selectedClipId: clip ? String(clip.id) : null,
			clipName: clip ? String(clip.title || clip.name || clip.id) : '',
			sourceName: source ? String(source.name || source.id) : '',
			hasWarpMap: clip?.warpMap != null,
			warpMap: clip?.warpMap ?? null,
			blockReason,
			renderStatus: dependencies.getRenderStatus(),
		});
	}

	async function analyzeSelected(): Promise<Readonly<ClipTransientAnalysisOutcome>> {
		const clipId = requireSelectedAudioClip();
		const outcome = await analyzeWithProcessing(clipId);
		assertStillSelected(clipId);
		return outcome;
	}

	function createIdentityMapSelected(): unknown {
		const clipId = requireSelectedAudioClip();
		const preparation = authoring.prepareClipEdit(clipId);
		if (preparation.warpMap !== null) return preparation.warpMap;
		return authoring.setWarpMap(preparation, identityWarpMap(preparation));
	}

	async function quantizeSelected(options: AudioWarpQuantizeOptions): Promise<unknown> {
		const clipId = requireSelectedAudioClip();
		const outcome = await analyzeWithProcessing(clipId);
		assertStillSelected(clipId);
		const preparation = ensureWarpMap(clipId);
		return authoring.quantizeTransients(preparation, transientSources(outcome), options);
	}

	async function applyGrooveSelected(options: AudioWarpGrooveApplicationOptions): Promise<unknown> {
		const clipId = requireSelectedAudioClip();
		const outcome = await analyzeWithProcessing(clipId);
		assertStillSelected(clipId);
		const preparation = ensureWarpMap(clipId);
		return authoring.applyGrooveTemplate(preparation, transientSources(outcome), options);
	}

	function clearSelected(): unknown {
		const clipId = requireSelectedAudioClip();
		return authoring.clearWarpMap(authoring.prepareClipEdit(clipId));
	}

	function ensureWarpMap(clipId: string): PreparedAudioWarpClipEdit {
		let preparation = authoring.prepareClipEdit(clipId);
		if (preparation.warpMap === null) {
			authoring.setWarpMap(preparation, identityWarpMap(preparation));
			assertStillSelected(clipId);
			preparation = authoring.prepareClipEdit(clipId);
		}
		return preparation;
	}

	async function analyzeWithProcessing(
		clipId: string,
	): Promise<Readonly<ClipTransientAnalysisOutcome>> {
		analysisDepth += 1;
		if (analysisDepth === 1) setAnalysisProcessing(true);
		try {
			return await analysisService().analyzeClip(clipId);
		} finally {
			analysisDepth -= 1;
			if (analysisDepth === 0) setAnalysisProcessing(false);
		}
	}

	function analysisService(): ReturnType<typeof createTransientAnalysisService> {
		if (transientAnalysis) return transientAnalysis;
		pcmAccess ??= createTransientAnalysisPcmAccess({ store: dependencies.store });
		transientAnalysis = createTransientAnalysisService({
			lifetime: dependencies.lifetime,
			getProject: () => dependencies.getProject() as unknown as TransientAnalysisControllerProject,
			captureProject: dependencies.captureProject,
			assertProject: dependencies.assertProject,
			loadAnalysis: dependencies.store.loadAnalysis.bind(dependencies.store),
			saveAnalysis: dependencies.store.saveAnalysis.bind(dependencies.store),
			deleteAnalysis: dependencies.store.deleteAnalysis.bind(dependencies.store),
			resolveSourceSha256: pcmAccess.resolveSourceSha256,
			readSourceRange: pcmAccess.readSourceRange,
			...(dependencies.analyzeChannels ? { analyzeChannels: dependencies.analyzeChannels } : {}),
		});
		return transientAnalysis;
	}

	function dispose(): void {
		pcmAccess?.dispose();
	}

	function setAnalysisProcessing(processing: boolean): void {
		dependencies.setAnalysisProcessing?.(processing);
		dependencies.publish?.();
	}

	function requireSelectedAudioClip(): string {
		dependencies.lifetime.assertActive();
		const clipId = dependencies.getSelectedClipId();
		if (!selectedAudioClip(dependencies.getProject(), clipId)) {
			throw new RangeError('Select one audio clip before editing its warp map.');
		}
		return clipId!;
	}

	function assertStillSelected(clipId: string): void {
		if (dependencies.getSelectedClipId() !== clipId
			|| !selectedAudioClip(dependencies.getProject(), clipId)) {
			throw new Error('The selected audio clip changed before warp authoring completed.');
		}
	}
}

export function identityWarpMap(
	preparation: Readonly<PreparedAudioWarpClipEdit>,
): Readonly<AudioWarpMap> {
	const authority = preparation.expectedClipAuthority;
	const sourceEnd = safeAdd(
		authority.sourceStartFrame,
		authority.sourceDurationFrames,
		'audio warp identity source extent',
	);
	return Object.freeze({
		feature: 'audio-warp',
		points: Object.freeze([
			Object.freeze({
				outer: Object.freeze({ num: 0, den: 1 }),
				source: Object.freeze({ num: authority.sourceStartFrame, den: 1 }),
				mode: 'forward' as const,
			}),
			Object.freeze({
				outer: authority.outerExtent,
				source: Object.freeze({ num: sourceEnd, den: 1 }),
				mode: 'forward' as const,
			}),
		]),
	});
}

function transientSources(
	outcome: Readonly<ClipTransientAnalysisOutcome>,
): readonly Rational[] {
	return Object.freeze(outcome.analysis.transients
		.slice(0, MAXIMUM_AUDIO_WARP_TRANSIENTS)
		.map(({ sourceFrame }) => Object.freeze({ num: sourceFrame, den: 1 })));
}

function selectedAudioClip(
	project: AudioEditorProjectV17,
	clipId: string | null,
): DataRecord | null {
	if (!clipId) return null;
	const clip = project.clips.find((candidate) => candidate.id === clipId) as DataRecord | undefined;
	return clip?.kind === 'audio' ? clip : null;
}

function owningTrack(project: AudioEditorProjectV17, clipId: string): DataRecord | null {
	const owners = project.tracks.filter((track) => (
		Array.isArray(track.clipIds) && track.clipIds.includes(clipId)
	));
	return owners.length === 1 ? owners[0] as DataRecord : null;
}

function safeAdd(left: number, right: number, name: string): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)
		|| left < 0 || right < 0 || right > Number.MAX_SAFE_INTEGER - left) {
		throw new RangeError(`${name} exceeds the safe integer range.`);
	}
	return left + right;
}
