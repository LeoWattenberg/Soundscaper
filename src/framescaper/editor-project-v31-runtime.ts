/* SPDX-License-Identifier: AGPL-3.0-only */

import { brandRuntimeProjectProjection, type RuntimeClipProject } from '../common/editor/runtime-clip-projection.ts';
import {
	framescaperProjectForCommandConsumersV30,
	framescaperProjectForEditClipboardConsumersV30,
	framescaperProjectForRuntimeConsumersV30,
} from './editor-project-v30-runtime.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v30.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV30FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import {
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31.ts';

type DataRecord = Record<string, unknown>;

export function framescaperProjectForRuntimeConsumersV31(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'runtime');
}

export function framescaperProjectForCommandConsumersV31(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'command');
}

export function framescaperProjectForEditClipboardConsumersV31(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	assertFramescaperProjectV31Profile(profile);
	validateFramescaperProjectV31(profile, projectValue);
	return framescaperProjectForEditClipboardConsumersV30(
		FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV30FoundationShapeV31(projectValue),
	);
}

function projectForConsumers(
	profile: unknown,
	projectValue: unknown,
	kind: 'runtime' | 'command',
): Readonly<DataRecord> {
	assertFramescaperProjectV31Profile(profile);
	validateFramescaperProjectV31(profile, projectValue);
	const project = projectValue as FramescaperProjectV31;
	const foundation = framescaperProjectV30FoundationShapeV31(project);
	const projected = structuredClone(kind === 'runtime'
		? framescaperProjectForRuntimeConsumersV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, foundation)
		: framescaperProjectForCommandConsumersV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, foundation)) as DataRecord;
	projected.assistanceAssets = structuredClone(project.assistanceAssets);
	projected.featureRequirements = structuredClone(project.featureRequirements);
	if (kind === 'runtime') projected.schemaVersion = 31;
	return brandRuntimeProjectProjection(Object.freeze(projected) as RuntimeClipProject) as Readonly<DataRecord>;
}
