/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateFolderBusesV13 } from './folder-bus-v13.ts';
import { normalizeAudioWarpMapForClip } from './audio-warp-clip-authority.ts';
import { AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	validateAudioEditorFolderHierarchyDocument,
	type AudioEditorFolderHierarchyDocument,
	type AudioEditorProjectV12ValidationOptions,
} from './project-v12-validation.ts';
import { validateTrackLocksV15 } from './project-v15-validation.ts';
import { validateVideoSourceCharacteristicsV14 } from './source-characteristics-v14.ts';
import {
	validateTakeCompDocumentGroupsV17,
	type TakeCompDocumentGroup,
} from './take-comp-document-v17.ts';

export { AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION } from './project-schema-version.ts';

export type AudioEditorProjectV17ValidationOptions = AudioEditorProjectV12ValidationOptions;

export interface AudioEditorProjectV17 extends AudioEditorFolderHierarchyDocument {
	readonly schemaVersion: 17;
	readonly takeGroups: readonly TakeCompDocumentGroup[];
}

/** Validate the exact V17 persistence document and every inherited revision layer. */
export function validateAudioEditorProjectV17(
	project: unknown,
	options: AudioEditorProjectV17ValidationOptions = {},
): project is AudioEditorProjectV17 {
	validateAudioEditorFolderHierarchyDocument(
		project,
		AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION,
		options,
	);
	const candidate = project as Record<string, unknown>;
	validateFolderBusesV13(candidate);
	validateVideoSourceCharacteristicsV14(candidate);
	validateTrackLocksV15(candidate as AudioEditorFolderHierarchyDocument);
	validateAudioWarpRuntimeAuthorityV17(candidate);
	validateTakeCompDocumentGroupsV17(
		dataValue(candidate, 'takeGroups', 'project'),
		candidate,
	);
	return true;
}

/** Current-schema native warp state must be consumable by the exact runtime. */
export function validateAudioWarpRuntimeAuthorityV17(project: Record<string, unknown>): void {
	const runtimeProject = project as unknown as Parameters<typeof normalizeAudioWarpMapForClip>[0];
	const clips = dataArray(project, 'clips', 'project');
	for (const [index, value] of clips.entries()) {
		const clip = value as Record<string, unknown>;
		if (clip?.kind !== 'audio' || clip.warpMap == null) continue;
		try {
			normalizeAudioWarpMapForClip(
				runtimeProject,
				clip as unknown as Parameters<typeof normalizeAudioWarpMapForClip>[1],
				clip.warpMap,
			);
		} catch (error) {
			throw new RangeError(`project.clips[${String(index)}].warpMap is not valid native runtime authority.`, { cause: error });
		}
	}
	const projectBin = dataValue(project, 'projectBin', 'project') as Record<string, unknown>;
	for (const [index, value] of dataArray(projectBin, 'clips', 'project.projectBin').entries()) {
		const clip = value as Record<string, unknown>;
		if (clip?.kind !== 'audio' || clip.warpMap == null) continue;
		try {
			normalizeAudioWarpMapForClip(
				runtimeProject,
				clip as unknown as Parameters<typeof normalizeAudioWarpMapForClip>[1],
				clip.warpMap,
			);
		} catch (error) {
			throw new RangeError(`project.projectBin.clips[${String(index)}].warpMap is not valid insertable runtime authority.`, { cause: error });
		}
	}
}

function dataArray(value: Record<string, unknown>, key: string, name: string): readonly unknown[] {
	const candidate = dataValue(value, key, name);
	if (!Array.isArray(candidate)) throw new TypeError(`${name}.${key} must be an array.`);
	return candidate;
}

function dataValue(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}
