/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import ScapeOpenDecisionDialog from '../src/common/editor/ui/workspace/ScapeOpenDecisionDialog.jsx';

const incompatibleReport = Object.freeze({
	schemaVersion: 1 as const,
	format: 'soundscaper-project' as const,
	compatible: false,
	counts: Object.freeze({ available: 0, unavailable: 1, unknown: 1 }),
	items: Object.freeze([
		Object.freeze({
			requirementId: 'video-effects',
			featureId: 'org.soundscaper.capability.video-effects',
			displayName: 'Video effects',
			availability: 'unavailable' as const,
			declaredDisposition: 'bypass' as const,
			disposition: 'bypassed' as const,
			fallback: null,
			message: 'This unlocalized evaluator message must never be rendered.',
		}),
		Object.freeze({
			requirementId: 'future-mixer',
			featureId: 'org.example.future-mixer',
			displayName: 'Future mixer',
			availability: 'unknown' as const,
			declaredDisposition: 'rendered-fallback' as const,
			disposition: 'rendered-fallback' as const,
			fallback: Object.freeze({ kind: 'audio' as const, sourceId: 'source-1', sha256: '0'.repeat(64) }),
			message: 'Nor may this one be rendered.',
		}),
	]),
});

function prompt(kind: 'compatibility' | 'collision' | 'compatibility-collision') {
	return Object.freeze({
		requestId: 1,
		kind,
		file: new Blob(['scape']),
		inspected: Object.freeze({
			exists: kind !== 'compatibility',
			title: 'Feature project',
			featureRequirementsCompatibility: kind === 'collision' ? null : incompatibleReport,
		}),
	});
}

test('the compatibility decision renders structured localized evidence and closed actions', () => {
	const markup = renderToStaticMarkup(React.createElement(ScapeOpenDecisionDialog, {
		copy: ENGLISH_COPY,
		prompt: prompt('compatibility'),
		onSettle: () => true,
	}));

	assert.match(markup, /Project features unavailable/u);
	assert.match(markup, /Feature project/u);
	assert.match(markup, /Video effects/u);
	assert.match(markup, /org\.soundscaper\.capability\.video-effects/u);
	assert.match(markup, /Unavailable/u);
	assert.match(markup, /Unknown/u);
	assert.match(markup, /Bypass declared/u);
	assert.match(markup, /Rendered fallback declared/u);
	assert.match(markup, /Open read-only/u);
	assert.doesNotMatch(markup, /Replace|unlocalized evaluator|Nor may/u);
});

test('the combined decision explains the collision and offers only a read-only copy or cancel', () => {
	const markup = renderToStaticMarkup(React.createElement(ScapeOpenDecisionDialog, {
		copy: ENGLISH_COPY,
		prompt: prompt('compatibility-collision'),
		onSettle: () => true,
	}));

	assert.match(markup, /same ID/u);
	assert.match(markup, /Open as read-only copy/u);
	assert.doesNotMatch(markup, />Replace</u);
});

test('a compatible collision keeps the maintained UI on safe copy or cancel', () => {
	const markup = renderToStaticMarkup(React.createElement(ScapeOpenDecisionDialog, {
		copy: ENGLISH_COPY,
		prompt: prompt('collision'),
		onSettle: () => true,
	}));

	assert.match(markup, /Project already exists/u);
	assert.match(markup, /Open as copy/u);
	assert.doesNotMatch(markup, />Replace</u);
	assert.doesNotMatch(markup, /Project features unavailable/u);
});

test('the compatibility decision localizes its accessible resize label', () => {
	const markup = renderToStaticMarkup(React.createElement(ScapeOpenDecisionDialog, {
		copy: GERMAN_COPY,
		prompt: prompt('compatibility'),
		onSettle: () => true,
	}));

	assert.match(markup, /aria-label="Größe ändern: Projektfunktionen nicht verfügbar"/u);
	assert.doesNotMatch(markup, /aria-label="Resize:/u);
});
