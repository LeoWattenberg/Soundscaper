/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as schema from '../src/common/editor/project-schema-version.ts';

const soundscaper = Object.freeze({
	schemaFamily: 'soundscaper',
	schemaVersion: 1,
	sources: Object.freeze([]),
	clips: Object.freeze([]),
	tracks: Object.freeze([]),
	mixer: Object.freeze({}),
	automationLanes: Object.freeze([]),
	masteringSequences: Object.freeze([]),
});
const framescaper = Object.freeze({
	schemaFamily: 'framescaper',
	schemaVersion: 1,
	sources: Object.freeze([]),
	clips: Object.freeze([]),
	tracks: Object.freeze([]),
	mixer: Object.freeze({}),
	automationLanes: Object.freeze([]),
});

const FOUNDATION_PREDICATES = [
	schema.hasCoreEditingProjectAuthority,
	schema.hasProjectBinMediaAuthority,
	schema.hasVideoEffectsProjectAuthority,
	schema.hasBextMetadataProjectAuthority,
	schema.hasAdmMetadataProjectAuthority,
	schema.hasSequenceGeometryProjectAuthority,
	schema.hasSequenceHierarchyProjectAuthority,
	schema.isFoundationProjectSchema,
	schema.isActiveAudioEditorProjectSchema,
	schema.isTimelineAnnotationProjectSchema,
	schema.isTrackFolderProjectSchema,
	schema.isSourceCharacteristicsProjectSchema,
	schema.isTrackLockProjectSchema,
	schema.isVideoRetimeCurveProjectSchema,
	schema.isTakeCompProjectSchema,
	schema.isAudioWarpProjectSchema,
	schema.isMaintainedProjectFeatureSchema,
	schema.isMaintainedRenderedFallbackProjectSchema,
] as const;

test('shared feature predicates require a tuple or the complete internal foundation object', () => {
	for (const predicate of FOUNDATION_PREDICATES) {
		assert.equal(predicate(soundscaper), true);
		assert.equal(predicate(framescaper), true);
		for (const numeric of [1, 17, 19, 20, 21, 31, 32]) {
			assert.equal(predicate(numeric), false, predicate.name + ' accepted bare ' + String(numeric));
		}
		assert.equal(predicate({ schemaVersion: 17 }), false);
	}
	const internal = {
		schemaVersion: schema.AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION,
		sources: [], clips: [], tracks: [],
	};
	assert.equal(schema.isFoundationProjectSchema(internal), true);
});

test('the baseline exposes one schema version shared by two explicit families', () => {
	assert.equal(schema.PROJECT_SCHEMA_VERSION, 1);
	assert.equal(schema.AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 17);
	assert.equal(schema.isSoundscaperProductionProject(soundscaper), true);
	assert.equal(schema.isSoundscaperProductionProject(framescaper), false);
	assert.equal(schema.isSelectedFramescaperProjectSchema(framescaper), true);
	assert.equal(schema.isSelectedFramescaperProjectSchema(soundscaper), false);
	assert.equal(schema.isFramescaperSequenceProjectSchema(framescaper), true);
	assert.equal(schema.isFramescaperCaptureProjectSchema(framescaper), true);
	assert.equal(schema.isFramescaperVideoCompositionProjectSchema(framescaper), true);
	assert.equal(schema.isFramescaperVideoKeyframeProjectSchema(framescaper), true);
	assert.equal(schema.isFramescaperVideoRetimeProjectSchema(framescaper), true);
	assert.equal(schema.isFramescaperVideoProxyProjectSchema(framescaper), true);
});

test('capability predicates inspect family-qualified data properties', () => {
	assert.equal(schema.hasProductionMixerProjectAuthority(soundscaper), true);
	assert.equal(schema.hasProductionMixerProjectAuthority(framescaper), true);
	assert.equal(schema.hasProductionMixerProjectAuthority({
		schemaFamily: 'soundscaper', schemaVersion: 1,
	}), false);
	assert.equal(schema.hasMasteringSequenceProjectAuthority(soundscaper), true);
	assert.equal(schema.hasMasteringSequenceProjectAuthority(framescaper), false);
	assert.equal(schema.isMasteringSequenceProjectSchema(soundscaper), true);
	assert.equal(schema.isProductionMixerProjectSchema(1), false);
});

test('identity accessors and future versions never gain feature authority', () => {
	const accessor = Object.defineProperty({ schemaVersion: 1 }, 'schemaFamily', {
		enumerable: true,
		get: () => 'framescaper',
	});
	for (const candidate of [
		accessor,
		{ schemaFamily: 'framescaper', schemaVersion: 2 },
		{ schemaFamily: 'unknown', schemaVersion: 1 },
	]) {
		assert.equal(schema.isFoundationProjectSchema(candidate), false);
		assert.equal(schema.isFramescaperSequenceProjectSchema(candidate), false);
	}
});
