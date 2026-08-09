/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ProjectLifecycleTrack {
	readonly id: string;
	readonly type: string;
}

/**
 * The activation workflow intentionally depends on only project identity and
 * track inventory. Project serialization remains owned by the project model.
 */
export interface ProjectLifecycleProject {
	readonly id: string;
	readonly tracks: readonly ProjectLifecycleTrack[];
}

export interface ProjectLifecycleHistory<Project extends ProjectLifecycleProject> {
	readonly present: Project;
}

export interface ProjectLifecycleLock {
	readonly projectId: string;
	readOnly: boolean;
	readonly method: string;
	retryAt?: number | null;
	available?: Promise<ProjectLifecycleLock | null> | null;
	readonly lost?: Promise<unknown> | null;
	readonly finished?: PromiseLike<unknown> | null;
	handoffFrom?: ProjectLifecycleLock | null;
	release(): void;
}

export interface ProjectLifecycleTabMetadata {
	readonly selectedTrackId?: string | null;
	readonly selectedClipId?: string | null;
	readonly selectedAnnotationId?: string | null;
	readonly declaredReadOnly?: boolean;
	readonly declaredReadOnlyReason?: string | null;
	readonly intrinsicReadOnly?: boolean;
	readonly intrinsicReadOnlyReason?: string | null;
	readonly featureRequirementsReadOnly?: boolean;
	readonly featureRequirementsReport?: unknown;
	readonly featureRequirementsAudioEffectPlaybackBypass?: unknown;
	readonly featureRequirementsAudioRenderedFallback?: unknown;
	readonly featureRequirementsVideoEffectPlaybackBypass?: unknown;
	readonly featureRequirementsVideoRenderedFallback?: unknown;
	readonly [key: string]: unknown;
}

export interface ProjectLifecycleTab<
	Project extends ProjectLifecycleProject,
	History extends ProjectLifecycleHistory<Project>,
> {
	readonly projectId: string;
	readonly history: History;
	readonly dirty?: boolean;
	readonly metadata?: ProjectLifecycleTabMetadata;
}

export interface ProjectReadOnlyUpdate {
	readonly readOnly: boolean;
	readonly reason: string | null;
	readonly lockMethod: string;
}

export interface ProjectLifecycleCopy {
	readonly ready: string;
	readonly projectOpenOtherTab: string;
	readonly projectReadOnly: string;
	readonly futureProjectReadOnly: string;
	readonly untitledProject: string;
	readonly track: string;
}
