/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectDocument } from './project-repository.ts';

/** A project publication committed, but later revision or linked-source maintenance failed. */
export class ProjectCommittedMaintenanceError extends Error {
	readonly committed = true;
	readonly committedProject: ProjectDocument;

	constructor(committedProject: ProjectDocument, cause: unknown) {
		super(`Project ${committedProject.id} committed, but post-commit maintenance failed.`, { cause });
		this.name = 'ProjectCommittedMaintenanceError';
		this.committedProject = committedProject;
	}
}
