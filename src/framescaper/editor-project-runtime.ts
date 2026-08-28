/* SPDX-License-Identifier: AGPL-3.0-only */

import { brandRuntimeProjectProjection, type RuntimeClipProject } from
	'../common/editor/runtime-clip-projection.ts';
import {
	framescaperProjectForCommandConsumersAssistance,
	framescaperProjectForEditClipboardConsumersAssistance,
	framescaperProjectForRuntimeConsumersAssistance,
} from './editor-project-assistance-runtime.ts';
import { framescaperProjectNativeMediaFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { framescaperProjectSequenceFoundationComposition } from './editor-project-composition-validation.ts';
import { framescaperProjectRetimeFoundationFinishing } from './editor-project-finishing-runtime.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { framescaperProjectCompositionFoundationRetime } from './editor-project-retime-validation.ts';
import { framescaperProjectForAuthoredFoundationSequence } from './editor-project-sequence-runtime.ts';
import { validateFramescaperProject } from './editor-project.ts';

type DataRecord = Record<string, unknown>;

export function framescaperProjectForRuntimeConsumers(
	profile: unknown,
	project: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, project, 'runtime');
}

export function framescaperProjectForCommandConsumers(
	profile: unknown,
	project: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, project, 'command');
}

export function framescaperProjectForEditClipboardConsumers(
	profile: unknown,
	project: unknown,
): Readonly<DataRecord> {
	validateFramescaperProject(profile, project);
	return baselineProjection(framescaperProjectForEditClipboardConsumersAssistance(
		profile,
		project,
	));
}

/**
 * Project the baseline directly to the unchanged V17 proxy-proof protocol.
 * The numeric value belongs only to that independently versioned common
 * protocol; product admission has already happened by the family tuple.
 */
export function framescaperProjectForVideoProxyRelationship(
	profile: unknown,
	project: unknown,
): Readonly<DataRecord> {
	validateFramescaperProject(profile, project);
	const nativeMedia = framescaperProjectNativeMediaFoundationShapeAssistance(project);
	const finishing = framescaperProjectFinishingFoundationShapeNativeMedia(nativeMedia);
	const retime = framescaperProjectRetimeFoundationFinishing(
		profile,
		finishing,
	);
	const composition = framescaperProjectCompositionFoundationRetime(
		profile,
		retime,
	);
	const sequence = framescaperProjectSequenceFoundationComposition(
		profile,
		composition,
	);
	return framescaperProjectForAuthoredFoundationSequence(
		profile,
		sequence,
	) as unknown as Readonly<DataRecord>;
}

function projectForConsumers(
	profile: unknown,
	project: unknown,
	kind: 'runtime' | 'command',
): Readonly<DataRecord> {
	validateFramescaperProject(profile, project);
	const projected = kind === 'runtime'
		? framescaperProjectForRuntimeConsumersAssistance(profile, project)
		: framescaperProjectForCommandConsumersAssistance(profile, project);
	return brandRuntimeProjectProjection(
		baselineProjection(projected) as RuntimeClipProject,
	) as Readonly<DataRecord>;
}

function baselineProjection(value: Readonly<Record<string, unknown>>): Readonly<DataRecord> {
	const projected = structuredClone(value) as DataRecord;
	projected.schemaFamily = 'framescaper';
	projected.schemaVersion = 1;
	return Object.freeze(projected);
}
