/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AnalysisAudioBuffer, AnalysisRange } from './analysis-service.ts';

/** Group, send and cue strips gate audibility exactly like tracks do. */
export interface AnalysisRenderMixerStrip {
	readonly mute?: boolean;
	readonly solo?: boolean;
}

export interface AnalysisRenderMixer {
	readonly groups?: readonly AnalysisRenderMixerStrip[];
	readonly sends?: readonly AnalysisRenderMixerStrip[];
	readonly cues?: readonly AnalysisRenderMixerStrip[];
}

export interface AnalysisRenderProject {
	readonly tracks: readonly { readonly id: string; readonly type: string; readonly mute?: boolean; readonly solo?: boolean }[];
	readonly master: unknown;
	readonly mixer?: AnalysisRenderMixer;
}

export interface AnalysisRenderDependencies<Project extends AnalysisRenderProject, Buffers> {
	readonly getProject: () => Project;
	readonly getSelectedTrackId: () => string | null;
	readonly cloneProject: (project: Project) => Project;
	readonly projectSampleRate: () => number;
	readonly hasMissingTimelineSources: () => boolean;
	readonly sourceBuffers: Buffers;
	readonly copy: Readonly<{ localSourcesMissing: string; audioTrackRequired: string; analysisScopeInvalid: string }>;
	readonly renderSnapshot: (
		project: Project,
		options: AnalysisRange & { readonly includeTail: false; readonly preRollFrames: number },
		buffers: Buffers,
		signal: AbortSignal | null,
	) => Promise<AnalysisAudioBuffer>;
}

const audibleStrips = <Strip extends AnalysisRenderMixerStrip>(strips: readonly Strip[]): Strip[] =>
	strips.map((strip) => ({ ...strip, mute: false, solo: false }));

/**
 * A soloed or muted bus gates the whole mix, so isolating one track means neutralizing the mixer
 * strips as well; routing, gain, pan and bus effects stay exactly as the document authored them.
 */
function isolateMixer(mixer: AnalysisRenderMixer): AnalysisRenderMixer {
	return { ...mixer,
		...(mixer.groups ? { groups: audibleStrips(mixer.groups) } : {}),
		...(mixer.sends ? { sends: audibleStrips(mixer.sends) } : {}),
		...(mixer.cues ? { cues: audibleStrips(mixer.cues) } : {}),
	};
}

/** Render the selected mix on a detached document; analysis never authors mixer state. */
export function createAnalysisRenderer<Project extends AnalysisRenderProject, Buffers>(
	dependencies: AnalysisRenderDependencies<Project, Buffers>,
) {
	return async (scope: string, range: AnalysisRange, signal: AbortSignal | null = null): Promise<AnalysisAudioBuffer> => {
		if (dependencies.hasMissingTimelineSources()) throw new Error(dependencies.copy.localSourcesMissing);
		let snapshot = dependencies.cloneProject(dependencies.getProject());
		if (scope === 'track') {
			const selected = snapshot.tracks.find((track) => track.id === dependencies.getSelectedTrackId());
			if (!selected || selected.type !== 'audio') throw new Error(dependencies.copy.audioTrackRequired);
			snapshot = { ...snapshot,
				tracks: snapshot.tracks.map((track) => track.type === 'audio'
					? { ...track, mute: track.id !== selected.id, solo: false } : track),
				master: { gain: 1, effects: [] },
				...(snapshot.mixer ? { mixer: isolateMixer(snapshot.mixer) } : {}),
			};
		} else if (scope !== 'master') throw new RangeError(dependencies.copy.analysisScopeInvalid);
		return dependencies.renderSnapshot(snapshot, {
			startFrame: range.startFrame, endFrame: range.endFrame, includeTail: false,
			preRollFrames: Math.min(range.startFrame, dependencies.projectSampleRate() * 10),
		}, dependencies.sourceBuffers, signal);
	};
}
