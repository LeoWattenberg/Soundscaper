/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planFramescaperScapeImageExportAssetsV32 } from '../src/framescaper/editor-scape-asset-plan-v32.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import {
	createFramescaperProjectStoreV32,
	framescaperProjectStoreAuthorityV32,
} from '../src/framescaper/editor-project-store-v32.ts';
import { createFramescaperProjectV32 } from '../src/framescaper/editor-project-v32.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { addFramescaperV32BoundaryImage } from './helpers/framescaper-v32-boundary-fixture.ts';

const PROFILE = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;

/**
 * The publisher is the only writer the Add Images surface uses, so a body it
 * stores has to satisfy the readers that later export, paste and re-import it.
 * Seeding the metadata by hand would test the readers against themselves.
 */
test('a body written by the image publisher is accepted by the Scape export reader', async () => {
	const projectId = `publication-readback-${String(Date.now())}`;
	const store = createFramescaperProjectStoreV32(PROFILE);
	await store.ready();
	const base = createFramescaperProjectV32(PROFILE, { ...framescaperV20Options(), id: projectId });
	assert.ok(await store.createProjectIfAbsent(base));

	const fixture = addFramescaperV32BoundaryImage(base, projectId);
	const published = await framescaperProjectStoreAuthorityV32(PROFILE, store)
		.timelineImages.publishIfCurrent({
			expected: base,
			project: fixture.project,
			bytes: fixture.bytes,
		});
	assert.ok(published, 'the fixture publication is current');

	const planned = await planFramescaperScapeImageExportAssetsV32(fixture.project, store);
	assert.equal(planned.length, 1, 'the published image is planned into the archive');
	assert.equal(planned[0]?.storageKey, fixture.source.storageKey);
});
