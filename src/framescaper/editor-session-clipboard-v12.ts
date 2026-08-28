/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard } from '../common/editor/commands/protocol.ts';
import { assertOfxEffectStateV26, type OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import { normalizeFramescaperProfessionalVideoSourceProfessionalMedia } from './editor-project-professional-media.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { validateFramescaperProjectNativeMedia, type FramescaperProjectNativeMedia } from './editor-project-native-media.ts';
import {
	createFramescaperSessionClipboardV11,
	normalizeFramescaperSessionClipboardV11,
	type FramescaperSessionClipboardV11,
} from './editor-session-clipboard-v11.ts';

export interface FramescaperSessionClipboardV12 extends Omit<FramescaperSessionClipboardV11, 'schemaVersion'> {
	readonly schemaVersion: 12;
	readonly ofxEffects: readonly OfxEffectStateV26[];
}

const FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'descriptor', 'sources',
	'clipBindings', 'finishing', 'ofxEffects',
]);

/** Snapshot one selected nativeMedia edit graph, including professional source and OFX state. */
export function createFramescaperSessionClipboardV12(
	profile: unknown,
	projectValue: unknown,
	descriptor: AudioEditorClipboard,
): FramescaperSessionClipboardV12 {
	validateFramescaperProjectNativeMedia(profile, projectValue);
	const project = projectValue as FramescaperProjectNativeMedia;
	const foundation = createFramescaperSessionClipboardV11(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		framescaperProjectFinishingFoundationShapeNativeMedia(project),
		descriptor,
	);
	const selectedSourceIds = new Set(foundation.sources.map(({ id }) => id));
	const projectSources = new Map(records(project.sources, 'nativeMedia clipboard sources').map((source) => [String(source.id), source]));
	const sources = foundation.sources.map((source) => {
		const selected = projectSources.get(source.id);
		if (!selected) throw new ReferenceError(`nativeMedia clipboard source ${source.id} disappeared.`);
		return selected.kind === 'video' ? normalizeFramescaperProfessionalVideoSourceProfessionalMedia(selected) : structuredClone(source);
	});
	const selectedClipIds = new Set(foundation.clipBindings.map(({ clipId }) => clipId));
	const ofxEffects = project.ofxEffects.filter((effect) => effectBelongsToSelection(
		effect, selectedSourceIds, selectedClipIds,
	));
	return normalizeFramescaperSessionClipboardV12({
		...foundation,
		schemaVersion: 12,
		sources,
		ofxEffects,
	});
}

/** Exact V12-only persisted clipboard admission; older clipboards require re-copy. */
export function normalizeFramescaperSessionClipboardV12(value: unknown): FramescaperSessionClipboardV12 {
	const input = closedRecord(value, FIELDS, 'Framescaper session clipboard V12');
	if (input.schemaVersion !== 12) throw new RangeError('Framescaper session clipboard requires V12 re-copy.');
	const foundation = normalizeFramescaperSessionClipboardV11(v11Carrier(input));
	const selectedSourceIds = new Set(foundation.sources.map(({ id }) => id));
	const sources = foundation.sources.map((source) => {
		if ((source as Readonly<Record<string, unknown>>).kind !== 'video') return structuredClone(source);
		const normalized = normalizeFramescaperProfessionalVideoSourceProfessionalMedia(source);
		if (!selectedSourceIds.has(normalized.id)) throw new ReferenceError('V12 professional source is detached.');
		return normalized;
	});
	const selectedClipIds = new Set(foundation.clipBindings.map(({ clipId }) => clipId));
	if (!Array.isArray(input.ofxEffects) || input.ofxEffects.length > 100_000) {
		throw new RangeError('V12 OpenFX clipboard state must be a bounded array.');
	}
	const ids = new Set<string>();
	const ofxEffects = input.ofxEffects.map((effectValue) => {
		const effect = structuredClone(effectValue) as OfxEffectStateV26;
		assertOfxEffectStateV26(effect);
		if (ids.has(effect.instanceId)) throw new RangeError('V12 OpenFX instance IDs must be unique.');
		if (!effectBelongsToSelection(effect, selectedSourceIds, selectedClipIds)) {
			throw new ReferenceError('V12 OpenFX state is not owned by the selected clipboard graph.');
		}
		ids.add(effect.instanceId);
		return deepFreeze(effect);
	});
	return deepFreeze({
		...foundation,
		schemaVersion: 12 as const,
		sources,
		ofxEffects,
	});
}

export function framescaperSessionClipboardV11FoundationV12(
	value: unknown,
): FramescaperSessionClipboardV11 {
	const clipboard = normalizeFramescaperSessionClipboardV12(value);
	return normalizeFramescaperSessionClipboardV11(v11Carrier(clipboard as unknown as Record<string, unknown>));
}

function v11Carrier(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const { ofxEffects: _ofxEffects, ...foundation } = value;
	return { ...foundation, schemaVersion: 11 };
}

function effectBelongsToSelection(
	effect: OfxEffectStateV26,
	sourceIds: ReadonlySet<string>,
	clipIds: ReadonlySet<string>,
): boolean {
	const selected = (id: string) => sourceIds.has(id) || clipIds.has(id);
	if (!selected(effect.attachment.targetId)) return false;
	if (effect.inputs.some(({ sourceRef }) => !selected(sourceRef))) return false;
	return effect.frozenFallback === null || selected(effect.frozenFallback.externalMediaSourceId);
}

function closedRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be exact.`);
	}
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${name}[${String(index)}] must be an object.`);
		return item as Record<string, unknown>;
	});
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
