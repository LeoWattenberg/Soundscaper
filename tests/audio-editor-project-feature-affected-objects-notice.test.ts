/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { projectFeatureAffectedObjects } from '../src/common/editor/project-feature-affected-objects.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type {
	ProjectFeatureFallback,
	ProjectFeatureRequirementsReport,
} from '../src/common/editor/project-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import ProjectFeatureCompatibilityNotice from '../src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

const PUBLISHER_FEATURE = 'org.example.future-mixer';

function report(overrides: Record<string, unknown> = {}): ProjectFeatureRequirementsReport {
	return {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: { available: 0, unavailable: 0, unknown: 1 },
		items: [{
			requirementId: 'requirement-a',
			featureId: PUBLISHER_FEATURE,
			displayName: 'Future mixer',
			availability: 'unknown',
			declaredDisposition: 'bypass',
			disposition: 'bypassed',
			fallback: null,
			message: 'Unknown feature.',
			...overrides,
		}],
	};
}

function project(): Record<string, unknown> {
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id: 'project',
		tracks: [{
			id: 'track-a',
			type: 'audio',
			effectsActive: true,
			effects: [{ id: 'effect-foreign', type: 'com.example.saturator', enabled: true, params: {} }],
		}],
		mixer: { groups: [], sends: [] },
		master: { effects: [] },
		clips: [{ id: 'clip-audio', kind: 'audio' }],
		projectBin: { clips: [] },
	};
}

function render(source: Record<string, unknown>, value: ProjectFeatureRequirementsReport): string {
	return renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		project: source as never,
		report: value,
		affectedObjects: projectFeatureAffectedObjects(source, value),
		copy: ENGLISH_COPY as never,
	}));
}

test('an unattributable requirement says so instead of showing an empty list', () => {
	const markup = render(project(), report());
	assert.match(markup, /data-project-feature-affected-objects-unattributable/u);
	assert.match(markup, /affected objects cannot be identified/iu);
	assert.doesNotMatch(markup, /data-project-feature-affected-objects=/u);
});

test('an audio whole-mix fallback names the canonical objects it replaces', () => {
	const fallback: ProjectFeatureFallback = {
		role: 'project-audio-mix-v1',
		kind: 'audio',
		sourceId: 'fallback-audio',
		sha256: 'a'.repeat(64),
	};
	const markup = render(project(), report({
		declaredDisposition: 'rendered-fallback',
		disposition: 'rendered-fallback',
		fallback,
	}));
	assert.match(markup, /data-project-feature-affected-objects\b/u);
	assert.match(markup, /data-affected-object="track-a"/u);
	assert.match(markup, /data-affected-object="clip-audio"/u);
	assert.match(markup, /data-channel="rendered-fallback-replaced"/u);
	assert.match(markup, /Replaced during editor playback/iu);
});

test('a foreign audio effect type is surfaced as unrecognized', () => {
	const markup = render(project(), report({
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		availability: 'unavailable',
		displayName: 'Audio effects',
	}));
	assert.match(markup, /data-affected-object="effect-foreign"/u);
	assert.match(markup, /data-registered="false"/u);
	assert.match(markup, /Type not recognized by this editor/iu);
});

test('the affected-object section stays control-free', () => {
	const fallback: ProjectFeatureFallback = {
		role: 'project-audio-mix-v1',
		kind: 'audio',
		sourceId: 'fallback-audio',
		sha256: 'a'.repeat(64),
	};
	const markup = render(project(), report({
		declaredDisposition: 'rendered-fallback',
		disposition: 'rendered-fallback',
		fallback,
	}));
	assert.doesNotMatch(markup, /<button|<input|<select|<textarea|<a\b/iu);
	assert.doesNotMatch(markup, /button|Install|Enable/iu);
});
