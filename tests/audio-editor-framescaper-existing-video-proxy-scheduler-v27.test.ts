/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperExistingVideoProxySchedulerV27 } from '../src/framescaper/editor-existing-video-proxy-scheduler.ts';
import type { FramescaperEditorProjectEnvironmentV27 } from '../src/framescaper/editor-project-environment-v27.ts';
import {
	capturedProxyRequest,
	capturedProxyStorageInventory,
	capturedVideoSource,
	createCapturedProxyFixture,
} from './helpers/framescaper-captured-video-proxy-fixture.ts';
import { ORIGINAL_SOURCE_ID } from './helpers/video-proxy-relationship-fixtures.ts';

test('a selected V27 pathless existing proxy publishes atomically into project history', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 27);
	const schedule = createFramescaperExistingVideoProxySchedulerV27(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV27>,
		fixture.session,
		{
			runtime: null,
			helperTimingProbe: fixture.relationship.candidateDependencies.probes[0],
		},
		fixture.relationship.candidate(),
	);
	context.after(() => schedule.dispose());

	await schedule(capturedProxyRequest(
		fixture.origin,
		ORIGINAL_SOURCE_ID,
		fixture.originalSha256,
	));

	const committed = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	assert.ok(committed);
	const attachment = capturedVideoSource(committed, ORIGINAL_SOURCE_ID).proxyAttachment;
	assert.ok(attachment);
	assert.equal(attachment.generatorId, 'framescaper-pathless-existing-proxy');
	assert.equal(attachment.recipeId, 'framescaper-existing-video-proxy-v1');
	const originTab = fixture.session.getSnapshot().tabs.find(
		({ projectId }: { projectId: string }) => projectId === fixture.origin.id,
	);
	assert.equal(
		(originTab?.history.undoStack as readonly Readonly<{ command?: { type?: string } }>[])
			.at(-1)?.command?.type,
		'framescaper/video-proxy-attach',
	);
	assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
		bodyKeys: [attachment.storageKey, attachment.timingAsset.storageKey].sort(),
		claimKeys: [],
		tombstoneKeys: [],
	});
});
