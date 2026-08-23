/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defaultVideoSourceColorInterpretationV1,
	type VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import { createDefaultFramescaperAudioFinishingV27 } from './editor-audio-finishing-v27.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV22,
} from './editor-project-feature-requirements-v22.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV24,
} from './editor-project-feature-requirements-v24.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV27,
} from './editor-project-feature-requirements-v27.ts';
import {
	readFramescaperProjectSchemaVersion,
	snapshotFramescaperOpaqueProject,
} from './editor-project-v18.ts';
import {
	cloneFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import {
	cloneFramescaperProjectV22,
	type FramescaperProjectV22,
} from './editor-project-v22.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v22.ts';
import {
	cloneFramescaperProjectV24,
	createFramescaperProjectV24,
	type FramescaperProjectV24,
	type FramescaperProjectV24Options,
} from './editor-project-v24.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v24.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import {
	FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION,
	normalizeFramescaperProjectFinishingStateV27,
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27-validation.ts';

export {
	FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION,
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27-validation.ts';

export interface FramescaperFinishingInputV27 {
	readonly colorContexts?: readonly unknown[];
	readonly sourceColorInterpretations?: readonly unknown[];
	readonly visualPresentations?: readonly unknown[];
	readonly processorStacks?: readonly unknown[];
	readonly motionAnalyses?: readonly unknown[];
	readonly finishingPresets?: readonly unknown[];
	readonly captionTracks?: readonly unknown[];
	readonly automationLanes?: readonly unknown[];
	readonly mixer?: unknown;
}

export type FramescaperProjectV27Options = FramescaperProjectV24Options & Readonly<{
	readonly finishing?: FramescaperFinishingInputV27;
}>;

export interface LoadedFramescaperProjectV27 {
	readonly project: FramescaperProjectV27 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'known-dormant-custody' | 'newer-schema' | null;
}

export class FramescaperProjectV27ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	readonly schemaVersion: number;
	constructor(schemaVersion: number) {
		super(schemaVersion === 20 || schemaVersion === 22 || schemaVersion === 24
			? `Framescaper V${String(schemaVersion)} requires explicit reimport into V27.`
			: `Framescaper schema ${String(schemaVersion)} is not an admitted V27 reimport source.`);
		this.name = 'FramescaperProjectV27ReimportRequiredError';
		this.schemaVersion = schemaVersion;
	}
}

export function createFramescaperProjectV27(
	profile: unknown,
	options: FramescaperProjectV27Options = {},
): FramescaperProjectV27 {
	assertFramescaperProjectV27Profile(profile);
	const { finishing = {}, ...v24Options } = options;
	const foundation = createFramescaperProjectV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		v24Options,
	);
	return upgradeFoundation(profile, foundation, finishing, false);
}

export function cloneFramescaperProjectV27(
	profile: unknown,
	project: unknown,
): FramescaperProjectV27 {
	assertFramescaperProjectV27Profile(profile);
	validateFramescaperProjectV27(profile, project);
	const clone = structuredClone(project) as Record<string, unknown>;
	normalizeFramescaperProjectFinishingStateV27(clone);
	validateFramescaperProjectV27(profile, clone);
	return clone as unknown as FramescaperProjectV27;
}

export function loadFramescaperProjectV27(
	profile: unknown,
	value: unknown,
): LoadedFramescaperProjectV27 {
	assertFramescaperProjectV27Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion === 25 || schemaVersion === 26) {
		return Object.freeze({
			project: snapshotFramescaperOpaqueProject(value),
			readOnly: true,
			intrinsicReadOnly: true,
			reason: 'known-dormant-custody' as const,
		});
	}
	if (schemaVersion > FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION) {
		return Object.freeze({
			project: snapshotFramescaperOpaqueProject(value),
			readOnly: true,
			intrinsicReadOnly: true,
			reason: 'newer-schema' as const,
		});
	}
	if (schemaVersion !== FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION) {
		throw new FramescaperProjectV27ReimportRequiredError(schemaVersion);
	}
	return Object.freeze({
		project: cloneFramescaperProjectV27(profile, value),
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	});
}

