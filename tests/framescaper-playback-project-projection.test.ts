/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperFeaturePlaybackProjection,
	framescaperPlaybackDeliveryProjection,
	opaqueFramescaperPlaybackProjection,
} from '../src/framescaper/editor-project-playback-projection.ts';

test('Framescaper playback packaging has one frozen opaque and feature projection authority', () => {
	const project = Object.freeze({ id: 'project', clips: [], tracks: [], sources: [] });
	const opaque = opaqueFramescaperPlaybackProjection(project);
	assert.strictEqual(opaque.project, project);
	assert.equal(opaque.featureRequirementsReport, null);
	assert.deepEqual(opaque.requiredAudioSourceIds, []);
	assert.deepEqual(opaque.requiredVideoSourceIds, []);
	assert.equal(Object.isFrozen(opaque), true);
	assert.strictEqual(opaque.requiredAudioSourceIds, opaque.requiredVideoSourceIds);

	const projected = framescaperFeaturePlaybackProjection(project, null);
	assert.strictEqual(projected.project, project);
	assert.equal(projected.audioEffectPlaybackBypass, null);
	assert.equal(projected.videoEffectPlaybackBypass, null);
	assert.deepEqual(projected.requiredAudioSourceIds, []);
	assert.deepEqual(projected.requiredVideoSourceIds, []);
	assert.equal(Object.isFrozen(projected), true);
});

test('Framescaper delivery packaging exposes fallbacks and source custody but not bypass reports', () => {
	const project = Object.freeze({ id: 'project' });
	const projection = Object.freeze({
		project,
		featureRequirementsReport: null,
		audioEffectPlaybackBypass: null,
		audioRenderedFallback: null,
		videoEffectPlaybackBypass: null,
		videoRenderedFallback: null,
		requiredAudioSourceIds: Object.freeze(['audio']),
		requiredVideoSourceIds: Object.freeze(['video']),
	});
	const delivery = framescaperPlaybackDeliveryProjection(projection);
	assert.deepEqual(Object.keys(delivery), [
		'project', 'featureRequirementsReport', 'audioRenderedFallback', 'videoRenderedFallback',
		'requiredAudioSourceIds', 'requiredVideoSourceIds',
	]);
	assert.strictEqual(delivery.project, project);
	assert.strictEqual(delivery.requiredAudioSourceIds, projection.requiredAudioSourceIds);
	assert.strictEqual(delivery.requiredVideoSourceIds, projection.requiredVideoSourceIds);
	assert.equal(Object.isFrozen(delivery), true);
});
