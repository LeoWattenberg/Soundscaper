/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSingleProjectFeatureRenderedFallback } from '../src/common/editor/project-feature-rendered-fallback-selection.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';

const REPORT_BASE = Object.freeze({
	schemaVersion: 1 as const,
	format: 'soundscaper-project' as const,
	compatible: false,
	counts: Object.freeze({ available: 0, unavailable: 1, unknown: 0 }),
});

function report(...items: ProjectFeatureRequirementsReport['items']): ProjectFeatureRequirementsReport {
	return Object.freeze({ ...REPORT_BASE, items: Object.freeze(items) });
}

function item(
	requirementId: string,
	kind: 'audio' | 'video',
	role: 'project-audio-mix-v1' | 'project-video-render-v1',
): ProjectFeatureRequirementsReport['items'][number] {
	return Object.freeze({
		requirementId,
		featureId: `org.soundscaper.${kind}`,
		displayName: 'Fallback',
		availability: 'unavailable' as const,
		declaredDisposition: 'rendered-fallback' as const,
		disposition: 'rendered-fallback' as const,
		fallback: Object.freeze({ kind, role, sourceId: `${kind}-source`, sha256: 'a'.repeat(64) }),
		message: 'Fallback is required.',
	}) as ProjectFeatureRequirementsReport['items'][number];
}

const OPTIONS = Object.freeze({
	kind: 'audio' as const,
	admittedRoles: Object.freeze(['project-audio-mix-v1'] as const),
	qualifies: () => true,
	featureIdentity: () => 'forced.feature.identity' as const,
	ambiguityDiagnostic: 'Audio fallback selection is ambiguous.',
});

test('single rendered-fallback selection owns report shape, role, and feature identity', () => {
	const selected = selectSingleProjectFeatureRenderedFallback(
		report(
			item('video', 'video', 'project-video-render-v1'),
			item('audio', 'audio', 'project-audio-mix-v1'),
		),
		OPTIONS,
	);

	assert.deepEqual(selected, {
		featureId: 'forced.feature.identity',
		requirementId: 'audio',
		fallback: {
			kind: 'audio', role: 'project-audio-mix-v1', sourceId: 'audio-source', sha256: 'a'.repeat(64),
		},
	});
	assert.equal(Object.isFrozen(selected), true);
	assert.equal(selectSingleProjectFeatureRenderedFallback(
		Object.freeze({ ...report(item('audio', 'audio', 'project-audio-mix-v1')), compatible: true }),
		OPTIONS,
	), null);
});

test('single rendered-fallback selection preserves qualification and ambiguity policy hooks', () => {
	assert.equal(selectSingleProjectFeatureRenderedFallback(
		report(item('audio', 'audio', 'project-audio-mix-v1')),
		{ ...OPTIONS, qualifies: () => false },
	), null);
	assert.throws(
		() => selectSingleProjectFeatureRenderedFallback(
			report(
				item('audio-a', 'audio', 'project-audio-mix-v1'),
				item('audio-b', 'audio', 'project-audio-mix-v1'),
			),
			OPTIONS,
		),
		/Audio fallback selection is ambiguous/u,
	);
	assert.throws(
		() => selectSingleProjectFeatureRenderedFallback(
			report(item(' padded ', 'audio', 'project-audio-mix-v1')),
			OPTIONS,
		),
		/Rendered fallback requirement ID must be a non-empty canonical string/u,
	);
});
