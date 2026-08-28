/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import { framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia } from './editor-project-professional-media-foundation.ts';
import {
	createFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
	type FramescaperProjectFinishingOptions,
} from './editor-project-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectNativeMediaProfile } from './editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_PROJECT_NATIVE_MEDIA_SCHEMA_VERSION,
	normalizeFramescaperProjectNativeStateNativeMedia,
	validateFramescaperProjectNativeMedia,
	type FramescaperProjectNativeMedia,
} from './editor-project-native-media-validation.ts';

export {
	FRAMESCAPER_PROJECT_NATIVE_MEDIA_SCHEMA_VERSION,
	validateFramescaperProjectNativeMedia,
	type FramescaperProjectNativeMedia,
} from './editor-project-native-media-validation.ts';

export type FramescaperProjectNativeMediaOptions = FramescaperProjectFinishingOptions & Readonly<{
	readonly ofxEffects?: readonly OfxEffectStateV26[];
}>;

export function createFramescaperProjectNativeMedia(
	profile: unknown,
	options: FramescaperProjectNativeMediaOptions = {},
): FramescaperProjectNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	const input = structuredClone(options) as Record<string, unknown>;
	const nativeSources = captureNativeSources(input.sources);
	const ofxEffects = structuredClone(input.ofxEffects ?? []) as OfxEffectStateV26[];
	delete input.ofxEffects;
	input.sources = v27SourceInputs(input.sources);
	const foundation = createFramescaperProjectFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		input as FramescaperProjectFinishingOptions,
	);
	return upgradeFinishing(profile, foundation, nativeSources, ofxEffects);
}

export function cloneFramescaperProjectNativeMedia(profile: unknown, project: unknown): FramescaperProjectNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	validateFramescaperProjectNativeMedia(profile, project);
	const clone = structuredClone(project) as FramescaperProjectNativeMedia;
	validateFramescaperProjectNativeMedia(profile, clone);
	return clone;
}

function upgradeFinishing(
	profile: unknown,
	foundation: FramescaperProjectFinishing,
	nativeSources: ReadonlyMap<string, NativeSourceState>,
	ofxEffects: readonly OfxEffectStateV26[],
): FramescaperProjectNativeMedia {
	const project = structuredClone(foundation) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_NATIVE_MEDIA_SCHEMA_VERSION;
	project.sources = records(project.sources, 'sources').map((source) => {
		if (source.kind !== 'video') return source;
		const native = nativeSources.get(String(source.id));
		return {
			...source,
			characteristics: structuredClone(native?.characteristics ?? source.characteristics),
			imageSequence: structuredClone(native?.imageSequence ?? null),
		};
	});
	project.ofxEffects = structuredClone(ofxEffects);
	normalizeFramescaperProjectNativeStateNativeMedia(profile, project);
	validateFramescaperProjectNativeMedia(profile, project);
	return project as unknown as FramescaperProjectNativeMedia;
}

interface NativeSourceState { readonly characteristics: unknown; readonly imageSequence: unknown }

function captureNativeSources(value: unknown): ReadonlyMap<string, NativeSourceState> {
	const result = new Map<string, NativeSourceState>();
	for (const source of recordsOrEmpty(value)) {
		if (source.kind !== 'video') continue;
		const id = String(source.id);
		if (result.has(id)) throw new RangeError(`Duplicate nativeMedia source identity ${id}.`);
		result.set(id, Object.freeze({
			characteristics: structuredClone(source.characteristics),
			imageSequence: structuredClone(source.imageSequence ?? null),
		}));
	}
	return result;
}

function v27SourceInputs(value: unknown): Record<string, unknown>[] | undefined {
	if (value === undefined) return undefined;
	return records(value, 'sources').map((source) => {
		if (source.kind !== 'video') return source;
		delete source.imageSequence;
		if (source.characteristics !== undefined) {
			source.characteristics = framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia(source);
		}
		return source;
	});
}

function recordsOrEmpty(value: unknown): Record<string, unknown>[] {
	return value === undefined ? [] : records(value, 'sources');
}
function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${name}[${String(index)}] must be an object.`);
		return item as Record<string, unknown>;
	});
}
