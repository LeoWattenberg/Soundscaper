/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PersistedAudioEffect } from './persisted-audio-effect-validation.ts';

import type { ProjectHierarchyDocument } from './project-hierarchy-document-validation.ts';
import type { MediaClipLeaf, MediaSourceLeaf, MediaTrackLeaf } from './project-media-types.ts';

/** Fields admitted by project-document-validation, independent of the owning family. */
export interface ProjectDocumentSelection extends Readonly<Record<string, unknown>> {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
	readonly annotationIds: readonly string[];
	readonly frequencyRange?: Readonly<{ minimumFrequency: number; maximumFrequency: number }> | null;
}

export interface ProjectDocumentMaster extends Readonly<Record<string, unknown>> {
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly collapsed: boolean;
	readonly effectsActive: boolean;
	readonly effects: readonly PersistedAudioEffect[];
}

export interface ProjectDocumentMixer {
	readonly groups: readonly Readonly<{ id: string; gain: number; mute: boolean; solo: boolean }>[];
	readonly sends: readonly Readonly<{ id: string; gain: number; mute: boolean; solo: boolean }>[];
	readonly cues?: readonly Readonly<{ id: string; gain: number; mute: boolean; solo: boolean }>[];
}

/** Preserve declared fields through the extensible wire's index signature. */
export type ProjectDocumentBody<Source = MediaSourceLeaf, Clip = MediaClipLeaf, Track = MediaTrackLeaf> = {
	readonly [Key in keyof ProjectHierarchyDocument]:
		Key extends 'sources' ? readonly Source[] :
		Key extends 'clips' ? readonly Clip[] :
		Key extends 'tracks' ? readonly Track[] :
		Key extends 'projectBin' ? Readonly<Record<string, unknown>> & { readonly clips: readonly Clip[] } :
		Key extends 'selection' ? ProjectDocumentSelection : ProjectHierarchyDocument[Key];
} & Readonly<{
	master: ProjectDocumentMaster;
	mixer: ProjectDocumentMixer;
	tempo: Readonly<Record<string, unknown>> & {
		readonly bpm: number;
		readonly timeSignature: Readonly<{ numerator: number; denominator: number }>;
		readonly detected: boolean;
	};
	loop: Readonly<{ enabled: boolean; startFrame: number; endFrame: number }>;
	view: Readonly<Record<string, unknown>> & {
		readonly pixelsPerSecond: number;
		readonly horizontalPosition: number;
		readonly verticalPosition: number;
		readonly selectedTrackIds: readonly string[];
		readonly panelState: Readonly<Record<string, unknown>>;
	};
}>;
