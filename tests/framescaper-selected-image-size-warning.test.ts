/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFramescaperSelectedImageAuthoringControllerTimelineImage as bind } from '../src/framescaper/editor-selected-timeline-image-image-authoring-controller.ts';
import { framescaperCandidateAuthoringActionRuntimeFor as runtimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectHistoryTimelineImage } from '../src/framescaper/editor-project-timeline-image-history.ts';
import type { FramescaperTimelineImageImportRequestTimelineImage } from '../src/framescaper/editor-image-import-coordinator-timeline-image.ts';

test('image authoring forwards its warning callback and rejects a changed project after a decision', async () => {
	const project = createFramescaperProjectTimelineImage(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {});
	const history = createFramescaperProjectHistoryTimelineImage(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project);
	const controller = {
		project,
		getTelemetrySnapshot: () => ({ positionFrame: 0 }),
		actions: { project: { openById: async () => undefined, flush: async () => undefined } },
	};
	const imports: FramescaperTimelineImageImportRequestTimelineImage[] = [];
	const confirmFileSizeWarning = async (): Promise<boolean> => true;
	bind({
		controller,
		session: {
			captureProjectHistory: () => ({ token: 'token', history }),
			assertProjectHistoryToken: () => undefined,
			updateProjectHistory: () => undefined,
			markProjectSaved: () => undefined,
			getProjectHistory: () => history,
		},
		executeCommand: () => history,
		publishIfCurrent: async () => project,
		selectFiles: async () => [{ name: 'shot.png', size: 8, type: 'image/png', arrayBuffer: async () => new ArrayBuffer(8) }],
		confirmFileSizeWarning,
		importImages: async (request) => { imports.push(request); return { project, files: [] }; },
	});
	await runtimeFor(controller)!.run('video-still');
	assert.equal(imports[0]!.confirmFileSizeWarning, confirmFileSizeWarning);
	const assertCurrent = imports[0]!.assertCurrent!;
	assert.doesNotThrow(assertCurrent);
	controller.project = { ...project, id: 'replaced-project' };
	assert.throws(assertCurrent, /project changed/u);
});
