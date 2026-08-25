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
import type { CapturedVideoProxySessionController } from './editor-captured-video-proxy-session-reconciliation.ts';
import {
	capturedVideoProxySchedulerPolicy,
	type CapturedVideoProxySchedulerPolicy,
} from './editor-captured-video-proxy-scheduler-state.ts';
import type { FramescaperCapturedVideoProxySchemaVersion } from './editor-captured-video-proxy-preservation.ts';
import {
	assertFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from './editor-project-environment-v18.ts';
import {
	assertFramescaperEditorProjectEnvironmentV19,
	type FramescaperEditorProjectEnvironmentV19,
} from './editor-project-environment-v19.ts';
import {
	assertFramescaperEditorProjectEnvironmentV20,
	type FramescaperEditorProjectEnvironmentV20,
} from './editor-project-environment-v20.ts';
import {
	assertFramescaperEditorProjectEnvironmentV27,
	type FramescaperEditorProjectEnvironmentV27,
} from './editor-project-environment-v27.ts';
import {
	assertFramescaperEditorProjectEnvironmentV28,
	type FramescaperEditorProjectEnvironmentV28,
} from './editor-project-environment-v28.ts';
import {
	assertFramescaperEditorProjectEnvironmentV31,
	type FramescaperEditorProjectEnvironmentV31,
} from './editor-project-environment-v31.ts';
import { reconcileFramescaperProjectFeatureRequirementsV18 } from './editor-project-feature-requirements-v18.ts';
import { reconcileFramescaperProjectFeatureRequirementsV19 } from './editor-project-feature-requirements-v19.ts';
import { reconcileFramescaperProjectFeatureRequirementsV20 } from './editor-project-feature-requirements-v20.ts';
import { reconcileFramescaperProjectFeatureRequirementsV27 } from './editor-project-feature-requirements-v27.ts';
import { reconcileFramescaperProjectFeatureRequirementsV28 } from './editor-project-feature-requirements-v28.ts';
import { reconcileFramescaperProjectFeatureRequirementsV31 } from './editor-project-feature-requirements-v31.ts';
import { framescaperProjectStoreAuthorityV18 } from './editor-project-store-v18.ts';
import { framescaperProjectStoreAuthorityV19 } from './editor-project-store-v19.ts';
import { framescaperProjectStoreAuthorityV20 } from './editor-project-store-v20.ts';
import { framescaperProjectStoreAuthorityV27 } from './editor-project-store-v27.ts';
import { framescaperProjectStoreAuthorityV28 } from './editor-project-store-v28.ts';
import { framescaperProjectStoreAuthorityV31 } from './editor-project-store-v31.ts';
import { framescaperProjectForAuthoredFoundationV18 } from './editor-project-v18-runtime.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import { framescaperProjectV18FoundationV19 } from './editor-project-v19-validation.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v19.ts';
import { framescaperProjectV19FoundationV20 } from './editor-project-v20-validation.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import { framescaperProjectV20FoundationV27 } from './editor-project-v27-runtime.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import type { FramescaperVideoProxyCapacityStoreV18 } from './editor-video-proxy-attachment-capacity-v18.ts';

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
	/** Bounded deterministic scheduler-state seams; production uses fixed defaults. */
	readonly maximumLineageEntries?: number;
	readonly maximumLandedEntries?: number;
	readonly maximumReconciliationAttempts?: number;
}

