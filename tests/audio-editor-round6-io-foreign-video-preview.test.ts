/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { productVideoVisualPreviewRuntimeFor } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { bindFramescaperSelectedImagePreviewControllerTimelineImage as bindPreview } from '../src/framescaper/editor-selected-timeline-image-image-preview-controller.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from '../src/framescaper/editor-project-assistance-foundation.ts';
import { materializeFramescaperSelectedMulticameraVisualPreviewProject } from '../src/framescaper/editor-selected-multicamera-visual-preview-project.ts';

function preview() {
	const owner = {};
	bindPreview({
		controller: owner, profile: PROFILE, store: {} as AudioEditorProjectStore,
		cloneProject: (_profile, project) => materializeFramescaperSelectedMulticameraVisualPreviewProject(
			PROFILE, framescaperProjectTimelineImageFoundationShapeAssistance(project),
		) as never,
	});
	const runtime = productVideoVisualPreviewRuntimeFor(owner);
	assert.ok(runtime);
	return runtime;
}

test('ordinary foreign Soundscaper custody has no executable Framescaper preview', async () => {
	const runtime = preview();
	const project = createSoundscaperProject({});
	assert.equal(await runtime.create({ project, width: 320, height: 180 }), null);
	assert.equal(await runtime.createProjectBinThumbnail?.({ project, width: 320, height: 180, clipId: 'absent' }), null);
	assert.equal(await runtime.createTimelineFilmstrip?.({ project, width: 320, height: 180, frames: [] }), null);
});

test('a normal current Framescaper document still reaches its preview factory', async () => {
	const runtime = preview();
	const project = createFramescaperProject(PROFILE);
	assert.equal(await runtime.create({ project, width: 320, height: 180 }), null);
	assert.equal(await runtime.createProjectBinThumbnail?.({ project, width: 320, height: 180, clipId: 'absent' }), null);
	assert.deepEqual(await runtime.createTimelineFilmstrip?.({ project, width: 320, height: 180, frames: [] }), []);
});

test('current-domain validation failures remain visible rather than becoming an empty preview', async () => {
	const runtime = preview();
	const project = createFramescaperProject(PROFILE);
	await assert.rejects(runtime.create({ project: { ...project, sampleRate: 0 }, width: 320, height: 180 }), RangeError);
});
