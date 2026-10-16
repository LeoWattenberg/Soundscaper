/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createFramescaperAudioEditorController } from '../../src/framescaper/editor-controller.ts';
import type { FramescaperEditorProjectEnvironment } from '../../src/framescaper/editor-project-environment.ts';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, PROJECT_SCHEMA_VERSION, type FramescaperProject } from '../../src/framescaper/editor-project.ts';

export async function createFramescaperFixtureController(
	environment: FramescaperEditorProjectEnvironment,
	projectId: string,
): Promise<ReturnType<typeof createFramescaperAudioEditorController>> {
	await environment.store.saveSetting('framescaper:last-project-id', projectId);
	return createFramescaperAudioEditorController(environment);
}

export function framescaperPublishedProject(project: unknown): FramescaperProject {
	assert.ok(project !== null && typeof project === 'object');
	const identity = project as Readonly<Record<string, unknown>>;
	assert.equal(identity.schemaFamily, FRAMESCAPER_PROJECT_SCHEMA_FAMILY);
	assert.equal(identity.schemaVersion, PROJECT_SCHEMA_VERSION);
	assert.equal(Object.isFrozen(project), true, 'the controller must publish an immutable project view');
	return project as FramescaperProject;
}
