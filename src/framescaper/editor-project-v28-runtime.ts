/* SPDX-License-Identifier: AGPL-3.0-only */

import { brandRuntimeProjectProjection, type RuntimeClipProject } from '../common/editor/runtime-clip-projection.ts';
import {
	framescaperProjectForCommandConsumersV27,
	framescaperProjectForEditClipboardConsumersV27,
	framescaperProjectForRuntimeConsumersV27,
} from './editor-project-v27-runtime.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import { validateFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';

type DataRecord = Record<string, unknown>;
type ConsumerProjectionKind = 'runtime' | 'command' | 'edit-clipboard';

/** Selected runtime view: retain V27 playback semantics and exact V28 native ownership. */
export function framescaperProjectForRuntimeConsumersV28(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'runtime');
}

/** Selected command view with professional source and OFX state addressable. */
export function framescaperProjectForCommandConsumersV28(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'command');
}

/** Common clipboard view plus full professional source metadata. */
export function framescaperProjectForEditClipboardConsumersV28(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	validateFramescaperProjectV28(profile, projectValue);
	const project = projectValue as FramescaperProjectV28;
	const projected = structuredClone(framescaperProjectForEditClipboardConsumersV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV27FoundationShapeV28(project),
	)) as DataRecord;
	return Object.freeze(mergeNativeState(projected, project, 'edit-clipboard'));
}

function projectForConsumers(
	profile: unknown,
	projectValue: unknown,
	kind: 'runtime' | 'command',
): Readonly<DataRecord> {
	validateFramescaperProjectV28(profile, projectValue);
	const project = projectValue as FramescaperProjectV28;
	const foundation = framescaperProjectV27FoundationShapeV28(project);
	const projected = structuredClone(kind === 'runtime'
		? framescaperProjectForRuntimeConsumersV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, foundation)
		: framescaperProjectForCommandConsumersV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, foundation)) as DataRecord;
	const result = Object.freeze(mergeNativeState(projected, project, kind)) as RuntimeClipProject;
	return brandRuntimeProjectProjection(result) as Readonly<DataRecord>;
}

function mergeNativeState(
	projected: DataRecord,
	project: FramescaperProjectV28,
	kind: ConsumerProjectionKind,
): DataRecord {
	const sources = new Map(records(project.sources, 'V28 canonical sources').map((source) => [String(source.id), source]));
	if (kind === 'runtime') projected.schemaVersion = 28;
	projected.sources = records(projected.sources, 'V28 projected sources').map((source) => {
		const canonical = sources.get(String(source.id));
		if (!canonical || canonical.kind !== 'video') return source;
		return {
			...source,
			characteristics: structuredClone(canonical.characteristics),
			imageSequence: structuredClone(canonical.imageSequence),
			proxyAttachment: structuredClone(canonical.proxyAttachment),
		};
	});
	projected.ofxEffects = structuredClone(project.ofxEffects);
	projected.featureRequirements = structuredClone(project.featureRequirements);
	return projected;
}

function records(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${name}[${String(index)}] must be an object.`);
		return item as DataRecord;
	});
}
