/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { admitAudioEditorProjectValidationStructure, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from './project-validation-budget.ts';
import { normalizeProject } from './session-history.js';
import { normalizeAudioEditorClipboardDescriptorV7, collectAudioEditorClipboardSourceIdsV7,
	type AudioEditorClipboardV7 } from './commands/clipboard-codec-v7.ts';
import { normalizeAudioEditorSessionClipboard, type AudioEditorSessionClipboard,
	type AudioEditorSessionClipboardSource } from './session-clipboard-codec.ts';
import { collectCubeLutProfileProjectReferencesV1 } from './video-cube-lut-project-references-v1.ts';

export interface AudioEditorSessionClipboardV2 {
	readonly schemaVersion: 2;
	readonly originProjectId: string;
	readonly descriptor: AudioEditorClipboardV7;
	readonly sources: readonly AudioEditorSessionClipboardSource[];
}
export type CurrentAudioEditorSessionClipboard = AudioEditorSessionClipboard | AudioEditorSessionClipboardV2;

/** Scalar current wrapper. The selected product independently owns project
 * admission and durable source/LUT bodies; this owner grants no body authority. */
export function createAudioEditorSessionClipboardV2(project: unknown, options: Readonly<{ descriptor: unknown }>): AudioEditorSessionClipboardV2 {
	admitAudioEditorProjectValidationStructure(project, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS);
	const current = normalizeProject(project) as Record<string, unknown>;
	return normalizeAudioEditorSessionClipboardV2({ schemaVersion: 2, originProjectId: current.id,
		descriptor: options.descriptor, sources: current.sources });
}

/** No promotion on read: wrapper2 requires the complete named descriptor7. */
export function normalizeAudioEditorSessionClipboardV2(value: unknown): AudioEditorSessionClipboardV2 {
	const input = record(value, 'Current session clipboard', ['schemaVersion', 'originProjectId', 'descriptor', 'sources']);
	if (field(input, 'schemaVersion', 'Current session clipboard') !== 2) throw new RangeError('Current session clipboard requires wrapper V2.');
	admitAudioEditorProjectValidationStructure(input, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS);
	const copy = structuredClone(input);
	const originProjectId = id(copy.originProjectId, 'Current session clipboard origin');
	const descriptor = normalizeAudioEditorClipboardDescriptorV7(copy.descriptor);
	if (!Array.isArray(copy.sources)) throw new TypeError('Current session clipboard sources must be an array.');
	const sourcesById = new Map<string, AudioEditorSessionClipboardSource>();
	for (const source of copy.sources as unknown[]) {
		if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('Current session clipboard source metadata is required.');
		const sourceId = id((source as Record<string, unknown>).id, 'Current session clipboard source');
		if (sourcesById.has(sourceId)) throw new RangeError(`Duplicate current session clipboard source ID: ${sourceId}.`);
		sourcesById.set(sourceId, source as AudioEditorSessionClipboardSource);
	}
	const sources = collectAudioEditorClipboardSourceIdsV7(descriptor).map(sourceId => {
		const source = sourcesById.get(sourceId);
		if (!source) throw new ReferenceError(`Current session clipboard source metadata is missing for ${sourceId}.`);
		return source;
	});
	return Object.freeze({ schemaVersion: 2, originProjectId, descriptor, sources: Object.freeze(sources) });
}

/** Named current dispatch; old wrapper1 retains its own strict codec. */
export function normalizeAudioEditorSessionClipboardV1OrV2(value: unknown): CurrentAudioEditorSessionClipboard {
	const schema = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'schemaVersion') : undefined;
	return schema && Object.hasOwn(schema, 'value') && schema.value === 2
		? normalizeAudioEditorSessionClipboardV2(value) : normalizeAudioEditorSessionClipboard(value);
}

/** Disabled refs are durable roots too; neutral null contributes no root.
 * Complete temporary admission excludes conflicting same-key geometry. */
export function collectSessionClipboardStorageKeysV2(value: AudioEditorSessionClipboardV2): readonly string[] {
	const clipboard = normalizeAudioEditorSessionClipboardV2(value);
	return Object.freeze(collectCubeLutProfileProjectReferencesV1({ clips: clipboard.descriptor.tracks.flatMap(track => track.clips) })
		.map(reference => reference.storageKey).sort());
}

function id(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new TypeError(`${name} must be a canonical nonempty ID.`);
	return value;
}
