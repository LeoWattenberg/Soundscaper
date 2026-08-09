/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_FEATURE_AFFECTED_OBJECT_LIMITS,
	projectFeatureAffectedObjects,
} from '../src/common/editor/project-feature-affected-objects.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type {
	ProjectFeatureFallback,
	ProjectFeatureRequirementsReport,
} from '../src/common/editor/project-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

const AUDIO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;
const VIDEO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;
const PUBLISHER_FEATURE = 'org.example.future-mixer';

function report(overrides: Record<string, unknown> = {}): ProjectFeatureRequirementsReport {
	return {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: { available: 0, unavailable: 1, unknown: 0 },
		items: [{
			requirementId: 'requirement-a',
			featureId: AUDIO_EFFECTS,
			displayName: 'Audio effects',
			availability: 'unavailable',
			declaredDisposition: 'bypass',
			disposition: 'bypassed',
			fallback: null,
			message: 'Audio effects are unavailable.',
			...overrides,
		}],
	};
}

function effect(
	id: string,
	type: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return { id, type, enabled: true, params: {}, ...overrides };
}

function project(): Record<string, unknown> {
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id: 'project',
		tracks: [
			{
				id: 'track-a',
				type: 'audio',
				effectsActive: true,
				effects: [effect('effect-known', 'compressor'), effect('effect-foreign', 'com.example.saturator')],
			},
			{ id: 'label-a', type: 'label' },
			{ id: 'video-a', type: 'video' },
		],
		mixer: { groups: [{ id: 'group-a', effects: [effect('group-effect', 'eq')] }], sends: [] },
		master: { effects: [effect('master-effect', 'compressor')] },
		clips: [
			{ id: 'clip-audio', kind: 'audio' },
			{ id: 'clip-video', kind: 'video', videoEffects: [effect('video-effect', 'brightness')] },
		],
		projectBin: { clips: [] },
	};
}

test('a foreign audio effect type is named instead of staying invisible', () => {
	const index = projectFeatureAffectedObjects(project(), report());
	assert.ok(index);
	const [requirement] = index.requirements;
	assert.equal(requirement.attributable, true);
	assert.deepEqual(requirement.objects.map((item) => item.objectId), ['effect-foreign']);
	const [foreign] = requirement.objects;
	assert.equal(foreign.registered, false);
	assert.equal(foreign.objectType, 'com.example.saturator');
	assert.equal(foreign.channel, 'audio-effect');
	assert.equal(foreign.scope, 'track');
	assert.equal(foreign.ownerId, 'track-a');
});

test('registered effect types are left to their own placeholder section', () => {
	const source = project();
	(source.tracks as Record<string, unknown>[])[0].effects = [effect('effect-known', 'compressor')];
	const index = projectFeatureAffectedObjects(source, report());
	assert.equal(index?.requirements[0].attributable, false);
	assert.deepEqual(index?.requirements[0].objects, []);
});

test('inert racks and effects are not reported as affected', () => {
	const inertRack = project();
	(inertRack.tracks as Record<string, unknown>[])[0].effectsActive = false;
	assert.deepEqual(projectFeatureAffectedObjects(inertRack, report())?.requirements[0].objects, []);
	const inertEffect = project();
	(inertEffect.tracks as Record<string, unknown>[])[0].effects = [
		effect('effect-foreign', 'com.example.saturator', { enabled: false }),
		effect('effect-bypassed', 'com.example.other', { bypassed: true }),
	];
	assert.deepEqual(projectFeatureAffectedObjects(inertEffect, report())?.requirements[0].objects, []);
});

test('an unreadable identity is omitted rather than thrown out of the snapshot', () => {
	const source = project();
	(source.tracks as Record<string, unknown>[])[0].effects = [
		effect('x'.repeat(300), 'com.example.saturator'),
	];
	// A throw here would blank the editor, so the call itself is the assertion.
	const index = projectFeatureAffectedObjects(source, report());
	assert.ok(index);
	assert.equal(index.requirements[0].objects.length, 0);
	assert.equal(index.requirements[0].omittedObjectCount, 1);
	assert.equal(index.requirements[0].attributable, false);
});

