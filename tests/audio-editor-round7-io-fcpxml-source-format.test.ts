/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { exportProjectFcpxml } from '../src/common/editor/controller/export/interchange-export-action.ts';

for (const sequenceRate of [25, 30]) test(`FCPXML keeps 25 fps source media separate from its ${sequenceRate} fps sequence format`, async () => {
	const source = createVideoSource({ id: 'camera', name: 'Camera.mp4', storageKey: 'media/camera.mp4',
		mimeType: 'video/mp4', contentSha256: '216d2748682d236b45fc6c0712be44acdd4d0b14aa3e714cc67153dcc82a79e2',
		sampleFrameCount: 42_240, sourceFrameCount: 22, frameRate: { num: 25, den: 1 }, width: 192, height: 144,
	});
	const project = createFramescaperProject(PROFILE, { id: 'programme', sampleRate: 48_000,
		sources: [source],
		clips: [{ kind: 'video', id: 'picture', title: 'Camera', sourceId: source.id, sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: Math.floor(22 * sequenceRate / 25), sourceInFrame: 0, sourceFrameCount: 22 }],
		tracks: [{ id: 'video', name: 'Video', type: 'video', clipIds: ['picture'] }],
		sequences: [{ id: 'main-sequence', name: 'Main', rate: { num: sequenceRate, den: 1 }, trackIds: ['video'] }],
	});
	const result = await exportProjectFcpxml({ getProject: () => project, state: {}, fileService: { saveFile: () => true } });
	assert.ok(result);
	const formatId = result.text.match(/<asset\b[^>]*\bformat="([^"]+)"/u)?.[1];
	assert.ok(formatId);
	const formats = [...result.text.matchAll(/<format\b[^>]*id="([^"]+)"[^>]*frameDuration="([^"]+)"/gu)];
	assert.equal(formats.find(match => match[1] === formatId)?.[2], '1/25s');
	assert.match(result.text, new RegExp(`<format id="${formatId}"[^>]*width="192"[^>]*height="144"`, 'u'));
	assert.match(result.text, /<sequence format="r1"/u);
	assert.equal(formats.find(match => match[1] === 'r1')?.[2], `1/${sequenceRate}s`);
});

test('FCPXML source formats share equal coded geometry and preserve a reported anamorphic camera', async () => {
	const sources = ['one', 'two', 'anamorphic'].map(id => createVideoSource({ id, name: `${id}.mp4`,
		storageKey: `media/${id}.mp4`, mimeType: 'video/mp4', contentSha256: 'ab'.repeat(32),
		sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: { num: 25, den: 1 },
		width: id === 'anamorphic' ? 204 : 192, height: 144,
		...(id === 'anamorphic' ? { characteristics: { codedWidth: 192, codedHeight: 144, pixelAspectRatio: { num: 16, den: 15 } } } : {}),
	}));
	const project = createFramescaperProject(PROFILE, { id: 'programme', sources,
		clips: sources.map((source, index) => ({ kind: 'video', id: `picture-${index}`, title: source.name,
			sourceId: source.id, sequenceId: 'main-sequence', sequenceStartFrame: index * 30,
			sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 25 })),
		tracks: [{ type: 'video', id: 'video', name: 'Video', clipIds: ['picture-0', 'picture-1', 'picture-2'] }],
	});
	const result = await exportProjectFcpxml({ getProject: () => project, state: {}, fileService: { saveFile: () => true } });
	assert.ok(result);
	const formats = [...result.text.matchAll(/<asset\b[^>]*\bformat="([^"]+)"/gu)].map(match => match[1]);
	assert.equal(formats[0], formats[1]);
	assert.notEqual(formats[0], formats[2]);
	assert.match(result.text, new RegExp(`<format id="${formats[2]}"[^>]*width="192"[^>]*height="144"[^>]*paspH="16"[^>]*paspV="15"`, 'u'));
});
