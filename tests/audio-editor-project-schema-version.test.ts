/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as schema from '../src/common/editor/project-schema-version.ts';

const ACTIVE_AUDIO_SCHEMAS = [
	schema.AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION,
	schema.SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	schema.SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
] as const;

const ACTIVE_AUDIO_PREDICATES = [
	schema.isFoundationProjectSchema,
	schema.isActiveAudioEditorProjectSchema,
	schema.isTimelineAnnotationProjectSchema,
	schema.isTrackFolderProjectSchema,
	schema.isSourceCharacteristicsProjectSchema,
	schema.isTrackLockProjectSchema,
	schema.isVideoRetimeCurveProjectSchema,
	schema.isTakeCompProjectSchema,
	schema.isAudioWarpProjectSchema,
] as const;

test('shared project predicates admit only active audio-authoring schemas', () => {
	for (const predicate of ACTIVE_AUDIO_PREDICATES) {
		for (const active of ACTIVE_AUDIO_SCHEMAS) assert.equal(predicate(active), true);
		for (let retired = 10; retired <= 16; retired += 1) assert.equal(predicate(retired), false);
		for (const other of [null, undefined, 18, 19, 20, 22, 24, '17']) {
			assert.equal(predicate(other), false);
		}
	}
});

test('schema constants expose selected and dormant candidate identities explicitly', () => {
	assert.equal(schema.AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 17);
	assert.equal(schema.FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION, 19);
	assert.equal(schema.FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION, 20);
	assert.equal(schema.SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION, 21);
	assert.equal(schema.FRAMESCAPER_PROJECT_V22_SCHEMA_VERSION, 22);
	assert.equal(schema.SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION, 23);
	assert.equal(schema.FRAMESCAPER_PROJECT_V24_SCHEMA_VERSION, 24);
	assert.equal(schema.FRAMESCAPER_PROJECT_V25_SCHEMA_VERSION, 25);
	assert.equal(schema.FRAMESCAPER_PROJECT_V26_SCHEMA_VERSION, 26);
	for (let retired = 10; retired <= 16; retired += 1) {
		assert.equal(`AUDIO_EDITOR_PROJECT_V${String(retired)}_SCHEMA_VERSION` in schema, false);
	}
});

test('product-specific predicates retain their exact maintained schema sets', () => {
	for (const active of [17, 19, 20, 21, 23]) {
		assert.equal(schema.isMaintainedProjectFeatureSchema(active), true);
		assert.equal(schema.isMaintainedRenderedFallbackProjectSchema(active), true);
	}
	assert.equal(schema.isMaintainedProjectFeatureSchema(18), false);
	for (const candidate of [22, 24, 25, 26]) {
		assert.equal(schema.isMaintainedProjectFeatureSchema(candidate), false);
		assert.equal(schema.isMaintainedRenderedFallbackProjectSchema(candidate), false);
	}
	assert.equal(schema.isSoundscaperProductionProjectSchema(21), true);
	assert.equal(schema.isSoundscaperProductionProjectSchema(23), true);
	assert.equal(schema.isSoundscaperProductionProjectSchema(17), false);
	assert.equal(schema.isMasteringSequenceProjectSchema(23), true);
	assert.equal(schema.isMasteringSequenceProjectSchema(21), false);
	for (const version of [18, 19, 20]) {
		assert.equal(schema.isFramescaperSequenceProjectSchema(version), true);
		assert.equal(schema.isFramescaperCaptureProjectSchema(version), true);
	}
	assert.equal(schema.isFramescaperSequenceProjectSchema(21), false);
	assert.equal(schema.isFramescaperCaptureProjectSchema(21), false);
	assert.equal(schema.isFramescaperVideoCompositionProjectSchema(19), true);
	assert.equal(schema.isFramescaperVideoCompositionProjectSchema(20), true);
	assert.equal(schema.isFramescaperVideoCompositionProjectSchema(18), false);
});
