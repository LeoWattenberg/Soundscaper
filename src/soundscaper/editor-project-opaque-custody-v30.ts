/* SPDX-License-Identifier: AGPL-3.0-only */

import { snapshotInertJsonValue } from '../common/editor/inert-json-snapshot.ts';
import { createAudioEditorProjectV17 } from '../common/editor/project-v17.ts';
import { SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION } from './editor-project-v30-validation.ts';

const CUSTODY_VIEW_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export interface SoundscaperOpaqueCustodyConsumerProjectV30
	extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly sources: readonly never[];
	readonly clips: readonly never[];
	readonly tracks: readonly never[];
}

/**
 * Expose a generic inert shell for future-project consumers. The canonical
 * archive remains separately retained and no future field receives authority.
 */
export function createSoundscaperOpaqueCustodyConsumerProjectV30(
	value: unknown,
): SoundscaperOpaqueCustodyConsumerProjectV30 {
	const project = snapshotInertJsonValue(value, 'future Soundscaper custody project', {
		maximumArrayLength: 100_000,
		maximumNodes: 2_000_000,
	});
	if (!project || typeof project !== 'object' || Array.isArray(project)) {
		throw new TypeError('Future Soundscaper custody requires the generic project envelope.');
	}
	const record = project as Readonly<Record<string, unknown>>;
	if (typeof record.id !== 'string' || !record.id.trim()
		|| typeof record.title !== 'string' || !record.title.trim()
		|| !Number.isSafeInteger(record.schemaVersion)
		|| Number(record.schemaVersion) <= SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION
		|| !Number.isSafeInteger(record.sampleRate)
		|| Number(record.sampleRate) < 8_000 || Number(record.sampleRate) > 384_000
		|| !Array.isArray(record.sources) || !Array.isArray(record.clips)
		|| !Array.isArray(record.tracks)) {
		throw new TypeError('Future Soundscaper custody requires the generic project envelope.');
	}
	const shell = createAudioEditorProjectV17({
		id: record.id,
		title: record.title,
		sampleRate: Number(record.sampleRate),
		now: CUSTODY_VIEW_TIMESTAMP,
		updatedAt: CUSTODY_VIEW_TIMESTAMP,
		sources: [], clips: [], tracks: [],
	});
	return Object.freeze({
		...shell,
		schemaVersion: Number(record.schemaVersion),
		sources: Object.freeze([]),
		clips: Object.freeze([]),
		tracks: Object.freeze([]),
	}) as SoundscaperOpaqueCustodyConsumerProjectV30;
}