/** The only path that interprets V20/V22/V24 state as a writable V27 project. */
export function reimportFramescaperProjectV27(
	profile: unknown,
	value: unknown,
): FramescaperProjectV27 {
	assertFramescaperProjectV27Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion === 25 || schemaVersion === 26) {
		throw new RangeError(`Dormant Framescaper V${String(schemaVersion)} remains opaque read-only custody and cannot be reimported.`);
	}
	const foundation = schemaVersion === 24 ? cloneFramescaperProjectV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, value,
	) : schemaVersion === 22 ? v24FromV22(cloneFramescaperProjectV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, value,
	)) : schemaVersion === 20 ? v24FromV20(cloneFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, value,
	)) : null;
	if (foundation === null) throw new FramescaperProjectV27ReimportRequiredError(schemaVersion);
	return upgradeFoundation(profile, foundation, {}, true);
}

function upgradeFoundation(
	profile: unknown,
	foundation: FramescaperProjectV24,
	finishing: FramescaperFinishingInputV27,
	legacy: boolean,
): FramescaperProjectV27 {
	const project = structuredClone(foundation) as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION;
	stripLegacyEnvelopeAuthority(project);
	const defaults = createDefaultFramescaperAudioFinishingV27(project);
	project.videoColorContexts = structuredClone(finishing.colorContexts ?? defaultColorContexts(project));
	project.videoSourceColorInterpretations = structuredClone(
		finishing.sourceColorInterpretations ?? defaultSourceInterpretations(project, legacy),
	);
	project.videoVisualPresentations = structuredClone(finishing.visualPresentations ?? []);
	project.videoProcessorStacks = structuredClone(finishing.processorStacks ?? []);
	project.videoMotionAnalyses = structuredClone(finishing.motionAnalyses ?? []);
	project.videoFinishingPresets = structuredClone(finishing.finishingPresets ?? []);
	project.videoCaptionTracks = structuredClone(finishing.captionTracks ?? []);
	project.automationLanes = structuredClone(finishing.automationLanes ?? defaults.automationLanes);
	project.mixer = structuredClone(finishing.mixer ?? defaults.mixer);
	normalizeFramescaperProjectFinishingStateV27(project);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(profile, project);
	validateFramescaperProjectV27(profile, project);
	return project as unknown as FramescaperProjectV27;
}

function v24FromV20(project: FramescaperProjectV20): FramescaperProjectV24 {
	const v22 = structuredClone(project) as unknown as Record<string, unknown>;
	v22.schemaVersion = 22;
	for (const track of records(v22.tracks, 'tracks')) {
		if (track.type === 'video') track.videoTransitions = [];
	}
	v22.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		v22,
	);
	return v24FromV22(v22 as unknown as FramescaperProjectV22);
}

function v24FromV22(project: FramescaperProjectV22): FramescaperProjectV24 {
	const v24 = structuredClone(project) as unknown as Record<string, unknown>;
	v24.schemaVersion = 24;
	v24.videoAdjustmentLayers = [];
	v24.videoVisualPresets = [];
	v24.videoMaskMattes = [];
	v24.videoFreezeFallbacks = [];
	v24.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		v24,
	);
	return cloneFramescaperProjectV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, v24);
}

function stripLegacyEnvelopeAuthority(project: Record<string, unknown>): void {
	for (const track of records(project.tracks, 'tracks')) {
		if (track.type === 'audio') delete track.envelope;
	}
	delete record(project.master, 'master').envelope;
}

function defaultColorContexts(project: Record<string, unknown>): readonly unknown[] {
	return records(project.sequences, 'sequences').map((sequence) => ({
		schemaVersion: 1,
		sequenceId: id(sequence, 'sequence'),
		workingSpace: 'linear-rec709-d65',
		outputSpace: 'rec709',
		alphaMode: 'straight-authored-premultiplied-working',
		toneMapping: 'none',
	}));
}

function defaultSourceInterpretations(
	project: Record<string, unknown>,
	legacy: boolean,
): readonly VideoSourceColorInterpretationV1[] {
	return records(project.sources, 'sources').flatMap((source) => {
		if (source.kind !== 'video' && source.kind !== 'still') return [];
		const interpretation = defaultVideoSourceColorInterpretationV1(source.kind, id(source, 'source'));
		return [legacy ? Object.freeze({ ...interpretation, provenance: 'legacy-unmanaged-encoded' as const }) : interpretation];
	});
}

function id(value: Record<string, unknown>, name: string): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError(`${name}.id must be non-empty.`);
	return value.id;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
