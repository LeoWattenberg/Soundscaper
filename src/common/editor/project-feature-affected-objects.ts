/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitLowerOnly } from './lower-only-seam.ts';
import {
	PROJECT_FEATURE_AUDIO_EFFECT_TYPES,
	PROJECT_FEATURE_CAPABILITY_IDS,
} from './project-feature-capabilities.ts';
import type {
	ProjectFeatureAvailability,
	ProjectFeatureRequirementsReport,
	ProjectFeatureRequirementsReportItem,
} from './project-feature-requirements.ts';
import { VIDEO_EFFECT_TYPES } from './video-effects.js';
import { isMaintainedProjectFeatureSchema } from './project-schema-version.ts';

export const PROJECT_FEATURE_AFFECTED_OBJECT_LIMITS = Object.freeze({
	maximumAffectedObjects: 4_096,
	maximumStableIdLength: 256,
	maximumObjectTypeLength: 128,
});

export type ProjectFeatureAffectedObjectChannel =
	| 'audio-effect'
	| 'video-effect'
	| 'rendered-fallback-replaced';

export type ProjectFeatureAffectedObjectScope =
	| 'track'
	| 'group'
	| 'send'
	| 'master'
	| 'clip';

export type ProjectFeatureAffectedObjectLocation = 'timeline' | 'project-bin' | 'mixer' | 'master';

export interface ProjectFeatureAffectedObject {
	readonly channel: ProjectFeatureAffectedObjectChannel;
	readonly location: ProjectFeatureAffectedObjectLocation;
	readonly scope: ProjectFeatureAffectedObjectScope;
	readonly ownerId: string | null;
	readonly objectId: string;
	readonly objectType: string;
	/** False for a type outside the maintained first-party registry. Visibility only. */
	readonly registered: boolean;
}

export interface ProjectFeatureAffectedRequirement {
	readonly requirementId: string;
	readonly featureId: string;
	readonly availability: ProjectFeatureAvailability;
	/** False when no channel can name objects for this requirement. */
	readonly attributable: boolean;
	readonly objects: readonly ProjectFeatureAffectedObject[];
	readonly omittedObjectCount: number;
}

export interface ProjectFeatureAffectedObjectIndex {
	readonly schemaVersion: 1;
	readonly requirements: readonly ProjectFeatureAffectedRequirement[];
	readonly truncated: boolean;
}

export interface ProjectFeatureAffectedObjectOptions {
	/** Test seam: production limits may only be lowered. */
	readonly maximumAffectedObjects?: number;
}

type RecordValue = Readonly<Record<string, unknown>>;

const AUDIO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_FEATURE_AUDIO_EFFECT_TYPES);
const VIDEO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(VIDEO_EFFECT_TYPES as readonly string[]);
const AUDIO_RACK_SCOPES: readonly (readonly ['groups' | 'sends', 'group' | 'send'])[] = Object.freeze([
	Object.freeze(['groups', 'group'] as const),
	Object.freeze(['sends', 'send'] as const),
]);

/**
 * Enumerate the project objects each unavailable or unknown feature requirement
 * affects. This pass is strictly read-only: it never projects, mutates, or
 * bypasses anything. It is also total. Only an attempt to raise its ceiling
 * throws; an over-budget or unreadable object is skipped and disclosed through
 * the omitted count, because a snapshot-path throw would blank the editor.
 */
export function projectFeatureAffectedObjects<Project extends object>(
	project: Project,
	report: ProjectFeatureRequirementsReport | null | undefined,
	options: ProjectFeatureAffectedObjectOptions = {},
): ProjectFeatureAffectedObjectIndex | null {
	if (!isRecord(project)) return null;
	const projectRecord = project;
	if (!isMaintainedProjectFeatureSchema(dataProperty(projectRecord, 'schemaVersion'))) return null;
	if (report?.compatible !== false || report.format !== 'soundscaper-project') return null;
	if (!Array.isArray(report.items)) return null;
	const budget = new ObjectBudget(lowerOnlyLimit(
		options.maximumAffectedObjects,
		PROJECT_FEATURE_AFFECTED_OBJECT_LIMITS.maximumAffectedObjects,
		'maximumAffectedObjects',
	));
	const requirements: ProjectFeatureAffectedRequirement[] = [];
	for (const item of report.items) {
		if (item.availability !== 'unavailable' && item.availability !== 'unknown') continue;
		requirements.push(affectedRequirement(projectRecord, item, budget));
	}
	if (requirements.length === 0) return null;
	return Object.freeze({
		schemaVersion: 1 as const,
		requirements: Object.freeze(requirements),
		truncated: budget.truncated,
	});
}

