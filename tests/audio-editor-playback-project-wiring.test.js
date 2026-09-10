/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const APP_URL = new URL('../src/common/editor/app.js', import.meta.url);
const BINDINGS_URL = new URL('../src/common/editor/controller/composition/controller-bindings.ts', import.meta.url);
const SOURCE_RUNTIME_URL = new URL('../src/common/editor/controller/source/source-runtime-composition.ts', import.meta.url);

test('initial activation and later engine reapplies share the transient playback-project service', async () => {
	const [app, sourceRuntime, bindings] = await Promise.all([
		readFile(APP_URL, 'utf8'), readFile(SOURCE_RUNTIME_URL, 'utf8'), readFile(BINDINGS_URL, 'utf8'),
	]);
	assert.match(
		app,
		/import \{\s*createPlaybackProjectService,\s*\} from '\.\/controller\/source\/playback-project-service\.ts';/u,
	);
	assert.match(app,
		/const playbackProjectService = options\.playbackProjectService\s*\n\s*\|\| createPlaybackProjectService\(product\.capabilities, product\.id\);/u);
	assert.match(app, /playbackProjects: playbackProjectService/u);
	const taskOwner = sourceRuntime.match(/playbackApply = createPlaybackProjectApplyService<[^>]+>\(\{(?<body>[\s\S]*?)\n\t\}\);/u);
	assert.ok(taskOwner?.groups?.body, 'playback reapplies must have a replaceable task owner');
	assert.match(taskOwner.groups.body, /lifetime.*projectForPlayback: dependencies\.playbackProjects\.projectForPlayback/su);
	assert.match(taskOwner.groups.body, /ensureProjectSourcesAvailable.*prepareRequiredProjectSources.*sourceBuffers.*sourceChunkProviders.*engine/su);
	assert.match(bindings,
		/const \{ apply: applyProjectToPlaybackEngine \} = deferAsyncControllerMethods\(\(\) => services\.sources\(\)\.playbackApply, \['apply'\]\);/u,
		'the public playback reapply must defer to its replaceable task owner');
	assert.match(app, /loadProjectSources, prepareRequiredProjectSources: sources\.sourceLifecycle\.prepareRequiredProjectSources/iu);
	assert.match(app, /loadEngineProject:.*preparedSources\?\.sourceBuffers.*chunkSources: preparedSources\?\.chunkSources \?\? sourceChunkProviders/su);
});
