/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
} from '../src/common/editor/project-owned-feature-requirements.ts';
import {
	AUP4_OWNED_FEATURE_CARRIAGE,
	reportAup4OwnedFeatureOmissions,
} from '../src/common/editor/aup4-feature-omissions.ts';
import {
	addAup4CompatibilityItem,
	createAup4CompatibilityReport,
} from '../src/common/editor/aup4-profile.js';

const project = (ids: readonly string[]) => ({
	featureRequirements: { schemaVersion: 1, requirements: ids.map((id) => ({ id })) },
});

test('every owned feature has an AUP4 decision, so a new one cannot ship without one', () => {
	// The completeness property: this table is read off the requirement registry
	// rather than maintained beside it, so adding a feature without deciding what
	// an AUP4 save says about it fails here.
	assert.deepEqual(
		Object.keys(AUP4_OWNED_FEATURE_CARRIAGE).sort(),
		Object.keys(PROJECT_OWNED_FEATURE_REQUIREMENT_IDS).sort(),
	);
	for (const [key, decision] of Object.entries(AUP4_OWNED_FEATURE_CARRIAGE)) {
		assert.ok(['carried', 'reported', 'omitted'].includes(decision.carriage), key);
		assert.match(decision.code, /^[A-Z0-9_]+$/u, key);
		if (decision.carriage === 'omitted') {
			assert.ok(decision.message && decision.message.length > 20, `${key} must say what was lost`);
		}
	}
});

test('a document reports every feature it holds that AUP4 cannot carry', () => {
	const report = createAup4CompatibilityReport('save');
	const reported = reportAup4OwnedFeatureOmissions(
		project([
			PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.trackFolders,
			PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.masteringSequences,
			PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioWarp,
		]),
		report,
		addAup4CompatibilityItem,
	);

	assert.deepEqual([...reported], [
		'TRACK_FOLDER_STRUCTURE_OMITTED', 'AUDIO_WARP_MAPS_OMITTED', 'MASTERING_SEQUENCES_OMITTED',
	]);
	assert.ok(report.items.every((item: { disposition: string }) => item.disposition === 'omitted'));
	assert.equal(report.counts.omitted, 3);
	assert.equal(
		report.items[0].data.requirementId,
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.trackFolders,
		'each item names the requirement it answers',
	);
});

test('a feature AUP4 carries is not reported as a loss', () => {
	const report = createAup4CompatibilityReport('save');
	const reported = reportAup4OwnedFeatureOmissions(
		project([
			PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
			PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.musicalTimeline,
			PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.timelineAnnotations,
		]),
		report,
		addAup4CompatibilityItem,
	);
	assert.deepEqual([...reported], []);
	assert.deepEqual(report.items, []);
});

test('a loss another item already reported is one loss, not two', () => {
	const report = createAup4CompatibilityReport('save');
	addAup4CompatibilityItem(report, {
		code: 'VIDEO_OMITTED', severity: 'warning', disposition: 'omitted', scope: { kind: 'project' },
	});
	const reported = reportAup4OwnedFeatureOmissions(
		project([
			PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoEffects,
			PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoRetime,
			PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoTimingAssets,
		]),
		report,
		addAup4CompatibilityItem,
	);
	assert.deepEqual([...reported], []);
	assert.equal(report.items.length, 1);
});

test('a loss nobody actually reported is reported here, not assumed away', () => {
	// A `reported` decision names the item that is supposed to carry the loss, and
	// naming it was taken as proof it fired. MIXER_ROUTES_OMITTED cannot fire for
	// any project that can declare a mixer graph — it is emitted from a `routes`
	// map, and the V21 graph has no such field — so an authored graph left the
	// exported copy with no report item at all.
	const report = createAup4CompatibilityReport('save');
	const reported = reportAup4OwnedFeatureOmissions(
		project([PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioMixerGraph]),
		report,
		addAup4CompatibilityItem,
	);

	assert.deepEqual([...reported], ['MIXER_ROUTES_OMITTED']);
	assert.equal(report.items.length, 1);
	assert.equal(report.items[0].disposition, 'omitted');
	assert.match(String(report.items[0].message), /mixer graph/u);
});

test('a document that holds nothing reports nothing', () => {
	const report = createAup4CompatibilityReport('save');
	assert.deepEqual([...reportAup4OwnedFeatureOmissions(project([]), report, addAup4CompatibilityItem)], []);
	assert.deepEqual([...reportAup4OwnedFeatureOmissions({}, report, addAup4CompatibilityItem)], []);
	assert.deepEqual(report.items, []);
});
