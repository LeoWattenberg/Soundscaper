/* SPDX-License-Identifier: AGPL-3.0-only */

export type ProjectFeatureRequirementDisposition = 'bypass' | 'rendered-fallback';
export type ProjectFeatureFallbackKind = 'audio' | 'video';
export type ProjectFeatureFallbackRole =
	| 'project-audio-mix-v1'
	| 'audio-track-render-v1'
	| 'project-video-render-v1'
	| 'video-clip-render-v1';

export interface ProjectFeatureAudioMixFallback {
	readonly role: 'project-audio-mix-v1';
	readonly kind: 'audio';
	readonly sourceId: string;
	readonly sha256: string;
}

export interface ProjectFeatureAudioTrackRenderFallback {
	readonly role: 'audio-track-render-v1';
	readonly kind: 'audio';
	readonly sourceId: string;
	readonly sha256: string;
	readonly targetTrackId: string;
}

export interface ProjectFeatureVideoRenderFallback {
	readonly role: 'project-video-render-v1';
	readonly kind: 'video';
	readonly sourceId: string;
	readonly sha256: string;
}

export interface ProjectFeatureVideoClipRenderFallback {
	readonly role: 'video-clip-render-v1';
	readonly kind: 'video';
	readonly sourceId: string;
	readonly sha256: string;
	readonly targetClipId: string;
}

export type ProjectFeatureFallback =
	| ProjectFeatureAudioMixFallback
	| ProjectFeatureAudioTrackRenderFallback
	| ProjectFeatureVideoRenderFallback
	| ProjectFeatureVideoClipRenderFallback;

export interface ProjectFeatureRequirement {
	readonly id: string;
	readonly featureId: string;
	readonly displayName: string;
	readonly disposition: ProjectFeatureRequirementDisposition;
	readonly fallback: ProjectFeatureFallback | null;
}

export interface ProjectFeatureRequirementsManifest {
	readonly schemaVersion: 2;
	readonly requirements: readonly ProjectFeatureRequirement[];
}

export type ProjectFeatureAvailability = 'available' | 'unavailable' | 'unknown';
export type ProjectFeatureEffectiveDisposition = 'native' | 'bypassed' | 'rendered-fallback';

export interface ProjectFeatureRequirementsReportItem {
	readonly requirementId: string;
	readonly featureId: string;
	readonly displayName: string;
	readonly availability: ProjectFeatureAvailability;
	readonly declaredDisposition: ProjectFeatureRequirementDisposition;
	readonly disposition: ProjectFeatureEffectiveDisposition;
	readonly fallback: ProjectFeatureFallback | null;
	readonly message: string;
}

export interface ProjectFeatureRequirementsReport {
	readonly schemaVersion: 1;
	readonly format: 'soundscaper-project';
	readonly compatible: boolean;
	readonly counts: Readonly<Record<ProjectFeatureAvailability, number>>;
	readonly items: readonly ProjectFeatureRequirementsReportItem[];
}

export interface ProjectSourceReference {
	readonly id?: unknown;
	readonly kind?: unknown;
	readonly frameCount?: unknown;
	readonly sampleFrameCount?: unknown;
	readonly sourceFrameCount?: unknown;
	readonly channelCount?: unknown;
	readonly sampleRate?: unknown;
	readonly width?: unknown;
	readonly height?: unknown;
	readonly frameRate?: unknown;
	readonly hasAudio?: unknown;
	readonly contentSha256?: unknown;
}

export interface ProjectTimelineClipReference {
	readonly id?: unknown;
	readonly kind?: unknown;
	readonly sourceId?: unknown;
	readonly timelineStartFrame?: unknown;
	readonly durationFrames?: unknown;
	readonly sequenceId?: unknown;
	readonly sequenceStartFrame?: unknown;
	readonly sequenceFrameCount?: unknown;
	readonly videoEffects?: unknown;
}

export interface ProjectTrackReference {
	readonly id?: unknown;
	readonly type?: unknown;
	readonly effectsActive?: unknown;
	readonly effects?: unknown;
	readonly clipIds?: unknown;
	readonly audioFreeze?: unknown;
}

export interface NormalizeProjectFeatureRequirementsOptions {
	readonly sources: readonly ProjectSourceReference[];
	readonly clips?: readonly ProjectTimelineClipReference[];
	readonly tracks?: readonly ProjectTrackReference[];
	readonly schemaVersion?: unknown;
	readonly sampleRate?: unknown;
	readonly sequences?: readonly Readonly<Record<string, unknown>>[];
	readonly primarySequenceId?: unknown;
}

export interface EvaluateProjectFeatureRequirementsOptions {
	readonly knownFeatureIds: ReadonlySet<string>;
	readonly availableFeatureIds: ReadonlySet<string>;
	readonly sources?: readonly ProjectSourceReference[];
	readonly clips?: readonly ProjectTimelineClipReference[];
	readonly tracks?: readonly ProjectTrackReference[];
	readonly schemaVersion?: unknown;
	readonly sampleRate?: unknown;
	readonly sequences?: readonly Readonly<Record<string, unknown>>[];
	readonly primarySequenceId?: unknown;
}
