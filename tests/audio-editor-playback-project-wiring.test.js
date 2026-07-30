/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const APP_URL = new URL('../src/common/editor/app.js', import.meta.url);

test('initial activation and later engine reapplies share the transient playback-project service', async () => {
	const app = await readFile(APP_URL, 'utf8');
	assert.match(
		app,
		/import \{\s*createPlaybackProjectApplyService,\s*createPlaybackProjectService,\s*\} from '\.\/controller\/playback-project-service\.ts';/u,
	);
	assert.match(app, /const playbackProjectService = createPlaybackProjectService\(product\.capabilities\);/u);
	const taskOwner = app.match(/const playbackProjectApplyService = createPlaybackProjectApplyService\(\{(?<body>[\s\S]*?)\n\t\}\);/u);
	assert.ok(taskOwner?.groups?.body, 'playback reapplies must have a replaceable task owner');
	assert.match(taskOwner.groups.body, /lifetime.*projectForPlayback: playbackProjectService\.projectForPlayback/u);
	assert.match(taskOwner.groups.body, /ensureProjectSourcesAvailable.*prepareRequiredProjectSources.*sourceBuffers.*sourceChunkProviders.*engine/su);
	const applyOwner = app.match(/function applyProjectToPlaybackEngine\(snapshot\) \{(?<body>[\s\S]*?)\n\t\}/u);
	assert.ok(applyOwner?.groups?.body, 'the playback reapply owner must remain a focused function');
	assert.match(applyOwner.groups.body, /playbackProjectApplyService\.apply\(snapshot\)/u);
	assert.doesNotMatch(applyOwner.groups.body, /engine\.applyProject/u);
	assert.match(app, /loadProjectSources, prepareRequiredProjectSources: sourceLifecycleService\.prepareRequiredProjectSources/iu);
	assert.match(app, /loadEngineProject:.*preparedSources\?\.sourceBuffers.*chunkSources: preparedSources\?\.chunkSources \?\? sourceChunkProviders/su);
});
