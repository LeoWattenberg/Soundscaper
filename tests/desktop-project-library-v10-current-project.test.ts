/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	validateFramescaperDesktopCurrentProjectV18,
} from '../desktop/project-library-v10-current-project.ts';
import {
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import {
	createFramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';

const NOW = '2026-08-13T12:00:00.000Z';

test('accepts only exact validated Framescaper V18 documents', () => {
	const project = createFramescaperProjectV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{
			id: 'desktop-v10-project',
			title: 'Desktop V10 project',
			now: NOW,
			sources: [createVideoSource({
				id: 'video-source',
				name: 'Video source',
				storageKey: 'video-source',
				mimeType: 'video/mp4',
				contentSha256: 'a'.repeat(64),
				frameCount: 48_000,
				sampleFrameCount: 48_000,
				sourceFrameCount: 10,
				frameRate: { num: 10, den: 1 },
				width: 1920,
				height: 1080,
			})],
		},
	);
	assert.equal(validateFramescaperDesktopCurrentProjectV18(project), project);
	assert.equal(project.schemaVersion, 18);
	assert.equal(project.sources[0]?.proxyAttachment, null);

	const v17 = createAudioEditorProjectV17({ id: 'legacy-v17', title: 'Legacy', now: NOW });
	assert.throws(() => validateFramescaperDesktopCurrentProjectV18(v17), /schema.*18|unsupported/iu);
	assert.throws(() => validateFramescaperDesktopCurrentProjectV18({
		...project,
		schemaVersion: 19,
	}), /schema.*18|unsupported/iu);
});

test('authenticates the local profile before traversing project data', () => {
	let projectTraps = 0;
	const project = new Proxy({}, {
		getPrototypeOf() { projectTraps += 1; throw new Error('project trap'); },
		ownKeys() { projectTraps += 1; throw new Error('project trap'); },
		getOwnPropertyDescriptor() { projectTraps += 1; throw new Error('project trap'); },
		get() { projectTraps += 1; throw new Error('project trap'); },
	});
	assert.throws(
		() => validateFramescaperDesktopCurrentProjectV18(project, {}, {}),
		/exact Framescaper V18 runtime profile/iu,
	);
	assert.equal(projectTraps, 0);
	assert.throws(
		() => validateFramescaperDesktopCurrentProjectV18(
			project,
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			{},
		),
		/project trap/iu,
	);
});
