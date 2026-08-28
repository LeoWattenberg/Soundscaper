/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoSourceColorInterpretationV1 } from '../common/editor/video-color-management-v27.ts';
import { deriveVideoSourceColorInterpretationV1 } from '../common/editor/video-source-color-interpretation-v27.ts';
import { createDefaultFramescaperAudioFinishingFinishing } from './editor-audio-finishing-finishing.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsFinishing,
} from './editor-project-feature-requirements-finishing.ts';
import {
	createFramescaperProjectVisual,
	type FramescaperProjectVisual,
	type FramescaperProjectVisualOptions,
} from './editor-project-visual.ts';
import { FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectFinishingProfile } from './editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_PROJECT_FINISHING_SCHEMA_VERSION,
	normalizeFramescaperProjectFinishingStateFinishing,
	validateFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
} from './editor-project-finishing-validation.ts';

export {
	FRAMESCAPER_PROJECT_FINISHING_SCHEMA_VERSION,
	validateFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
} from './editor-project-finishing-validation.ts';

export interface FramescaperFinishingInputFinishing {
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

export type FramescaperProjectFinishingOptions = FramescaperProjectVisualOptions & Readonly<{
	readonly finishing?: FramescaperFinishingInputFinishing;
}>;

export function createFramescaperProjectFinishing(
	profile: unknown,
	options: FramescaperProjectFinishingOptions = {},
): FramescaperProjectFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	const { finishing = {}, ...v24Options } = options;
	const foundation = createFramescaperProjectVisual(
		FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE,
		v24Options,
	);
	return upgradeFoundation(profile, foundation, finishing);
}

export function cloneFramescaperProjectFinishing(
	profile: unknown,
	project: unknown,
): FramescaperProjectFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	validateFramescaperProjectFinishing(profile, project);
	const clone = structuredClone(project) as Record<string, unknown>;
	normalizeFramescaperProjectFinishingStateFinishing(clone);
	validateFramescaperProjectFinishing(profile, clone);
	return clone as unknown as FramescaperProjectFinishing;
}

function upgradeFoundation(
	profile: unknown,
	foundation: FramescaperProjectVisual,
	finishing: FramescaperFinishingInputFinishing,
): FramescaperProjectFinishing {
	const project = structuredClone(foundation) as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_FINISHING_SCHEMA_VERSION;
	stripLegacyEnvelopeAuthority(project);
	const defaults = createDefaultFramescaperAudioFinishingFinishing(project);
	project.videoColorContexts = structuredClone(finishing.colorContexts ?? defaultColorContexts(project));
	project.videoSourceColorInterpretations = structuredClone(
		finishing.sourceColorInterpretations ?? defaultSourceInterpretations(project),
	);
	project.videoVisualPresentations = structuredClone(finishing.visualPresentations ?? []);
	project.videoProcessorStacks = structuredClone(finishing.processorStacks ?? []);
	project.videoMotionAnalyses = structuredClone(finishing.motionAnalyses ?? []);
	project.videoFinishingPresets = structuredClone(finishing.finishingPresets ?? []);
	project.videoCaptionTracks = structuredClone(finishing.captionTracks ?? []);
	project.automationLanes = structuredClone(finishing.automationLanes ?? defaults.automationLanes);
	project.mixer = structuredClone(finishing.mixer ?? defaults.mixer);
	normalizeFramescaperProjectFinishingStateFinishing(project);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsFinishing(profile, project);
	validateFramescaperProjectFinishing(profile, project);
	return project as unknown as FramescaperProjectFinishing;
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
): readonly VideoSourceColorInterpretationV1[] {
	return records(project.sources, 'sources').flatMap((source) => {
		if (source.kind !== 'video' && source.kind !== 'still') return [];
		return [deriveVideoSourceColorInterpretationV1(source)];
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
