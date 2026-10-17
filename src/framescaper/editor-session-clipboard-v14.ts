/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord as record, readClosedDomainField as field, readClosedDomainArray as array } from '../common/editor/closed-domain-value.ts';
import { normalizeAudioEditorClipboardDescriptorV7, type AudioEditorClipboardV7 } from '../common/editor/commands/clipboard-codec-v7.ts';
import { admitAudioEditorProjectValidationStructure, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../common/editor/project-validation-budget.ts';
import { normalizeCubeLutProfileParamsV1 } from '../common/editor/video-cube-lut-profile-v1.ts';
import { collectCubeLutProfileProjectReferencesV1 } from '../common/editor/video-cube-lut-project-references-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../common/editor/video-color-cube-lut-v27.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { createFramescaperSessionClipboardV13, normalizeFramescaperSessionClipboardV13, type FramescaperSessionClipboardV13 } from './editor-session-clipboard-v13.ts';
import { framescaperClipboardDescriptorMetadataProjectionV14, framescaperClipboardProjectMetadataProjectionV14 } from './editor-session-clipboard-resource-projection-v14.ts';

export interface FramescaperSessionClipboardV14 extends Omit<FramescaperSessionClipboardV13, 'schemaVersion' | 'descriptor'> {
	readonly schemaVersion: 14;
	readonly descriptor: AudioEditorClipboardV7;
	readonly cubeLuts: readonly Readonly<VideoCubeLutReferenceV1>[];
}
const FIELDS = Object.freeze(['schemaVersion', 'kind', 'originProjectId', 'originRevision', 'descriptor', 'sources',
	'clipBindings', 'finishing', 'ofxEffects', 'images', 'cubeLuts']);

/** Capture complete current effects beside the unchanged rich metadata
 * authorities. Disabled resources remain custody roots, null remains neutral. */
export function createFramescaperSessionClipboardV14(profile: unknown, project: unknown, value: unknown): FramescaperSessionClipboardV14 {
	const metadataProject = framescaperClipboardProjectMetadataProjectionV14(profile, project);
	const descriptor = normalizeAudioEditorClipboardDescriptorV7(value);
	const metadata = createFramescaperSessionClipboardV13(FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		metadataProject, framescaperClipboardDescriptorMetadataProjectionV14(descriptor));
	return normalizeFramescaperSessionClipboardV14({ ...metadata, schemaVersion: 14, descriptor,
		cubeLuts: references(descriptor) });
}

/** Exact current admission grants scalar custody only. Every recipe field is
 * normalized once by descriptor7; body authentication belongs to staged IO. */
export function normalizeFramescaperSessionClipboardV14(value: unknown): FramescaperSessionClipboardV14 {
	const closed = record(value, 'Framescaper session clipboard V14', FIELDS);
	const input = Object.fromEntries(FIELDS.map(key => [key, field(closed, key, 'Framescaper session clipboard V14')]));
	if (input.schemaVersion !== 14) throw new RangeError('Framescaper session clipboard requires V14 re-copy.');
	admitAudioEditorProjectValidationStructure(input, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS);
	const descriptor = normalizeAudioEditorClipboardDescriptorV7(input.descriptor);
	const expected = references(descriptor);
	const supplied = array(input.cubeLuts, 'V14 cube resource ledger', 0, 16_384).map(raw => {
		const reference = normalizeCubeLutProfileParamsV1({ lut: raw }).lut;
		if (reference === null) throw new TypeError('V14 resource ledger requires a complete reference.');
		return reference;
	});
	if (JSON.stringify(supplied) !== JSON.stringify(expected)) throw new RangeError('V14 cube resource closure disagrees with the complete descriptor.');
	const { cubeLuts: _cubeLuts, ...metadata } = input;
	const legacy = normalizeFramescaperSessionClipboardV13({ ...metadata, schemaVersion: 13,
		descriptor: framescaperClipboardDescriptorMetadataProjectionV14(descriptor) });
	return Object.freeze({ ...legacy, schemaVersion: 14, descriptor, cubeLuts: expected });
}

/** Explicit, transient projection for unchanged image/finishing metadata
 * algorithms. The current carrier must already pass complete V14 admission. */
export function framescaperSessionClipboardMetadataProjectionV14(value: unknown): FramescaperSessionClipboardV13 {
	const clipboard = normalizeFramescaperSessionClipboardV14(value);
	const { cubeLuts: _cubeLuts, ...metadata } = clipboard;
	return normalizeFramescaperSessionClipboardV13({ ...metadata, schemaVersion: 13,
		descriptor: framescaperClipboardDescriptorMetadataProjectionV14(clipboard.descriptor) });
}

function references(descriptor: AudioEditorClipboardV7): readonly Readonly<VideoCubeLutReferenceV1>[] {
	return collectCubeLutProfileProjectReferencesV1({ clips: descriptor.tracks.flatMap(track => track.clips) });
}
