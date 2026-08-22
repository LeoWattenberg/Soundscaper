/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoSourceCharacteristicsV25 } from '../common/editor/video-source-professional-characteristics-v25.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v24.ts';
import {
	applyFramescaperProjectCommandV24,
	type FramescaperProjectCommandOptionsV24,
} from './editor-project-v24-commands.ts';
import {
	framescaperProjectV24FoundationV25,
	normalizeFramescaperProjectProfessionalMediaV25,
	validateFramescaperProjectV25,
	type FramescaperProjectV25,
} from './editor-project-v25-validation.ts';
import {
	framescaperVideoSourceCharacteristicsV24ProjectionV25,
	framescaperVideoSourceRateV25,
} from './editor-project-v25-foundation.ts';

/** Apply exact V24 authority and restore only still-valid V25 professional facts. */
export function applyInheritedFramescaperProjectCommandV25(
	profile: unknown,
	project: FramescaperProjectV25,
	command: unknown,
	options: FramescaperProjectCommandOptionsV24,
): FramescaperProjectV25 {
	const foundation = framescaperProjectV24FoundationV25(profile, project);
	const applied = applyFramescaperProjectCommandV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		foundation,
		command,
		options,
	) as unknown as Record<string, unknown>;
	const oldSources = new Map(records(project.sources, 'sources').map((source) => [String(source.id), source]));
	applied.schemaVersion = 25;
	applied.sources = records(applied.sources, 'sources').map((source) => {
		if (source.kind !== 'video') return source;
		const prior = oldSources.get(String(source.id));
		if (prior?.kind === 'video'
			&& same(source.characteristics, framescaperVideoSourceCharacteristicsV24ProjectionV25(prior))) {
			source.characteristics = structuredClone(prior.characteristics);
			source.imageSequence = imageSequenceAuthorityUnchanged(prior, source)
				? structuredClone(prior.imageSequence) : null;
		} else {
			source.characteristics = normalizeVideoSourceCharacteristicsV25(source.characteristics, {
				rate: framescaperVideoSourceRateV25(source),
			});
			source.imageSequence = null;
		}
		return source;
	});
	normalizeFramescaperProjectProfessionalMediaV25(profile, applied);
	validateFramescaperProjectV25(profile, applied);
	return applied as unknown as FramescaperProjectV25;
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
	if (!Array.isArray(value)) throw new TypeError(`Framescaper V25 ${name} must be an array.`);
	return value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError(`Framescaper V25 ${name} item must be an object.`);
		}
		return item as Record<string, unknown>;
	});
}