class ObjectBudget {
	private remaining: number;
	truncated = false;

	constructor(maximum: number) {
		this.remaining = maximum;
	}

	/** Returns false once the shared ceiling is exhausted; never throws. */
	take(): boolean {
		if (this.remaining <= 0) {
			this.truncated = true;
			return false;
		}
		this.remaining -= 1;
		return true;
	}
}

function affectedRequirement(
	project: RecordValue,
	item: ProjectFeatureRequirementsReportItem,
	budget: ObjectBudget,
): ProjectFeatureAffectedRequirement {
	const objects: ProjectFeatureAffectedObject[] = [];
	let omitted = 0;
	let attributable = false;
	const collect = (candidate: ProjectFeatureAffectedObject | null): void => {
		// A null candidate is an object whose identity could not be read. It is
		// disclosed as omitted rather than throwing out of snapshot construction.
		if (!candidate) {
			omitted += 1;
			return;
		}
		attributable = true;
		if (budget.take()) objects.push(Object.freeze(candidate));
		else omitted += 1;
	};
	if (item.fallback) {
		collectRenderedFallbackObjects(project, item, collect);
	} else if (item.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioEffects) {
		collectAudioEffectObjects(project, collect);
	} else if (item.featureId === PROJECT_FEATURE_CAPABILITY_IDS.videoEffects) {
		collectVideoEffectObjects(project, collect);
	}
	return Object.freeze({
		requirementId: item.requirementId,
		featureId: item.featureId,
		availability: item.availability,
		attributable,
		objects: Object.freeze(objects),
		omittedObjectCount: omitted,
	});
}

type Collect = (candidate: ProjectFeatureAffectedObject | null) => void;

/**
 * A rendered fallback replaces canonical objects wholesale, so the affected set
 * is exactly computable from the role rather than inferred from a feature ID.
 */
function collectRenderedFallbackObjects(
	project: RecordValue,
	item: ProjectFeatureRequirementsReportItem,
	collect: Collect,
): void {
	const fallback = item.fallback;
	if (!fallback) return;
	// An owner whose own ID cannot be read takes its objects with it, so the drop
	// is disclosed through the omitted count rather than passing silently.
	const skipped = () => collect(null);
	if (fallback.role === 'project-audio-mix-v1') {
		eachAudioRack(project, skipped, (scope, location, ownerId) => {
			collect(rackObject('rendered-fallback-replaced', scope, location, ownerId));
		});
		eachClip(project, 'clips', 'timeline', skipped, (_clip, clipId, kind) => {
			if (kind === 'video') return;
			collect(clipObject('rendered-fallback-replaced', 'timeline', clipId, kind));
		});
		return;
	}
	if (fallback.role === 'project-video-render-v1') {
		// The projection collapses video tracks as well as video clips, so naming
		// only the clips would leave a video-track-only project reporting nothing.
		eachVideoTrack(project, skipped, (trackId) => {
			collect(rackObject('rendered-fallback-replaced', 'track', 'timeline', trackId));
		});
		eachClip(project, 'clips', 'timeline', skipped, (_clip, clipId, kind) => {
			if (kind !== 'video') return;
			collect(clipObject('rendered-fallback-replaced', 'timeline', clipId, kind));
		});
		return;
	}
	if (fallback.role === 'audio-track-render-v1') {
		// The projection replaces one track's clip lane and effect rack, so the
		// replaced surface is that track plus each clip its lane anchors.
		const laneClipIds = new Set<string>();
		eachAudioRack(project, skipped, (scope, location, ownerId, owner) => {
			if (scope !== 'track' || ownerId !== fallback.targetTrackId) return;
			collect(rackObject('rendered-fallback-replaced', scope, location, ownerId));
			const clipIds = dataProperty(owner, 'clipIds');
			if (!Array.isArray(clipIds)) return;
			clipIds.forEach((clipId) => {
				const laneClipId = stableId(clipId);
				if (laneClipId) laneClipIds.add(laneClipId);
				else collect(null);
			});
		});
		eachClip(project, 'clips', 'timeline', skipped, (_clip, clipId, kind) => {
			if (!laneClipIds.has(clipId)) return;
			collect(clipObject('rendered-fallback-replaced', 'timeline', clipId, kind));
		});
		return;
	}
	eachClip(project, 'clips', 'timeline', skipped, (_clip, clipId, kind) => {
		if (clipId !== fallback.targetClipId) return;
		collect(clipObject('rendered-fallback-replaced', 'timeline', clipId, kind));
	});
}

