/* SPDX-License-Identifier: AGPL-3.0-only */

import { brandRuntimeProjectProjection, type RuntimeClipProject } from '../common/editor/runtime-clip-projection.ts';
import {
	framescaperProjectForCommandConsumersFinishing,
	framescaperProjectForEditClipboardConsumersFinishing,
	framescaperProjectForRuntimeConsumersFinishing,
} from './editor-project-finishing-runtime.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { validateFramescaperProjectNativeMedia, type FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

type DataRecord = Record<string, unknown>;
type ConsumerProjectionKind = 'runtime' | 'command' | 'edit-clipboard';

/** Selected runtime view: retain finishing playback semantics and exact nativeMedia native ownership. */
export function framescaperProjectForRuntimeConsumersNativeMedia(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'runtime');
}

/** Selected command view with professional source and OFX state addressable. */
export function framescaperProjectForCommandConsumersNativeMedia(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'command');
}

/** Common clipboard view plus full professional source metadata. */
export function framescaperProjectForEditClipboardConsumersNativeMedia(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	validateFramescaperProjectNativeMedia(profile, projectValue);
	const project = projectValue as FramescaperProjectNativeMedia;
	const projected = structuredClone(framescaperProjectForEditClipboardConsumersFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		framescaperProjectFinishingFoundationShapeNativeMedia(project),
	)) as DataRecord;
	return Object.freeze(mergeNativeState(projected, project, 'edit-clipboard'));
}

function projectForConsumers(
	profile: unknown,
	projectValue: unknown,
	kind: 'runtime' | 'command',
): Readonly<DataRecord> {
	validateFramescaperProjectNativeMedia(profile, projectValue);
	const project = projectValue as FramescaperProjectNativeMedia;
	const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(project);
	const projected = structuredClone(kind === 'runtime'
		? framescaperProjectForRuntimeConsumersFinishing(FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, foundation)
		: framescaperProjectForCommandConsumersFinishing(FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, foundation)) as DataRecord;
	const result = Object.freeze(mergeNativeState(projected, project, kind)) as RuntimeClipProject;
	return brandRuntimeProjectProjection(result) as Readonly<DataRecord>;
}

function mergeNativeState(
	projected: DataRecord,
	project: FramescaperProjectNativeMedia,
	kind: ConsumerProjectionKind,
): DataRecord {
	const sources = new Map(records(project.sources, 'nativeMedia canonical sources').map((source) => [String(source.id), source]));
	if (kind === 'runtime') projected.schemaVersion =  1;
	projected.sources = records(projected.sources, 'nativeMedia projected sources').map((source) => {
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
