/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateFolderBusesV13 } from './folder-bus-v13.ts';
import { AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	validateAudioEditorFolderHierarchyDocument,
	type AudioEditorFolderHierarchyDocument,
	type AudioEditorProjectV12ValidationOptions,
} from './project-v12-validation.ts';
import { validateVideoSourceCharacteristicsV14 } from './source-characteristics-v14.ts';

export { AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION } from './project-schema-version.ts';

export type AudioEditorProjectV15ValidationOptions = AudioEditorProjectV12ValidationOptions;

export interface AudioEditorTrackV15 extends Readonly<Record<string, unknown>> {
	readonly locked: boolean;
}

export interface AudioEditorProjectV15 extends AudioEditorFolderHierarchyDocument {
	readonly schemaVersion: 15;
}

/** Validate the exact V15 persistence document and every track's editorial lock. */
export function validateAudioEditorProjectV15(
	project: unknown,
	options: AudioEditorProjectV15ValidationOptions = {},
): project is AudioEditorProjectV15 {
	validateAudioEditorFolderHierarchyDocument(
		project,
		AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION,
		options,
	);
	validateFolderBusesV13(project as Record<string, unknown>);
	validateVideoSourceCharacteristicsV14(project as Record<string, unknown>);
	validateTrackLocksV15(project as AudioEditorFolderHierarchyDocument);
	return true;
}

/** Validate the V15 lock layer inherited unchanged by later schemas. */
export function validateTrackLocksV15(project: AudioEditorFolderHierarchyDocument): void {
	for (const [index, value] of project.tracks.entries()) {
		const track = value as Readonly<Record<string, unknown>>;
		const descriptor = Object.getOwnPropertyDescriptor(track, 'locked');
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(
				`project.tracks[${String(index)}].locked must be an own enumerable data property.`,
			);
		}
		if (typeof descriptor.value !== 'boolean') {
			throw new TypeError(`project.tracks[${String(index)}].locked must be boolean.`);
		}
	}
}