test('an accessor in an identity position is treated as absent, never invoked', () => {
	const source = project();
	let invoked = false;
	Object.defineProperty((source.tracks as Record<string, unknown>[])[0], 'id', {
		get() { invoked = true; return 'track-a'; },
		enumerable: true,
		configurable: true,
	});
	assert.doesNotThrow(() => projectFeatureAffectedObjects(source, report()));
	assert.equal(invoked, false);
});

test('an audio whole-mix fallback names every canonical object its projection replaces', () => {
	const fallback: ProjectFeatureFallback = {
		role: 'project-audio-mix-v1',
		kind: 'audio',
		sourceId: 'fallback-audio',
		sha256: 'a'.repeat(64),
	};
	const index = projectFeatureAffectedObjects(project(), report({
		featureId: PUBLISHER_FEATURE,
		availability: 'unknown',
		declaredDisposition: 'rendered-fallback',
		disposition: 'rendered-fallback',
		fallback,
	}));
	assert.ok(index);
	const [requirement] = index.requirements;
	assert.equal(requirement.availability, 'unknown');
	assert.equal(requirement.attributable, true);
	assert.ok(requirement.objects.every((item) => item.channel === 'rendered-fallback-replaced'));
	assert.deepEqual(
		requirement.objects.map((item) => item.objectId),
		['track-a', 'group-a', 'master', 'clip-audio'],
	);
	assert.ok(
		!requirement.objects.some((item) => item.objectId === 'clip-video'),
		'the audio whole-mix projection retains video timing',
	);
});

test('a track-local audio fallback names only the replaced track and its lane clips', () => {
	const fallback: ProjectFeatureFallback = {
		role: 'audio-track-render-v1',
		kind: 'audio',
		sourceId: 'fallback-audio',
		sha256: 'd'.repeat(64),
		targetTrackId: 'track-a',
	};
	const source = project();
	(source.tracks as Record<string, unknown>[])[0].clipIds = ['clip-audio'];
	const index = projectFeatureAffectedObjects(source, report({
		featureId: AUDIO_EFFECTS,
		declaredDisposition: 'rendered-fallback',
		disposition: 'rendered-fallback',
		fallback,
	}));
	assert.ok(index);
	const [requirement] = index.requirements;
	assert.equal(requirement.attributable, true);
	assert.ok(requirement.objects.every((item) => item.channel === 'rendered-fallback-replaced'));
	assert.deepEqual(
		requirement.objects.map((item) => item.objectId),
		['track-a', 'clip-audio'],
		'the track projection must not name mixer racks, the master, or video objects',
	);
});

test('a whole-project video fallback names the video tracks and clips it collapses', () => {
	const fallback: ProjectFeatureFallback = {
		role: 'project-video-render-v1',
		kind: 'video',
		sourceId: 'fallback-video',
		sha256: 'b'.repeat(64),
	};
	const index = projectFeatureAffectedObjects(project(), report({
		featureId: PUBLISHER_FEATURE,
		availability: 'unknown',
		declaredDisposition: 'rendered-fallback',
		disposition: 'rendered-fallback',
		fallback,
	}));
	assert.deepEqual(index?.requirements[0].objects.map((item) => item.objectId), ['video-a', 'clip-video']);
});

test('a fallback that names nothing reports unattributable rather than an empty list', () => {
	const fallback: ProjectFeatureFallback = {
		role: 'video-clip-render-v1',
		kind: 'video',
		sourceId: 'fallback-video',
		sha256: 'c'.repeat(64),
		targetClipId: 'clip-absent',
	};
	const index = projectFeatureAffectedObjects(project(), report({
		featureId: VIDEO_EFFECTS,
		declaredDisposition: 'rendered-fallback',
		disposition: 'rendered-fallback',
		fallback,
	}));
	assert.equal(index?.requirements[0].attributable, false);
	assert.deepEqual(index?.requirements[0].objects, []);
});

