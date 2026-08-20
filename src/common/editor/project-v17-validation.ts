/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateFolderBusesV13 } from './folder-bus-v13.ts';
import { validateProjectAudioWarpRuntimeAuthority } from './project-audio-warp-validation.ts';
import {
	validateProjectHierarchyDocument,
	type ProjectHierarchyDocument,
	type ProjectHierarchyDocumentValidationOptions,
} from './project-hierarchy-document-validation.ts';
import { AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION } from './project-schema-version.ts';
import { validateProjectTrackLocks } from './project-track-lock-validation.ts';
import { validateVideoSourceCharacteristicsV14 } from './source-characteristics-v14.ts';
import {
	validateTakeCompDocumentGroupsV17,
	type TakeCompDocumentGroup,
} from './take-comp-document-v17.ts';

export { AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION } from './project-schema-version.ts';

export type AudioEditorProjectV17ValidationOptions = ProjectHierarchyDocumentValidationOptions;

export interface AudioEditorProjectV17 extends ProjectHierarchyDocument {
	readonly schemaVersion: 17;
	readonly takeGroups: readonly TakeCompDocumentGroup[];
}

/** Validate the exact V17 persistence document and every inherited revision layer. */
export function validateAudioEditorProjectV17(
	project: unknown,
	options: AudioEditorProjectV17ValidationOptions = {},
): project is AudioEditorProjectV17 {
	validateProjectHierarchyDocument(
		project,
		AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION,
		options,
	);
	const candidate = project as Record<string, unknown>;
	validateFolderBusesV13(candidate);
	validateVideoSourceCharacteristicsV14(candidate);
	validateProjectTrackLocks(candidate);
	validateProjectAudioWarpRuntimeAuthority(candidate);
	validateTakeCompDocumentGroupsV17(
		dataValue(candidate, 'takeGroups', 'project'),
		candidate,
	);
	return true;
}

/** Current-schema native warp state must be consumable by the exact runtime. */
export function validateAudioWarpRuntimeAuthorityV17(project: Record<string, unknown>): void {
	validateProjectAudioWarpRuntimeAuthority(project);
}

function dataValue(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}