/**
 * Only types outside the maintained registry are collected. Registered effects
 * already have their own placeholder section, so listing them here would spend
 * the shared ceiling on rows the notice discards.
 */
function collectAudioEffectObjects(project: RecordValue, collect: Collect): void {
	const skipped = () => collect(null);
	eachAudioRack(project, skipped, (scope, location, ownerId, owner) => {
		if (dataProperty(owner, 'effectsActive') === false) return;
		const effects = dataProperty(owner, 'effects');
		if (!Array.isArray(effects)) return;
		effects.forEach((value) => {
			if (!isRecord(value)) return;
			if (dataProperty(value, 'enabled') === false) return;
			if (dataProperty(value, 'bypassed') === true) return;
			const effectType = dataProperty(value, 'type');
			if (typeof effectType !== 'string' || !effectType) return;
			if (AUDIO_EFFECT_TYPE_SET.has(effectType)) return;
			const objectId = stableId(dataProperty(value, 'id'));
			const objectType = boundedType(effectType);
			if (!objectId || !objectType) {
				collect(null);
				return;
			}
			collect({
				channel: 'audio-effect',
				location,
				scope,
				ownerId,
				objectId,
				objectType,
				registered: false,
			});
		});
	});
}

function collectVideoEffectObjects(project: RecordValue, collect: Collect): void {
	const skipped = () => collect(null);
	for (const [key, location] of [['clips', 'timeline'], ['projectBin', 'project-bin']] as const) {
		eachClip(project, key, location, skipped, (clip, clipId, kind) => {
			if (kind !== 'video') return;
			const effects = dataProperty(clip, 'videoEffects');
			if (!Array.isArray(effects)) return;
			effects.forEach((value) => {
				if (!isRecord(value)) return;
				if (dataProperty(value, 'enabled') === false) return;
				const effectType = dataProperty(value, 'type');
				if (typeof effectType !== 'string' || !effectType) return;
				if (VIDEO_EFFECT_TYPE_SET.has(effectType)) return;
				const objectId = stableId(dataProperty(value, 'id'));
				const objectType = boundedType(effectType);
				if (!objectId || !objectType) {
					collect(null);
					return;
				}
				collect({
					channel: 'video-effect',
					location,
					scope: 'clip',
					ownerId: clipId,
					objectId,
					objectType,
					registered: false,
				});
			});
		});
	}
}

