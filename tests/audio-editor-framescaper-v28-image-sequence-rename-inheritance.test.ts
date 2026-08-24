/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeNativeMediaImageSequenceSourceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import {
	createUnreportedVideoSourceCharacteristicsV25,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { applyFramescaperProjectCommandV28 } from '../src/framescaper/editor-project-v28-commands.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import {
	createFramescaperProjectV28,
	validateFramescaperProjectV28,
} from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const SOURCE_SHA256 = '41'.repeat(32);
const INVENTORY_SHA256 = '42'.repeat(32);

test('selected V28 source rename updates and preserves canonical image-sequence authority', () => {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[]).find(({ kind }) => kind === 'video');
	assert.ok(source);
	const characteristics = createUnreportedVideoSourceCharacteristicsV25();
	Object.assign(source, {
		storageKey: `image-sequence-pack-sha256:${SOURCE_SHA256}`,
		contentSha256: SOURCE_SHA256,
		characteristics,
		imageSequence: imageSequence(characteristics),
	});
	const project = createFramescaperProjectV28(profile, options);
	const prior = project.sources.find(({ id }) => id === 'video-source');
	assert.ok(prior?.kind === 'video' && prior.imageSequence !== null);

	const renamed = applyFramescaperProjectCommandV28(profile, project, {
		type: 'source/update', sourceId: 'video-source', changes: { name: 'Renamed plate' },
	});
	const updated = renamed.sources.find(({ id }) => id === 'video-source');
	assert.ok(updated?.kind === 'video' && updated.imageSequence !== null);
	assert.equal(updated.name, 'Renamed plate');
	assert.deepEqual(updated.imageSequence, {
		...prior.imageSequence,
		name: 'Renamed plate',
	});
	assert.equal(validateFramescaperProjectV28(profile, renamed), true);
});

function imageSequence(characteristics: ReturnType<typeof createUnreportedVideoSourceCharacteristicsV25>) {
	return normalizeNativeMediaImageSequenceSourceV25({
		kind: 'video', sourceType: 'image-sequence', version: 1,
		id: 'video-source', name: 'Video', stem: 'plate.', extension: 'png',
		frameNumberWidth: 4, firstFrameNumber: 1, lastFrameNumber: 10,
		frameCount: 10, frameRate: { num: 10, den: 1 },
		inventory: {
			kind: 'image-sequence-inventory', version: 1,
			storageKey: `image-sequence-inventory-sha256:${INVENTORY_SHA256}`,
			sha256: INVENTORY_SHA256, byteLength: 512, frameCount: 10,
			firstFrameNumber: 1, lastFrameNumber: 10,
		},
		sourcePack: {
			kind: 'image-sequence-source-pack',
			storageKey: `image-sequence-pack-sha256:${SOURCE_SHA256}`,
			sha256: SOURCE_SHA256, byteLength: 8_192,
		},
		characteristics,
	});
}
