/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptsFile, mimeTypeForPath, validateFileChoice } from '../desktop/validation.js';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { bindFramescaperSelectedImageAuthoringControllerTimelineImage,
	type BindFramescaperSelectedImageAuthoringControllerTimelineImageOptions,
} from '../src/framescaper/editor-selected-timeline-image-image-authoring-controller.ts';
import type { FramescaperImageImportFileTimelineImage } from '../src/framescaper/editor-image-import-coordinator-timeline-image.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import { createFramescaperProjectHistoryTimelineImage } from '../src/framescaper/editor-project-timeline-image-history.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createPngFixture } from './helpers/png-fixture.mjs';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';

test('the existing Add Images menu uses its specific maintained raster chooser', () => {
	const extensions = ['jpg', 'jpeg', 'png', 'apng', 'gif', 'webp', 'bmp'];
	const choice = validateFileChoice({ purpose: 'image', multiple: true });
	assert.deepEqual(choice.extensions, extensions);
	assert.deepEqual(choice.filters, [{ name: 'Images', extensions }]);
	for (const extension of extensions) {
		assert.equal(acceptsFile('image', `poster.${extension.toUpperCase()}`), true);
		assert.match(mimeTypeForPath(`poster.${extension}`), /^image\//u);
		assert.equal(acceptsFile('media', `poster.${extension}`), false);
		assert.equal(acceptsFile('project', `poster.${extension}`), false);
	}
	for (const extension of ['wav', 'srt', 'svg', 'avif', 'tiff', 'html']) {
		assert.equal(acceptsFile('image', `poster.${extension}`), false);
	}
});

for (const desktop of [false, true]) {
	test(`Generate reads a normal ${desktop ? 'native' : 'browser'} image before retiring its file authority`, async (context) => {
		const png = createPngFixture(16);
		const fixture = desktop ? await nativeSidecarFixture('poster.png', png) : null;
		if (fixture) context.after(fixture.close);
		const project = createFramescaperProjectTimelineImage(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {});
		const history = createFramescaperProjectHistoryTimelineImage(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project);
		const controller = { project, getTelemetrySnapshot: () => ({ positionFrame: 0 }),
			actions: { project: { openById: () => undefined, flush: () => undefined } } };
		let consumed = 0;
		let retained: FramescaperImageImportFileTimelineImage | undefined;
		const options: BindFramescaperSelectedImageAuthoringControllerTimelineImageOptions = {
			controller,
			session: { captureProjectHistory: () => ({ token: project, history }),
				assertProjectHistoryToken: () => undefined, updateProjectHistory: () => undefined,
				markProjectSaved: () => undefined, getProjectHistory: () => history },
			executeCommand: () => history, publishIfCurrent: async () => project,
			...(fixture ? { fileService: createAudioEditorFileService({ bridge: fixture.bridge, fetch: fixture.fetch }) }
				: { selectFiles: async () => [new File([png], 'poster.png', { type: 'image/png' })] }),
			importImages: async (request) => {
				retained = request.files[0];
				if (desktop) assert.ok(Object.isFrozen(request.files));
				assert.deepEqual(new Uint8Array(await request.files[0]!.arrayBuffer()), new Uint8Array(png));
				await Promise.resolve();
				assert.equal(fixture?.releases.length ?? 0, 0, 'retain the scope through the complete image consumer');
				consumed += 1;
				return { project, files: [{ fileName: 'poster.png', status: 'imported', sourceId: 'image', clipId: 'clip', notices: [], message: null }] };
			},
		};
		bindFramescaperSelectedImageAuthoringControllerTimelineImage(options);
		await framescaperCandidateAuthoringActionRuntimeFor(controller)!.run('video-still');
		assert.equal(consumed, 1);
		if (fixture) {
			assert.equal(fixture.releases.length, 1);
			await assert.rejects(() => retained!.arrayBuffer(), /scope was released/u);
		}
	});
}