export interface CapturedVideoProxySchedulerStore extends
	CapturedVideoProxyBodyStore, FramescaperVideoProxyCapacityStoreV18 {
	loadProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<unknown>;
	loadMediaAsset(sourceId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<Blob | null>;
	resolveLinkedVideoOriginal?: (
		projectId: string,
		source: Readonly<Record<string, unknown>>,
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<Readonly<{ readonly blob: Blob; readonly binding: unknown }> | null>;
}

export interface CapturedVideoProxySchedulerDependencies {
	readonly schemaVersion: FramescaperCapturedVideoProxySchemaVersion;
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
	readonly port: ReturnType<typeof framescaperProjectStoreAuthorityV18>['port'];
	readonly opfs: NonNullable<ReturnType<typeof framescaperProjectStoreAuthorityV18>['opfs']>;
	readonly policy: CapturedVideoProxySchedulerPolicy;
}

export function capturedVideoProxySchedulerDependenciesV18(
	environmentValue: FramescaperEditorProjectEnvironmentV18 | unknown,
	sessionValue: unknown,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): CapturedVideoProxySchedulerDependencies {
	const environment = assertFramescaperEditorProjectEnvironmentV18(environmentValue);
	const session = assertSession(sessionValue);
	const authority = framescaperProjectStoreAuthorityV18(environment.runtime.profile, environment.store);
	if (!authority.opfs) throw new TypeError('Captured V18 proxy scheduling requires exact OPFS authority.');
	return {
		schemaVersion: 18,
		profile: environment.runtime.profile,
		store: environment.store as CapturedVideoProxySchedulerStore,
		projectForRelationship: (project) => framescaperProjectForAuthoredFoundationV18(
			environment.runtime.profile,
			project,
		),
		reconcileProjectRequirements: (project) => reconcileFramescaperProjectFeatureRequirementsV18(
			environment.runtime.profile, project,
		),
		loadAuthoritativeProject: (projectId, signal) => Promise.resolve(environment.controllerStore.loadProject(
			projectId, signal ? { signal } : {},
		)),
		...(environment.controllerStore === environment.store ? {} : {
			publishDesktopProject: (project: unknown, signal?: AbortSignal, beforeFinish?: () => PromiseLike<void> | void) => (
				environment.desktopProjectLibrary!.publishProject({
					project, ...(signal ? { signal } : {}), ...(beforeFinish ? { beforeFinish } : {}),
				})
			),
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

export function capturedVideoProxySchedulerDependenciesV19(
	environmentValue: FramescaperEditorProjectEnvironmentV19 | unknown,
	sessionValue: unknown,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): CapturedVideoProxySchedulerDependencies {
	const environment = assertFramescaperEditorProjectEnvironmentV19(environmentValue);
	const session = assertSession(sessionValue);
	const authority = framescaperProjectStoreAuthorityV19(environment.runtime.profile, environment.store);
	if (!authority.opfs) throw new TypeError('Captured V19 proxy scheduling requires exact OPFS authority.');
	return {
		schemaVersion: 19,
		profile: environment.runtime.profile,
		store: environment.store as CapturedVideoProxySchedulerStore,
		projectForRelationship: (project) => framescaperProjectForAuthoredFoundationV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV18FoundationV19(environment.runtime.profile, project),
		),
		reconcileProjectRequirements: (project) => reconcileFramescaperProjectFeatureRequirementsV19(
			environment.runtime.profile, project,
		),
		loadAuthoritativeProject: (projectId, signal) => Promise.resolve(environment.store.loadProject(
			projectId, signal ? { signal } : {},
		)),
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

export function capturedVideoProxySchedulerDependenciesV20(
	environmentValue: FramescaperEditorProjectEnvironmentV20 | unknown,
	sessionValue: unknown,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): CapturedVideoProxySchedulerDependencies {
	const environment = assertFramescaperEditorProjectEnvironmentV20(environmentValue);
	const session = assertSession(sessionValue);
	const authority = framescaperProjectStoreAuthorityV20(environment.runtime.profile, environment.store);
	if (!authority.opfs) throw new TypeError('Captured V20 proxy scheduling requires exact OPFS authority.');
	return {
		schemaVersion: 20,
		profile: environment.runtime.profile,
		store: environment.store as CapturedVideoProxySchedulerStore,
		projectForRelationship: (project) => framescaperProjectForAuthoredFoundationV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV18FoundationV19(
				FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
				framescaperProjectV19FoundationV20(environment.runtime.profile, project),
			),
		),
		reconcileProjectRequirements: (project) => reconcileFramescaperProjectFeatureRequirementsV20(
			environment.runtime.profile, project,
		),
		loadAuthoritativeProject: (projectId, signal) => Promise.resolve(environment.controllerStore.loadProject(
			projectId, signal ? { signal } : {},
		)),
		...(environment.controllerStore === environment.store ? {} : {
			publishDesktopProject: (project: unknown, signal?: AbortSignal, beforeFinish?: () => PromiseLike<void> | void) => (
				environment.desktopProjectLibrary!.publishProject({
					project, ...(signal ? { signal } : {}), ...(beforeFinish ? { beforeFinish } : {}),
				})
			),
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

export function capturedVideoProxySchedulerDependenciesV27(
	environmentValue: FramescaperEditorProjectEnvironmentV27 | unknown,
	sessionValue: unknown,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): CapturedVideoProxySchedulerDependencies {
	const environment = assertFramescaperEditorProjectEnvironmentV27(environmentValue);
	const session = assertSession(sessionValue);
	const authority = framescaperProjectStoreAuthorityV27(environment.runtime.profile, environment.store);
	if (!authority.opfs) throw new TypeError('Captured V27 proxy scheduling requires exact OPFS authority.');
	return {
		schemaVersion: 27,
		profile: environment.runtime.profile,
		store: environment.store as CapturedVideoProxySchedulerStore,
		projectForRelationship: (project) => framescaperProjectForAuthoredFoundationV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV18FoundationV19(
				FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
				framescaperProjectV19FoundationV20(
					FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
					framescaperProjectV20FoundationV27(
						environment.runtime.profile,
						project as FramescaperProjectV27,
					),
				),
			),
		),
		reconcileProjectRequirements: (project) => reconcileFramescaperProjectFeatureRequirementsV27(
			environment.runtime.profile, project,
		),
		loadAuthoritativeProject: (projectId, signal) => Promise.resolve(environment.controllerStore.loadProject(
			projectId, signal ? { signal } : {},
		)),
		...(environment.controllerStore === environment.store ? {} : {
			publishDesktopProject: (project: unknown, signal?: AbortSignal, beforeFinish?: () => PromiseLike<void> | void) => (
				environment.desktopProjectLibrary!.publishProject({
					project, ...(signal ? { signal } : {}), ...(beforeFinish ? { beforeFinish } : {}),
				})
			),
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

export function capturedVideoProxySchedulerDependenciesV28(
	environmentValue: FramescaperEditorProjectEnvironmentV28 | unknown,
	sessionValue: unknown,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): CapturedVideoProxySchedulerDependencies {
	const environment = assertFramescaperEditorProjectEnvironmentV28(environmentValue);
	const session = assertSession(sessionValue);
	const authority = framescaperProjectStoreAuthorityV28(environment.runtime.profile, environment.store);
	if (!authority.opfs) throw new TypeError('Captured V28 proxy scheduling requires exact OPFS authority.');
	return {
		schemaVersion: 28,
		profile: environment.runtime.profile,
		store: environment.store as CapturedVideoProxySchedulerStore,
		projectForRelationship: (project) => framescaperProjectForAuthoredFoundationV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV18FoundationV19(
				FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
				framescaperProjectV19FoundationV20(
					FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
					framescaperProjectV20FoundationV27(
						FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
						framescaperProjectV27FoundationShapeV28(project),
					),
				),
			),
		),
		reconcileProjectRequirements: (project) => reconcileFramescaperProjectFeatureRequirementsV28(
			environment.runtime.profile, project,
		),
		loadAuthoritativeProject: (projectId, signal) => Promise.resolve(environment.controllerStore.loadProject(
			projectId, signal ? { signal } : {},
		)),
		...(environment.controllerStore === environment.store ? {} : {
			publishDesktopProject: (project: unknown, signal?: AbortSignal, beforeFinish?: () => PromiseLike<void> | void) => (
				environment.desktopProjectLibrary!.publishProject({
					project, ...(signal ? { signal } : {}), ...(beforeFinish ? { beforeFinish } : {}),
				})
			),
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

export function capturedVideoProxySchedulerDependenciesV31(
	environmentValue: FramescaperEditorProjectEnvironmentV31 | unknown,
	sessionValue: unknown,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): CapturedVideoProxySchedulerDependencies {
	const environment = assertFramescaperEditorProjectEnvironmentV31(environmentValue);
	const session = assertSession(sessionValue);
	const authority = framescaperProjectStoreAuthorityV31(environment.runtime.profile, environment.store);
	if (!authority.opfs) throw new TypeError('Captured F31 proxy scheduling requires exact OPFS authority.');
	return {
		schemaVersion: 31,
		profile: environment.runtime.profile,
		store: environment.store as CapturedVideoProxySchedulerStore,
		projectForRelationship: (project) => framescaperProjectForAuthoredFoundationV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV18FoundationV19(
				FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
				framescaperProjectV19FoundationV20(
					FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
					framescaperProjectV20FoundationV27(
						FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
						framescaperProjectV27FoundationShapeV28(
							framescaperProjectV28FoundationShapeV31(project),
						),
					),
				),
			),
		),
		reconcileProjectRequirements: (project) => reconcileFramescaperProjectFeatureRequirementsV31(
			environment.runtime.profile, project,
		),
		loadAuthoritativeProject: (projectId, signal) => Promise.resolve(environment.controllerStore.loadProject(
			projectId, signal ? { signal } : {},
		)),
		...(environment.controllerStore === environment.store ? {} : {
			publishDesktopProject: (
				project: unknown,
				signal?: AbortSignal,
				beforeFinish?: () => PromiseLike<void> | void,
			) => environment.desktopProjectLibrary!.publishProject({
				project, ...(signal ? { signal } : {}), ...(beforeFinish ? { beforeFinish } : {}),
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
