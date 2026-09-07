/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectVisualProject } from './project-visual-types.ts';

type Row = Readonly<Record<string, unknown>>;

/** Cache preparation accepts render drafts, but requires a usable media inventory. */
export function admitTimePitchCacheProject(value: unknown): ProjectVisualProject {
	if (!isCacheProject(value)) throw new TypeError('Invalid time-pitch cache project inventory.');
	return value;
}

function isCacheProject(value: unknown): value is ProjectVisualProject {
	return row(value) && typeof value.id === 'string' && Number.isSafeInteger(value.schemaVersion)
		&& rows(value.sources, source) && rows(value.clips, clip) && rows(value.tracks, track)
		&& (value.projectBin === undefined || (row(value.projectBin)
			&& (value.projectBin.clips === undefined || rows(value.projectBin.clips, clip))));
}

function source(value: Row): boolean {
	return typeof value.id === 'string' && optionalString(value.kind)
		&& optionalString(value.storageKey) && optionalString(value.contentSha256);
}

function clip(value: Row): boolean {
	return typeof value.id === 'string' && typeof value.sourceId === 'string'
		&& optionalString(value.kind) && (value.binItemId == null || typeof value.binItemId === 'string')
		&& optionalNumber(value.timelineStartFrame) && optionalNumber(value.durationFrames);
}

function track(value: Row): boolean {
	return typeof value.id === 'string' && (value.clipIds === undefined
		|| (Array.isArray(value.clipIds) && value.clipIds.every((id: unknown) => typeof id === 'string')));
}

function rows(value: unknown, accept: (value: Row) => boolean): boolean {
	return Array.isArray(value) && value.every((item: unknown) => row(item) && accept(item));
}

function row(value: unknown): value is Row {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === 'string';
}

function optionalNumber(value: unknown): boolean {
	return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}
