/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCapturedVideoProxyActiveUpdate,
	FramescaperCaptureProxySaveLease,
} from '../common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import {
	createVideoProxyCandidateObserverForRuntime,
	type VideoProxyCandidateCompositionOptions,
	type VideoProxyCandidateRuntime,
} from '../common/editor/controller/video-proxy-candidate-composition.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	assertVideoProxyCandidateObserver,
	type VideoProxyCandidateObserver,
} from '../common/editor/video-proxy-candidate-observation.ts';
import type { CapturedVideoProxyBodyStore } from './editor-captured-video-proxy-bodies.ts';
import type { CapturedVideoProxyClaimCleanup } from './editor-captured-video-proxy-claim-cleanup.ts';
import type { CapturedVideoProxySessionController } from
	'./editor-captured-video-proxy-session-reconciliation.ts';
import {
	capturedVideoProxySchedulerPolicy,
	type CapturedVideoProxySchedulerPolicy,
} from './editor-captured-video-proxy-scheduler-state.ts';
import {
	assertFramescaperEditorProjectEnvironment,
	type FramescaperEditorProjectEnvironment,
} from './editor-project-environment.ts';
import { reconcileFramescaperProjectFeatureRequirements } from
	'./editor-project-feature-requirements.ts';
import { framescaperProjectForVideoProxyRelationship } from './editor-project-runtime.ts';
import { framescaperProjectStoreAuthority } from './editor-project-store.ts';
import type { FramescaperVideoProxyCapacityStoreSequence } from
	'./editor-video-proxy-attachment-capacity-sequence.ts';

export interface FramescaperCapturedVideoProxyRuntimeComposition
	extends VideoProxyCandidateCompositionOptions {
	readonly runtime: VideoProxyCandidateRuntime | null | undefined;
	/** Authenticated product/test composition seam; production builds omit it. */
	readonly candidateObserver?: VideoProxyCandidateObserver;
	readonly synchronizeActiveProject?: (
		update: FramescaperCapturedVideoProxyActiveUpdate,
	) => PromiseLike<unknown> | unknown;
	readonly quiesceProjectSaves?: (
		projectId: string,
		signal?: AbortSignal,
	) => PromiseLike<FramescaperCaptureProxySaveLease> | FramescaperCaptureProxySaveLease;
	readonly maximumLineageEntries?: number;
	readonly maximumLandedEntries?: number;
	readonly maximumReconciliationAttempts?: number;
}

export interface CapturedVideoProxySchedulerStore extends
	CapturedVideoProxyBodyStore, FramescaperVideoProxyCapacityStoreSequence {
	loadProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<unknown>;
	loadMediaAsset(sourceId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<Blob | null>;
	resolveLinkedVideoOriginal?: (
		projectId: string,
		source: Readonly<Record<string, unknown>>,
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<Readonly<{ readonly blob: Blob; readonly binding: unknown }> | null>;
}

export interface CapturedVideoProxySchedulerDependencies {
	readonly schemaVersion: 1;
	readonly profile: EditorProjectRuntimeProfile;
	readonly store: CapturedVideoProxySchedulerStore;
	readonly projectForRelationship: (project: unknown) => unknown;
	readonly reconcileProjectRequirements: (project: unknown) => unknown;
	readonly loadAuthoritativeProject: (projectId: string, signal?: AbortSignal) => Promise<unknown>;
	readonly publishDesktopProject?: (
		project: unknown,
		signal?: AbortSignal,
		beforeFinish?: () => PromiseLike<void> | void,
	) => Promise<unknown>;
	readonly claimCleanup: CapturedVideoProxyClaimCleanup;
	readonly synchronizeActiveProject: NonNullable<
		FramescaperCapturedVideoProxyRuntimeComposition['synchronizeActiveProject']
	> | null;
	readonly quiesceProjectSaves: NonNullable<
		FramescaperCapturedVideoProxyRuntimeComposition['quiesceProjectSaves']
	> | null;
	readonly session: CapturedVideoProxySessionController;
	readonly candidateObserver: VideoProxyCandidateObserver | null;
	readonly port: ReturnType<typeof framescaperProjectStoreAuthority>['port'];
	readonly opfs: NonNullable<ReturnType<typeof framescaperProjectStoreAuthority>['opfs']>;
	readonly policy: CapturedVideoProxySchedulerPolicy;
}

/** Compose only the family-qualified Framescaper 1.0 capture authority. */
export function capturedVideoProxySchedulerDependencies(
	environmentValue: FramescaperEditorProjectEnvironment | unknown,
	sessionValue: unknown,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): CapturedVideoProxySchedulerDependencies {
	const environment = assertFramescaperEditorProjectEnvironment(environmentValue);
	const session = assertSession(sessionValue);
	const authority = framescaperProjectStoreAuthority(environment.runtime.profile, environment.store);
	if (!authority.opfs) throw new TypeError('Captured Framescaper proxy scheduling requires exact OPFS authority.');
	return {
		schemaVersion: 1,
		profile: environment.runtime.profile,
		store: environment.store as CapturedVideoProxySchedulerStore,
		projectForRelationship: (project) => framescaperProjectForVideoProxyRelationship(
			environment.runtime.profile,
			project,
		),
		reconcileProjectRequirements: (project) => reconcileFramescaperProjectFeatureRequirements(
			environment.runtime.profile,
			project,
		),
		loadAuthoritativeProject: (projectId, signal) => Promise.resolve(
			environment.controllerStore.loadProject(projectId, signal ? { signal } : {}),
		),
		...(environment.controllerStore === environment.store ? {} : {
			publishDesktopProject: (
				project: unknown,
				signal?: AbortSignal,
				beforeFinish?: () => PromiseLike<void> | void,
			) => environment.desktopProjectLibrary!.publishProject({
				project,
				...(signal ? { signal } : {}),
				...(beforeFinish ? { beforeFinish } : {}),
			}),
		}),
		claimCleanup: environment.claimCleanup,
		synchronizeActiveProject: composition.synchronizeActiveProject ?? null,
		quiesceProjectSaves: composition.quiesceProjectSaves ?? null,
		session,
		candidateObserver: candidateObserver(composition),
		port: authority.port,
		opfs: authority.opfs,
		policy: capturedVideoProxySchedulerPolicy(composition as unknown as Readonly<Record<string, unknown>>),
	};
}

function candidateObserver(
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): VideoProxyCandidateObserver | null {
	if (!composition || typeof composition !== 'object') {
		throw new TypeError('Captured proxy runtime composition is required.');
	}
	if (composition.candidateObserver) {
		return assertVideoProxyCandidateObserver(composition.candidateObserver);
	}
	return createVideoProxyCandidateObserverForRuntime(composition.runtime, composition);
}

function assertSession(value: unknown): CapturedVideoProxySessionController {
	if (!value || typeof value !== 'object') throw new TypeError('Captured proxy scheduling requires its session.');
	for (const method of [
		'getSnapshot', 'captureProjectHistory', 'assertProjectHistoryToken',
		'beginProjectActivation', 'installCommittedProjectHistory',
	] as const) {
		if (typeof (value as Record<string, unknown>)[method] !== 'function') {
			throw new TypeError(`Captured proxy scheduling requires session.${method}.`);
		}
	}
	return value as CapturedVideoProxySessionController;
}
