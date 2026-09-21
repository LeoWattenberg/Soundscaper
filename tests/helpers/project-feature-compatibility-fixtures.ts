/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import type { ProjectFeatureRequirementsReport } from '../../src/common/editor/project-feature-requirements.ts';

export function assertPlaceholderAttributes(
	markup: string,
	effectId: string,
	scope: string,
	ownerId: string,
	effectType: string,
): void {
	const row = markup.match(new RegExp(
		`<[^>]+(?=[^>]*data-audio-effect-placeholder="${effectId}")(?=[^>]*data-scope="${scope}")(?=[^>]*data-owner-id="${ownerId}")(?=[^>]*data-effect-type="${effectType}")(?=[^>]*data-effective-disposition="bypassed")[^>]*>`,
		'iu',
	));
	assert.ok(row, `Missing stable placeholder attributes for ${effectId}.`);
}

export function placeholderMarkup(markup: string, effectId: string): string {
	const row = markup.match(new RegExp(
		`<li(?=[^>]*data-audio-effect-placeholder="${effectId}")[^>]*>[\\s\\S]*?<\\/li>`,
		'iu',
	));
	assert.ok(row, `Missing placeholder row for ${effectId}.`);
	return row[0];
}

export function assertVideoPlaceholderAttributes(
	markup: string,
	effectId: string,
	location: string,
	clipId: string,
	effectType: string,
): void {
	const row = markup.match(new RegExp(
		`<[^>]+(?=[^>]*data-video-effect-placeholder="${effectId}")(?=[^>]*data-location="${location}")(?=[^>]*data-clip-id="${clipId}")(?=[^>]*data-effect-type="${effectType}")(?=[^>]*data-effective-disposition="bypassed")[^>]*>`,
		'iu',
	));
	assert.ok(row, `Missing stable video placeholder attributes for ${effectId}.`);
}

export function videoPlaceholderMarkup(markup: string, effectId: string): string {
	const row = markup.match(new RegExp(
		`<li(?=[^>]*data-video-effect-placeholder="${effectId}")[^>]*>[\\s\\S]*?<\\/li>`,
		'iu',
	));
	assert.ok(row, `Missing video placeholder row for ${effectId}.`);
	return row[0];
}

export function report(
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

export function item(
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
