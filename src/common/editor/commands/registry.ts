/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_WARP_COMMAND_TYPES,
	defineAudioWarpCommandHandlers,
	type AudioWarpCommandHandlers,
	type AudioWarpCommandType,
} from './audio-warp.ts';
import {
	CLIP_RANGE_CLIPBOARD_COMMAND_TYPES,
	defineClipRangeClipboardCommandHandlers,
	type ClipRangeClipboardCommandHandlers,
	type ClipRangeClipboardCommandType,
} from './clip-range-clipboard.ts';
import {
	defineEffectsVideoCommandHandlers,
	EFFECTS_VIDEO_COMMAND_TYPES,
	type EffectsVideoCommandHandlers,
	type EffectsVideoCommandType,
} from './effects-video.ts';
import {
	AUDIO_EDITOR_COMMAND_TYPES,
	isAudioEditorCommandType,
	type AudioEditorCommand,
	type AudioEditorCommandType,
	type EditorCommandHandler,
	type EditorCommandHandlerRegistry,
	type EditorCommandProject,
} from './protocol.ts';
import {
	defineProjectSourceBinCommandHandlers,
	PROJECT_SOURCE_BIN_COMMAND_TYPES,
	type ProjectSourceBinCommandHandlers,
	type ProjectSourceBinCommandType,
} from './project-source-bin.ts';
import {
	defineTrackFolderCommandHandlers,
	TRACK_FOLDER_COMMAND_TYPES,
	type TrackFolderCommandHandlers,
	type TrackFolderCommandType,
} from './track-folder.ts';
import {
	defineTrackMixerLabelCommandHandlers,
	TRACK_MIXER_LABEL_COMMAND_TYPES,
	type TrackMixerLabelCommandHandlers,
	type TrackMixerLabelCommandType,
} from './track-mixer-label.ts';
import {
	defineSequenceTimingCommandHandlers,
	SEQUENCE_TIMING_COMMAND_TYPES,
	type SequenceTimingCommandHandlers,
	type SequenceTimingCommandType,
} from './sequence-timing.ts';
import {
	defineTempoSignatureCommandHandlers,
	TEMPO_SIGNATURE_COMMAND_TYPES,
	type TempoSignatureCommandHandlers,
	type TempoSignatureCommandType,
} from './tempo-signature.ts';
import {
	defineTakeCompCommandHandlers,
	TAKE_COMP_COMMAND_TYPES,
	type TakeCompCommandHandlers,
	type TakeCompCommandType,
} from './take-comp.ts';
import {
	defineTimelineAnnotationCommandHandlers,
	TIMELINE_ANNOTATION_COMMAND_TYPES,
	type TimelineAnnotationCommandHandlers,
	type TimelineAnnotationCommandType,
} from './timeline-annotation.ts';
import {
	defineVideoCompositionCommandHandlers,
	VIDEO_COMPOSITION_COMMAND_TYPES,
	type VideoCompositionCommandHandlers,
	type VideoCompositionCommandType,
} from './video-composition.ts';

export {
	AUDIO_WARP_COMMAND_TYPES,
	CLIP_RANGE_CLIPBOARD_COMMAND_TYPES,
	defineAudioWarpCommandHandlers,
	defineClipRangeClipboardCommandHandlers,
	defineEffectsVideoCommandHandlers,
	defineProjectSourceBinCommandHandlers,
	defineSequenceTimingCommandHandlers,
	defineTempoSignatureCommandHandlers,
	defineTakeCompCommandHandlers,
	defineTimelineAnnotationCommandHandlers,
	defineVideoCompositionCommandHandlers,
	defineTrackFolderCommandHandlers,
	defineTrackMixerLabelCommandHandlers,
	EFFECTS_VIDEO_COMMAND_TYPES,
	PROJECT_SOURCE_BIN_COMMAND_TYPES,
	SEQUENCE_TIMING_COMMAND_TYPES,
	TEMPO_SIGNATURE_COMMAND_TYPES,
	TAKE_COMP_COMMAND_TYPES,
	TIMELINE_ANNOTATION_COMMAND_TYPES,
	VIDEO_COMPOSITION_COMMAND_TYPES,
	TRACK_FOLDER_COMMAND_TYPES,
	TRACK_MIXER_LABEL_COMMAND_TYPES,
};

