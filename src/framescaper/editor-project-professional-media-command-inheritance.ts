/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoSourceCharacteristicsV25 } from '../common/editor/video-source-professional-characteristics-v25.ts';
import { FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandVisual,
	type FramescaperProjectCommandOptionsVisual,
} from './editor-project-visual-commands.ts';
import {
	framescaperProjectVisualFoundationProfessionalMedia,
	normalizeFramescaperProjectProfessionalMediaProfessionalMedia,
	validateFramescaperProjectProfessionalMedia,
	type FramescaperProjectProfessionalMedia,
} from './editor-project-professional-media-validation.ts';
import {
	framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia,
	framescaperVideoSourceRateProfessionalMedia,
} from './editor-project-professional-media-foundation.ts';

/** Apply exact visual authority and restore only still-valid professionalMedia professional facts. */
export function applyInheritedFramescaperProjectCommandProfessionalMedia(
	profile: unknown,
	project: FramescaperProjectProfessionalMedia,
	command: unknown,
	options: FramescaperProjectCommandOptionsVisual,
): FramescaperProjectProfessionalMedia {
	const foundation = framescaperProjectVisualFoundationProfessionalMedia(profile, project);
	const applied = applyFramescaperProjectCommandVisual(
		FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE,
		foundation,
		command,
		options,
	) as unknown as Record<string, unknown>;
	const oldSources = new Map(records(project.sources, 'sources').map((source) => [String(source.id), source]));
	applied.schemaVersion =  1;
	applied.sources = records(applied.sources, 'sources').map((source) => {
		if (source.kind !== 'video') return source;
		const prior = oldSources.get(String(source.id));
		if (prior?.kind === 'video'
			&& same(source.characteristics, framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia(prior))) {
			source.characteristics = structuredClone(prior.characteristics);
			source.imageSequence = imageSequenceAuthorityUnchanged(prior, source)
				? structuredClone(prior.imageSequence) : null;
		} else {
			source.characteristics = normalizeVideoSourceCharacteristicsV25(source.characteristics, {
				rate: framescaperVideoSourceRateProfessionalMedia(source),
			});
			source.imageSequence = null;
		}
		return source;
	});
	normalizeFramescaperProjectProfessionalMediaProfessionalMedia(profile, applied);
	validateFramescaperProjectProfessionalMedia(profile, applied);
	return applied as unknown as FramescaperProjectProfessionalMedia;
}

function imageSequenceAuthorityUnchanged(
	before: Readonly<Record<string, unknown>>,
	after: Readonly<Record<string, unknown>>,
): boolean {
	return ['id', 'name', 'storageKey', 'contentSha256', 'sourceFrameCount', 'frameRate']
		.every((field) => same(before[field], after[field]));
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`Framescaper professionalMedia ${name} must be an array.`);
	return value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError(`Framescaper professionalMedia ${name} item must be an object.`);
		}
		return item as Record<string, unknown>;
	});
}
