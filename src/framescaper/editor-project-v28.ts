/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import { readFramescaperProjectSchemaVersion, snapshotFramescaperOpaqueProject } from './editor-project-v18.ts';
import { framescaperVideoSourceCharacteristicsV24ProjectionV25 } from './editor-project-v25-foundation.ts';
import {
	cloneFramescaperProjectV27,
	createFramescaperProjectV27,
	type FramescaperProjectV27,
	type FramescaperProjectV27Options,
} from './editor-project-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import {
	FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION,
	normalizeFramescaperProjectNativeStateV28,
	validateFramescaperProjectV28,
	type FramescaperProjectV28,
} from './editor-project-v28-validation.ts';

export {
	FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION,
	validateFramescaperProjectV28,
	type FramescaperProjectV28,
} from './editor-project-v28-validation.ts';

export type FramescaperProjectV28Options = FramescaperProjectV27Options & Readonly<{
	readonly ofxEffects?: readonly OfxEffectStateV26[];
}>;

export interface LoadedFramescaperProjectV28 {
	readonly project: FramescaperProjectV28 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'known-dormant-custody' | 'newer-schema' | null;
}

export class FramescaperProjectV28ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	constructor(readonly schemaVersion: number) {
		super(schemaVersion === 27
			? 'Framescaper V27 requires explicit reimport into V28.'
			: `Framescaper schema ${String(schemaVersion)} is not an admitted V28 reimport source.`);
		this.name = 'FramescaperProjectV28ReimportRequiredError';
	}
}

export function createFramescaperProjectV28(
	profile: unknown,
	options: FramescaperProjectV28Options = {},
): FramescaperProjectV28 {
	assertFramescaperProjectV28Profile(profile);
	const input = structuredClone(options) as Record<string, unknown>;
	const nativeSources = captureNativeSources(input.sources);
	const ofxEffects = structuredClone(input.ofxEffects ?? []) as OfxEffectStateV26[];
	delete input.ofxEffects;
	input.sources = v27SourceInputs(input.sources);
	const foundation = createFramescaperProjectV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		input as FramescaperProjectV27Options,
	);
	return upgradeV27(profile, foundation, nativeSources, ofxEffects);
}

export function cloneFramescaperProjectV28(profile: unknown, project: unknown): FramescaperProjectV28 {
	assertFramescaperProjectV28Profile(profile);
	validateFramescaperProjectV28(profile, project);
	const clone = structuredClone(project) as FramescaperProjectV28;
	validateFramescaperProjectV28(profile, clone);
	return clone;
}

export function loadFramescaperProjectV28(profile: unknown, value: unknown): LoadedFramescaperProjectV28 {
	assertFramescaperProjectV28Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion === 25 || schemaVersion === 26) return Object.freeze({
		project: snapshotFramescaperOpaqueProject(value), readOnly: true,
		intrinsicReadOnly: true, reason: 'known-dormant-custody' as const,
	});
	if (schemaVersion > FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION) return Object.freeze({
		project: snapshotFramescaperOpaqueProject(value), readOnly: true,
		intrinsicReadOnly: true, reason: 'newer-schema' as const,
	});
	if (schemaVersion !== FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION) {
		throw new FramescaperProjectV28ReimportRequiredError(schemaVersion);
	}
	return Object.freeze({
		project: cloneFramescaperProjectV28(profile, value), readOnly: false,
		intrinsicReadOnly: false, reason: null,
	});
}

/** The only route that turns validated selected V27 state into writable V28 authority. */
export function reimportFramescaperProjectV28(profile: unknown, value: unknown): FramescaperProjectV28 {
	assertFramescaperProjectV28Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion === 25 || schemaVersion === 26) {
		throw new RangeError(`Dormant Framescaper V${String(schemaVersion)} remains opaque read-only custody.`);
	}
	if (schemaVersion !== 27) throw new FramescaperProjectV28ReimportRequiredError(schemaVersion);
	const foundation = cloneFramescaperProjectV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, value);
	return upgradeV27(profile, foundation, new Map(), []);
}

function upgradeV27(
	profile: unknown,
	foundation: FramescaperProjectV27,
	nativeSources: ReadonlyMap<string, NativeSourceState>,
	ofxEffects: readonly OfxEffectStateV26[],
): FramescaperProjectV28 {
	const project = structuredClone(foundation) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION;
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
	normalizeFramescaperProjectNativeStateV28(profile, project);
	validateFramescaperProjectV28(profile, project);
	return project as unknown as FramescaperProjectV28;
}

interface NativeSourceState { readonly characteristics: unknown; readonly imageSequence: unknown }

function captureNativeSources(value: unknown): ReadonlyMap<string, NativeSourceState> {
	const result = new Map<string, NativeSourceState>();
	for (const source of recordsOrEmpty(value)) {
		if (source.kind !== 'video') continue;
		const id = String(source.id);
		if (result.has(id)) throw new RangeError(`Duplicate V28 source identity ${id}.`);
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
			source.characteristics = framescaperVideoSourceCharacteristicsV24ProjectionV25(source);
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
