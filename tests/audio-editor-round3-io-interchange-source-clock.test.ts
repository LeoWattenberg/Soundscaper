/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectEdlExport } from '../src/common/editor/edl-project-adapter.ts';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function trimmedProject(sourceRate = { num: 25, den: 1 }, sourceInFrame = 250) {
	return projectForRuntimeConsumers(createSoundscaperProject({
		id: 'trimmed-interchange', now: '2026-10-07T10:00:00.000Z', sampleRate: 48_000,
		sources: [createVideoSource({
			id: 'camera', name: 'camera.webm', storageKey: 'camera.webm', mimeType: 'video/webm',
			frameRate: sourceRate, sourceFrameCount: 3_000, sampleFrameCount: 48_000 * 120,
			sampleRate: 48_000, width: 96, height: 54,
		})],
		clips: [{
			id: 'take', kind: 'video', sourceId: 'camera', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 250, sourceInFrame, sourceFrameCount: 250,
		}],
		tracks: [createVideoTrack({ id: 'picture', name: 'Picture', clipIds: ['take'] })],
		sequences: [{
			id: 'main', name: 'Main', rate: { num: 25, den: 1 },
			trackNodes: [{ kind: 'track', id: 'picture', parentFolderId: null }],
		}], primarySequenceId: 'main',
	}) as never) as unknown as Readonly<Record<string, unknown>>;
}

for (const [sourceRate, sourceInFrame] of [[{ num: 25, den: 1 }, 250], [{ num: 50, den: 1 }, 500]] as const) {
	test(`FCPXML keeps a ten-second source trim at ${sourceRate.num} fps`, () => {
		const result = createFcpxmlExport({ project: trimmedProject(sourceRate, sourceInFrame), sequenceRate: { num: 25, den: 1 } });
		assert.match(result.text, /<asset-clip[^>]* start="10s"/u);
		assert.match(result.text, /<asset-clip[^>]* duration="10s"/u);
	});
	test(`EDL keeps a ten-second source trim at ${sourceRate.num} fps`, () => {
		const result = createProjectEdlExport({ project: trimmedProject(sourceRate, sourceInFrame) });
		const event = result.text.split('\n').find((line) => /^001\s/u.test(line));
		assert.deepEqual(event?.trim().split(/\s+/u).slice(4, 8), [
			'00:00:10:00', '00:00:20:00', '00:00:00:00', '00:00:10:00',
		]);
	});
}
