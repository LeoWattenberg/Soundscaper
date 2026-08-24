/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { applyFramescaperProjectCommandV28 } from '../src/framescaper/editor-project-v28-commands.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('selected V28 retains a changed inherited re-probe instead of stale professional facts', () => {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[]).find(({ kind }) => kind === 'video');
	assert.ok(source);
	const rate = source.frameRate as Readonly<{ num: number; den: number }>;
	source.characteristics = normalizeVideoSourceCharacteristicsV25({
		backend: 'native-helper', codedWidth: 1_920, codedHeight: 1_080,
		bitDepth: 10, pixelFormat: 'yuv420p10le', chromaFormat: '4:2:0',
	}, { rate });
	const project = createFramescaperProjectV28(profile, options);
	const changed = normalizeVideoSourceCharacteristics({
		backend: 'ffmpeg', codedWidth: 1_280, codedHeight: 720,
	}, { rate });

	const updated = applyFramescaperProjectCommandV28(profile, project, {
		type: 'source/reprobe', sourceId: 'video-source',
		changes: { characteristics: changed }, clips: [],
	});
	const reprobed = updated.sources.find(({ id }) => id === 'video-source');
	assert.ok(reprobed?.kind === 'video');
	const characteristics = reprobed.characteristics as ReturnType<typeof normalizeVideoSourceCharacteristicsV25>;
	assert.equal(characteristics.backend, 'ffmpeg');
	assert.equal(characteristics.codedWidth, 1_280);
	assert.equal(characteristics.codedHeight, 720);
	assert.equal(characteristics.bitDepth, null);
	assert.equal(characteristics.pixelFormat, null);
});
