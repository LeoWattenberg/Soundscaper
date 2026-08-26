/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sampleFrameToVideoFrame } from '../src/common/editor/timeline-time.ts';
import {
	framescaperCandidateAuthoringActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import {
	bindFramescaperSelectedImageAuthoringControllerV32,
	framescaperSelectedImageImportResultV32For,
} from '../src/framescaper/editor-selected-v32-image-authoring-controller.ts';
import type {
	FramescaperTimelineImageImportRequestV32,
} from '../src/framescaper/editor-image-import-coordinator-v32.ts';
import { createFramescaperProjectHistoryV32 } from '../src/framescaper/editor-project-v32-history.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import { createFramescaperProjectV32 } from '../src/framescaper/editor-project-v32.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('the V32 Add Images action sends the ordered multi-selection to the video playhead', async () => {
	const project = createFramescaperProjectV32(
		FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, framescaperV20Options(),
	);
	const history = createFramescaperProjectHistoryV32(
		FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, project,
	);
	const files = [file('first.png'), file('second.gif')];
	const requests: FramescaperTimelineImageImportRequestV32[] = [];
	const playheadSample = Number(project.sampleRate) * 2;
	const controller = {
		project,
		getTelemetrySnapshot: () => ({ positionFrame: playheadSample }),
		actions: { project: { openById: () => undefined } },
	};
	bindFramescaperSelectedImageAuthoringControllerV32({
		controller,
		session: {
			captureProjectHistory: () => ({ history, token: Object.freeze({}) }),
			assertProjectHistoryToken: () => undefined,
			updateProjectHistory: () => undefined,
			markProjectSaved: () => undefined,
			getProjectHistory: () => history,
		},
		executeCommand: (value) => value,
		publishIfCurrent: async () => null,
		selectFiles: async () => files,
		createId: (prefix) => `${prefix}-test`,
		importImages: async (value) => {
			requests.push(value);
			return {
				project,
				files: files.map((selected, index) => ({
					fileName: selected.name, status: 'imported' as const,
					sourceId: `source-${String(index)}`, clipId: `clip-${String(index)}`,
					notices: [], message: null,
				})),
			};
		},
	});
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.deepEqual(runtime?.surfaces, ['video-still']);
	await runtime?.run('video-still');
	const request = requests[0];
	assert.ok(request);
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId);
	assert.ok(sequence);
	assert.equal(request.sequenceStartFrame, sampleFrameToVideoFrame(
		playheadSample, sequence.rate, Number(project.sampleRate), 'enclosingStart',
	));
	assert.equal(request.files, files);
	assert.deepEqual(
		framescaperSelectedImageImportResultV32For(controller)?.files.map(({ fileName }) => fileName),
		['first.png', 'second.gif'],
	);
});

function file(name: string) {
	const bytes = Uint8Array.of(1, 2, 3);
	return {
		name, type: name.endsWith('.gif') ? 'image/gif' : 'image/png', size: bytes.byteLength,
		async arrayBuffer() { return bytes.slice().buffer; },
	};
}