test('a clip-local video fallback names only its exact target clip', () => {
	const fallback: ProjectFeatureFallback = {
		role: 'video-clip-render-v1',
		kind: 'video',
		sourceId: 'fallback-video',
		sha256: 'c'.repeat(64),
		targetClipId: 'clip-video',
	};
	const index = projectFeatureAffectedObjects(project(), report({
		featureId: VIDEO_EFFECTS,
		declaredDisposition: 'rendered-fallback',
		disposition: 'rendered-fallback',
		fallback,
	}));
	assert.deepEqual(index?.requirements[0].objects.map((item) => item.objectId), ['clip-video']);
});

test('an unattributable requirement reports zero objects instead of pretending', () => {
	const index = projectFeatureAffectedObjects(project(), report({
		featureId: PUBLISHER_FEATURE,
		availability: 'unknown',
		displayName: 'Future mixer',
	}));
	assert.ok(index);
	const [requirement] = index.requirements;
	assert.equal(requirement.featureId, PUBLISHER_FEATURE);
	assert.equal(requirement.attributable, false);
	assert.deepEqual(requirement.objects, []);
	assert.equal(requirement.omittedObjectCount, 0);
	assert.equal(index.truncated, false);
});

test('video-effect requirements enumerate timeline and Project Bin clips', () => {
	const source = project();
	(source.projectBin as { clips: unknown[] }).clips = [
		{ id: 'bin-video', kind: 'video', videoEffects: [effect('bin-effect', 'blur')] },
	];
	const index = projectFeatureAffectedObjects(source, report({ featureId: VIDEO_EFFECTS }));
	assert.deepEqual(index?.requirements[0].objects.map((item) => [item.location, item.objectId]), [
		['timeline', 'video-effect'],
		['project-bin', 'bin-effect'],
	]);
});

test('an over-budget index truncates and discloses instead of failing the open', () => {
	const fallback: ProjectFeatureFallback = {
		role: 'project-audio-mix-v1',
		kind: 'audio',
		sourceId: 'fallback-audio',
		sha256: 'a'.repeat(64),
	};
	const value = report({
		declaredDisposition: 'rendered-fallback',
		disposition: 'rendered-fallback',
		fallback,
	});
	const full = projectFeatureAffectedObjects(project(), value);
	assert.equal(full?.requirements[0].objects.length, 4);
	const index = projectFeatureAffectedObjects(project(), value, { maximumAffectedObjects: 2 });
	assert.ok(index);
	const [requirement] = index.requirements;
	assert.equal(requirement.objects.length, 2);
	assert.equal(requirement.omittedObjectCount, 2);
	assert.equal(requirement.attributable, true);
	assert.equal(index.truncated, true);
});

test('the object ceiling may only be lowered', () => {
	assert.throws(
		() => projectFeatureAffectedObjects(project(), report(), {
			maximumAffectedObjects: PROJECT_FEATURE_AFFECTED_OBJECT_LIMITS.maximumAffectedObjects + 1,
		}),
		/cannot raise the production limit/u,
	);
});

test('the pass never mutates or reprojects the canonical project', () => {
	const source = project();
	const before = structuredClone(source);
	const tracks = source.tracks;
	projectFeatureAffectedObjects(source, report());
	assert.deepEqual(source, before);
	assert.strictEqual(source.tracks, tracks, 'no container may be replaced');
});

test('compatible, non-current-schema, and available-only reports produce no index', () => {
	assert.equal(projectFeatureAffectedObjects(project(), null), null);
	assert.equal(projectFeatureAffectedObjects(project(), report({}) && {
		...report(),
		compatible: true,
	}), null);
	assert.equal(projectFeatureAffectedObjects({ ...project(), schemaVersion: 8 }, report()), null);
	assert.equal(
		projectFeatureAffectedObjects(project(), { ...report(), items: [{
			...report().items[0], availability: 'available', disposition: 'native',
		}] }),
		null,
	);
});

test('an owner whose own identity is unreadable is disclosed, not dropped silently', () => {
	const source = project();
	(source.tracks as Record<string, unknown>[])[0].id = 'x'.repeat(300);
	const index = projectFeatureAffectedObjects(source, report());
	assert.equal(index?.requirements[0].objects.length, 0);
	assert.ok(
		(index?.requirements[0].omittedObjectCount ?? 0) > 0,
		'the dropped rack and the effects it anchored must be disclosed',
	);
});
