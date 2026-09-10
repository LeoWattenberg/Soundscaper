/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createProjectAdminService, ProjectHandoffExpectation } from './project-admin-service.ts';
import type { AdminCloseOptions } from './internal/project/project-admin-runtime.ts';

type Administration = Pick<ReturnType<typeof createProjectAdminService>,
	'prepareProjectHandoff' | 'assertProjectHandoffAllowed' | 'closeProjectTab' | 'deleteProject' | 'clearLocalData'>;

export interface ProjectAdministrationCaptureGuard {
	assertOriginHandoffAllowed(projectId: string): void;
	assertOriginCloseAllowed(projectId: string): void;
	assertOriginDeleteAllowed(projectId: string): void;
	originSnapshot(): Readonly<{ origin: Readonly<{ projectId: string }> | null }>;
}

/** Capture owns its origin fence; administration retains the actual close/delete/reset lifecycle. */
export function bindProjectAdministrationActions(
	service: Administration,
	getProject: () => Readonly<{ id: string }> | null,
	getCapture: () => ProjectAdministrationCaptureGuard | null,
) {
	function assertOriginHandoffAllowed(): void {
		const project = getProject();
		if (project) getCapture()?.assertOriginHandoffAllowed(project.id);
	}
	return Object.freeze({
		async prepareProjectHandoff(expected?: Readonly<ProjectHandoffExpectation>) {
			assertOriginHandoffAllowed();
			return service.prepareProjectHandoff(expected);
		},
		assertProjectHandoffAllowed() {
			assertOriginHandoffAllowed();
			service.assertProjectHandoffAllowed();
		},
		async closeProjectTab(projectId: string | undefined = getProject()?.id, options: AdminCloseOptions = {}) {
			if (projectId) getCapture()?.assertOriginCloseAllowed(projectId);
			return service.closeProjectTab(projectId, options);
		},
		async deleteProject() {
			const project = getProject();
			if (project) getCapture()?.assertOriginDeleteAllowed(project.id);
			return service.deleteProject();
		},
		async clearLocalData() {
			const capture = getCapture();
			const origin = capture?.originSnapshot().origin;
			if (capture && origin) capture.assertOriginDeleteAllowed(origin.projectId);
			return service.clearLocalData();
		},
	});
}