function eachAudioRack(
	project: RecordValue,
	onSkipped: () => void,
	visit: (
		scope: ProjectFeatureAffectedObjectScope,
		location: ProjectFeatureAffectedObjectLocation,
		ownerId: string | null,
		owner: RecordValue,
	) => void,
): void {
	const tracks = dataProperty(project, 'tracks');
	if (Array.isArray(tracks)) {
		tracks.forEach((owner) => {
			if (!isRecord(owner)) return;
			const type = dataProperty(owner, 'type');
			if (type === 'label' || type === 'video') return;
			const ownerId = stableId(dataProperty(owner, 'id'));
			if (ownerId) visit('track', 'timeline', ownerId, owner);
			else onSkipped();
		});
	}
	const mixer = dataProperty(project, 'mixer');
	if (isRecord(mixer)) {
		for (const [key, scope] of AUDIO_RACK_SCOPES) {
			const owners = dataProperty(mixer, key);
			if (!Array.isArray(owners)) continue;
			owners.forEach((owner) => {
				if (!isRecord(owner)) return;
				const ownerId = stableId(dataProperty(owner, 'id'));
				if (ownerId) visit(scope, 'mixer', ownerId, owner);
				else onSkipped();
			});
		}
	}
	const master = dataProperty(project, 'master');
	if (isRecord(master)) visit('master', 'master', null, master);
}

function eachVideoTrack(
	project: RecordValue,
	onSkipped: () => void,
	visit: (trackId: string) => void,
): void {
	const tracks = dataProperty(project, 'tracks');
	if (!Array.isArray(tracks)) return;
	tracks.forEach((owner) => {
		if (!isRecord(owner) || dataProperty(owner, 'type') !== 'video') return;
		const trackId = stableId(dataProperty(owner, 'id'));
		if (trackId) visit(trackId);
		else onSkipped();
	});
}

function eachClip(
	project: RecordValue,
	key: 'clips' | 'projectBin',
	location: ProjectFeatureAffectedObjectLocation,
	onSkipped: () => void,
	visit: (clip: RecordValue, clipId: string, kind: unknown) => void,
): void {
	void location;
	const container = dataProperty(project, key);
	const clips = key === 'projectBin'
		? (isRecord(container) ? dataProperty(container, 'clips') : undefined)
		: container;
	if (!Array.isArray(clips)) return;
	clips.forEach((clip) => {
		if (!isRecord(clip)) return;
		const clipId = stableId(dataProperty(clip, 'id'));
		if (clipId) visit(clip, clipId, dataProperty(clip, 'kind'));
		else onSkipped();
	});
}

function rackObject(
	channel: ProjectFeatureAffectedObjectChannel,
	scope: ProjectFeatureAffectedObjectScope,
	location: ProjectFeatureAffectedObjectLocation,
	ownerId: string | null,
): ProjectFeatureAffectedObject {
	return {
		channel,
		location,
		scope,
		ownerId: null,
		objectId: ownerId ?? 'master',
		objectType: scope,
		registered: true,
	};
}

function clipObject(
	channel: ProjectFeatureAffectedObjectChannel,
	location: ProjectFeatureAffectedObjectLocation,
	clipId: string,
	kind: unknown,
): ProjectFeatureAffectedObject {
	return {
		channel,
		location,
		scope: 'clip',
		ownerId: null,
		objectId: clipId,
		objectType: (typeof kind === 'string' && boundedType(kind)) || 'clip',
		registered: true,
	};
}

function boundedType(value: string): string | null {
	return boundedString(value, PROJECT_FEATURE_AFFECTED_OBJECT_LIMITS.maximumObjectTypeLength);
}

function stableId(value: unknown): string | null {
	return boundedString(value, PROJECT_FEATURE_AFFECTED_OBJECT_LIMITS.maximumStableIdLength);
}

/** Returns null rather than throwing: this pass runs on the snapshot path. */
function boundedString(value: unknown, maximumLength: number): string | null {
	if (typeof value !== 'string' || !value || value.length > maximumLength) return null;
	return value;
}

function lowerOnlyLimit(value: unknown, production: number, name: string): number {
	return admitLowerOnly(value, {
		ceiling: production,
		floor: 0,
		absent: 'ceiling',
		refuse: (refusal) => new RangeError(refusal === 'ceiling'
			? `${name} cannot raise the production limit.`
			: `${name} must be a non-negative safe integer.`),
	});
}

function isRecord(value: unknown): value is RecordValue {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** An accessor is treated as absent rather than invoked or thrown on. */
function dataProperty(value: RecordValue, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined;
	return descriptor.value;
}
