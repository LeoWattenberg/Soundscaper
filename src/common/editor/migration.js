/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeEffect } from './effects.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	loadCurrentAudioEditorProject,
} from './project-current.ts';

function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

/**
 * A pre-release project predates the current clean-break schema and must be
 * recreated from its source media instead of being silently conformed.
 */
export class AudioEditorProjectReimportRequiredError extends RangeError {
	constructor(schemaVersion) {
		super(`Audio editor schema ${String(schemaVersion)} is no longer readable; re-import the source media.`);
		this.name = 'AudioEditorProjectReimportRequiredError';
		this.code = 'REIMPORT_REQUIRED';
		this.schemaVersion = schemaVersion;
		this.currentSchemaVersion = AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION;
	}
}

/**
 * Exact-current load boundary. Future documents remain opaque and read-only;
 * pre-release older documents fail with an actionable typed error.
 */
export function migrateAudioEditorProject(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A saved project is required.');
	const schemaVersion = value.schemaVersion;
	if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
		throw new RangeError(`Unsupported audio editor schema version: ${String(value.schemaVersion)}.`);
	}
	if (schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return {
			project: clone(value),
			migrated: false,
			fromVersion: schemaVersion,
			readOnly: true,
			reason: 'newer-schema',
		};
	}
	if (schemaVersion < AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new AudioEditorProjectReimportRequiredError(schemaVersion);
	}
	const loaded = loadCurrentAudioEditorProject(value);
	const normalized = (value.tracks || []).some((track) => track?.type !== 'label' && (
		Object.hasOwn(track, 'channelCount')
		|| Object.hasOwn(track, 'channelLayout')
		|| Object.hasOwn(track, 'sampleRate')
		|| Object.hasOwn(track, 'sampleFormat')
	)) || projectHasLegacyParametricEq(value);
	return {
		project: loaded.project,
		migrated: normalized,
		fromVersion: schemaVersion,
		readOnly: false,
		reason: null,
	};
}

function projectHasLegacyParametricEq(project) {
	const racks = [
		project?.master?.effects,
		...(project?.tracks || []).map((track) => track?.effects),
		...(project?.mixer?.groups || []).map((group) => group?.effects),
		...(project?.mixer?.sends || []).map((send) => send?.effects),
	];
	for (const effects of racks) {
		for (const effect of effects || []) {
			if (!['eq', 'parametric-eq', 'parametric_eq'].includes(effect?.type)) continue;
			if (effect.type !== 'eq') return true;
			const normalized = normalizeEffect(effect);
			if (!canonicalParametricEqParamsEqual(normalized.params, effect.params)) return true;
		}
	}
	return false;
}

function canonicalParametricEqParamsEqual(expected, actual) {
	if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
	if (!sameKeys(actual, ['bands', 'outputGain']) || actual.outputGain !== expected.outputGain) return false;
	if (!Array.isArray(actual.bands) || actual.bands.length !== expected.bands.length) return false;
	const bandKeys = ['enabled', 'frequency', 'gain', 'id', 'q', 'slope', 'type'];
	return actual.bands.every((band, index) => {
		const canonical = expected.bands[index];
		return band && typeof band === 'object' && !Array.isArray(band)
			&& sameKeys(band, bandKeys)
			&& band.id === canonical.id
			&& band.enabled === canonical.enabled
			&& band.type === canonical.type
			&& band.frequency === canonical.frequency
			&& band.gain === canonical.gain
			&& band.q === canonical.q
			&& band.slope === canonical.slope;
	});
}

function sameKeys(value, expected) {
	const keys = Object.keys(value).sort();
	return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}