export interface EditorCommandHandlerDomains {
	readonly projectSourceBin: ProjectSourceBinCommandHandlers;
	readonly tempoSignature: TempoSignatureCommandHandlers;
	readonly sequenceTiming: SequenceTimingCommandHandlers;
	readonly trackMixerLabel: TrackMixerLabelCommandHandlers;
	readonly trackFolder: TrackFolderCommandHandlers;
	readonly takeComp: TakeCompCommandHandlers;
	readonly audioWarp: AudioWarpCommandHandlers;
	readonly clipRangeClipboard: ClipRangeClipboardCommandHandlers;
	readonly effectsVideo: EffectsVideoCommandHandlers;
	readonly timelineAnnotation: TimelineAnnotationCommandHandlers;
	readonly videoComposition: VideoCompositionCommandHandlers;
}

type RegisteredDomainCommandType =
	| ProjectSourceBinCommandType
	| TempoSignatureCommandType
	| SequenceTimingCommandType
	| TrackMixerLabelCommandType
	| TrackFolderCommandType
	| TakeCompCommandType
	| AudioWarpCommandType
	| ClipRangeClipboardCommandType
	| EffectsVideoCommandType
	| TimelineAnnotationCommandType
	| VideoCompositionCommandType;

type DomainsAreExhaustive = [
	Exclude<AudioEditorCommandType, RegisteredDomainCommandType>,
	Exclude<RegisteredDomainCommandType, AudioEditorCommandType>,
] extends [never, never] ? true : never;

/** Fails type-checking when a declared command is absent from all domains. */
export const EDITOR_COMMAND_DOMAINS_EXHAUSTIVE: DomainsAreExhaustive = true;

/**
 * Validate each domain independently, then combine them into the only runtime
 * registry accepted by the compatibility facade.
 */
export function defineEditorCommandHandlerRegistry(
	domains: EditorCommandHandlerDomains,
): Readonly<EditorCommandHandlerRegistry> {
	const domainRegistries = [
		defineProjectSourceBinCommandHandlers(domains.projectSourceBin),
		defineTempoSignatureCommandHandlers(domains.tempoSignature),
		defineSequenceTimingCommandHandlers(domains.sequenceTiming),
		defineTrackMixerLabelCommandHandlers(domains.trackMixerLabel),
		defineTrackFolderCommandHandlers(domains.trackFolder),
		defineTakeCompCommandHandlers(domains.takeComp),
		defineAudioWarpCommandHandlers(domains.audioWarp),
		defineClipRangeClipboardCommandHandlers(domains.clipRangeClipboard),
		defineEffectsVideoCommandHandlers(domains.effectsVideo),
		defineTimelineAnnotationCommandHandlers(domains.timelineAnnotation),
		defineVideoCompositionCommandHandlers(domains.videoComposition),
	] as const;
	const combined: Partial<Record<AudioEditorCommandType, EditorCommandHandler>> = {};
	for (const domain of domainRegistries) {
		for (const [type, handler] of Object.entries(domain)) {
			if (!isAudioEditorCommandType(type)) throw new TypeError(`Unknown editor command handler: ${type}.`);
			if (combined[type]) throw new TypeError(`Duplicate editor command handler: ${type}.`);
			combined[type] = handler as EditorCommandHandler;
		}
	}
	const missing = AUDIO_EDITOR_COMMAND_TYPES.filter((type) => typeof combined[type] !== 'function');
	if (missing.length) throw new TypeError(`Editor command registry is not exhaustive: missing ${missing.join(', ')}.`);
	return Object.freeze(combined) as EditorCommandHandlerRegistry;
}

export function dispatchEditorCommand(
	registry: Readonly<EditorCommandHandlerRegistry>,
	project: EditorCommandProject,
	command: AudioEditorCommand | Readonly<{ type: string }>,
): void {
	const type: string = command.type;
	if (!isAudioEditorCommandType(type)) {
		throw new RangeError(`Unsupported editor command: ${type}.`);
	}
	const handler = registry[type] as (
		project: EditorCommandProject,
		command: AudioEditorCommand,
	) => void;
	handler(project, command as AudioEditorCommand);
}
