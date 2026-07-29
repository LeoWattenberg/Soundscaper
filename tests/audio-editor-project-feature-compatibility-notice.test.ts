/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import ProjectFeatureCompatibilityNotice from '../src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx';
import {
	createProjectFeatureCompatibilityNotice,
	projectFeatureAvailabilityLabel,
	projectFeatureDispositionLabel,
} from '../src/common/editor/ui/workspace/project-feature-compatibility-notice.ts';

const COPY = Object.freeze({
	scapeCompatibilityUnavailable: 'Unavailable',
	scapeCompatibilityUnknown: 'Unknown',
	scapeCompatibilityBypassed: 'Bypass declared',
	scapeCompatibilityRenderedFallback: 'Rendered fallback declared',
});

test('compatible and future-schema null reports do not produce a post-open notice', () => {
	assert.equal(createProjectFeatureCompatibilityNotice(null), null);
	assert.equal(createProjectFeatureCompatibilityNotice(undefined), null);
	assert.equal(createProjectFeatureCompatibilityNotice(report(true, [])), null);
	assert.equal(createProjectFeatureCompatibilityNotice(report(false, [
		item('native', 'org.soundscaper.capability.audio-effects', 'Audio effects', 'available', 'native'),
	])), null);
});

test('an incompatible report becomes a frozen structured notice without evaluator messages', () => {
	let excludedFieldReads = 0;
	const native = item('native', 'org.soundscaper.capability.audio-effects', 'Audio effects', 'available', 'native');
	const bypassed = item('bypassed', 'org.soundscaper.capability.video-effects', 'Video effects', 'unavailable', 'bypassed');
	const rendered = item('rendered', 'org.example.native.spectral-repair', 'Spectral repair', 'unknown', 'rendered-fallback');
	for (const candidate of [native, bypassed, rendered]) {
		Object.defineProperty(candidate, 'message', {
			enumerable: true,
			get() { excludedFieldReads += 1; return 'Provider-authored evaluator text'; },
		});
		Object.defineProperty(candidate, 'fallback', {
			enumerable: true,
			get() { excludedFieldReads += 1; return { sourceId: 'secret-source', sha256: '0'.repeat(64) }; },
		});
	}

	const notice = createProjectFeatureCompatibilityNotice(report(false, [native, bypassed, rendered]));

	assert.ok(notice);
	assert.deepEqual(notice.counts, { unavailable: 1, unknown: 1 });
	assert.deepEqual(notice.items, [{
		requirementId: 'bypassed',
		featureId: 'org.soundscaper.capability.video-effects',
		displayName: 'Video effects',
		availability: 'unavailable',
		declaredDisposition: 'bypass',
		effectiveDisposition: 'bypassed',
	}, {
		requirementId: 'rendered',
		featureId: 'org.example.native.spectral-repair',
		displayName: 'Spectral repair',
		availability: 'unknown',
		declaredDisposition: 'rendered-fallback',
		effectiveDisposition: 'rendered-fallback',
	}]);
	assert.equal(excludedFieldReads, 0);
	assert.equal(Object.isFrozen(notice), true);
	assert.equal(Object.isFrozen(notice.counts), true);
	assert.equal(Object.isFrozen(notice.items), true);
	assert.equal(Object.isFrozen(notice.items[0]), true);
	assert.equal(projectFeatureAvailabilityLabel(notice.items[0], COPY), 'Unavailable');
	assert.equal(projectFeatureAvailabilityLabel(notice.items[1], COPY), 'Unknown');
	assert.equal(projectFeatureDispositionLabel(notice.items[0], COPY), 'Bypass declared');
	assert.equal(projectFeatureDispositionLabel(notice.items[1], COPY), 'Rendered fallback declared');
});

test('the post-open region stays structured, localized, and free of activation controls', () => {
	const incompatible = report(false, [
		item('bypassed', 'org.soundscaper.capability.video-effects', 'Video effects', 'unavailable', 'bypassed'),
		item('rendered', 'org.example.native.spectral-repair', 'Spectral repair', 'unknown', 'rendered-fallback'),
	]);
	const english = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
	}));
	const german = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: GERMAN_COPY,
	}));

	assert.match(english, /<aside[^>]*data-project-feature-compatibility/iu);
	assert.match(english, /<aside[^>]*tabindex="0"/iu);
	assert.match(english, /role="status"[^>]*aria-atomic="true"/iu);
	assert.match(english, /Video effects.*org\.soundscaper\.capability\.video-effects/isu);
	assert.match(english, /data-declared-disposition="bypass"/u);
	assert.match(english, /data-effective-disposition="bypassed"/u);
	assert.match(english, /Spectral repair.*Rendered fallback declared/isu);
	assert.doesNotMatch(english, /button|Install|Enable|Use fallback|secret-source|Provider-authored/iu);
	assert.match(german, /Projektfunktionen nicht verfügbar/u);
	assert.match(german, /Dieses Projekt ist schreibgeschützt/u);
});

function report(
	compatible: boolean,
	items: readonly Record<string, unknown>[],
): ProjectFeatureRequirementsReport {
	return {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible,
		counts: { available: 0, unavailable: 0, unknown: 0 },
		items,
	} as unknown as ProjectFeatureRequirementsReport;
}

function item(
	requirementId: string,
	featureId: string,
	displayName: string,
	availability: string,
	disposition: string,
): Record<string, unknown> {
	return {
		requirementId,
		featureId,
		displayName,
		availability,
		declaredDisposition: disposition === 'rendered-fallback' ? 'rendered-fallback' : 'bypass',
		disposition,
	};
}
