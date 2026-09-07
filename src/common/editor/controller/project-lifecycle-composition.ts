/* SPDX-License-Identifier: AGPL-3.0-only */

import { createProjectLockService, type ProjectLockServiceRuntime } from './project-lock-service.ts';
import { createProjectSwitchService, type ProjectSwitchServiceRuntime } from './project-switch-service.ts';
import type { ProjectLifecycleHistory, ProjectLifecycleProject } from './project-lifecycle-types.ts';

type LockPort = 'acquireProjectLock' | 'releaseProjectLock' | 'watchProjectLockLoss' | 'scheduleProjectLockRecovery';

export interface ProjectLifecycleCompositionDependencies<
	Project extends ProjectLifecycleProject, History extends ProjectLifecycleHistory<Project>,
> {
	readonly locking: ProjectLockServiceRuntime;
	readonly projects: Omit<ProjectSwitchServiceRuntime<Project, History>, LockPort>;
}

/** Every activation acquires, watches, and releases leases through one owner. */
export function createProjectLifecycleComposition<
	Project extends ProjectLifecycleProject, History extends ProjectLifecycleHistory<Project>,
>(dependencies: ProjectLifecycleCompositionDependencies<Project, History>) {
	const locking = createProjectLockService(dependencies.locking);
	const projects = createProjectSwitchService({
		...dependencies.projects,
		acquireProjectLock: dependencies.locking.acquireProjectLock,
		releaseProjectLock: locking.releaseProjectLock,
		watchProjectLockLoss: locking.watchProjectLockLoss,
		scheduleProjectLockRecovery: locking.scheduleProjectLockRecovery,
	});
	return Object.freeze({ locking, projects });
}
