/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeNativeMediaImageSequenceSourceV25,
	type NativeMediaImageSequenceSourceV25,
} from '../common/editor/native-media-image-sequence-v25.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
	type VideoSourceCharacteristicsV25,
} from '../common/editor/video-source-professional-characteristics-v25.ts';
import {
	framescaperProjectFeatureRequirementsForVisualFoundationProfessionalMedia,
	reconcileFramescaperProjectFeatureRequirementsProfessionalMedia,
	validateFramescaperProjectFeatureRequirementsProfessionalMedia,
} from './editor-project-feature-requirements-professional-media.ts';
import {
	framescaperProjectVisualFoundationShapeProfessionalMedia,
	framescaperVideoSourceRateProfessionalMedia,
} from './editor-project-professional-media-foundation.ts';
import { FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectProfessionalMediaCandidateProfile } from './editor-domain-runtime-profile.ts';
import { validateFramescaperProjectVisual, type FramescaperProjectVisual } from './editor-project-visual.ts';

export const FRAMESCAPER_PROJECT_PROFESSIONAL_MEDIA_SCHEMA_VERSION = 1 as const;

export interface FramescaperProfessionalVideoSourceProfessionalMedia extends Readonly<Record<string, unknown>> {
	readonly kind: 'video';
	readonly id: string;
	readonly characteristics: VideoSourceCharacteristicsV25;
	readonly imageSequence: NativeMediaImageSequenceSourceV25 | null;
	readonly proxyAttachment: Readonly<VideoProxyAttachmentV18> | null;
}

export interface FramescaperProjectProfessionalMedia extends Omit<FramescaperProjectVisual, 'schemaVersion' | 'sources'> {
	readonly schemaFamily: 'framescaper';
	readonly id: string;
	readonly schemaVersion: 1;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly (FramescaperProfessionalVideoSourceProfessionalMedia | Readonly<Record<string, unknown>>)[];
}

export function validateFramescaperProjectProfessionalMedia(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectProfessionalMedia {
	assertFramescaperProjectProfessionalMediaCandidateProfile(profile);
	const candidate = record(project, 'Framescaper professionalMedia project');
	if (data(candidate, 'schemaVersion') !== FRAMESCAPER_PROJECT_PROFESSIONAL_MEDIA_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(data(candidate, 'schemaVersion'))}.`);
	}
	validateProfessionalSourceOwnership(candidate);
	validateFramescaperProjectVisual(
		FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE,
		framescaperProjectVisualFoundationProfessionalMedia(profile, candidate),
	);
	validateFramescaperProjectFeatureRequirementsProfessionalMedia(profile, candidate);
	return true;
}

/** Detached visual authority used by professionalMedia itself and by cumulative openFx validation. */
export function framescaperProjectVisualFoundationProfessionalMedia(
	profile: unknown,
	project: unknown,
): FramescaperProjectVisual {
	assertFramescaperProjectProfessionalMediaCandidateProfile(profile);
	const foundation = framescaperProjectVisualFoundationShapeProfessionalMedia(project);
	foundation.featureRequirements = framescaperProjectFeatureRequirementsForVisualFoundationProfessionalMedia(
		profile,
		project,
	);
	return foundation as unknown as FramescaperProjectVisual;
}

export function normalizeFramescaperProjectProfessionalMediaProfessionalMedia(
	profile: unknown,
	project: Record<string, unknown>,
): void {
	assertFramescaperProjectProfessionalMediaCandidateProfile(profile);
	for (const source of records(data(project, 'sources'), 'sources')) {
		if (source.kind !== 'video') continue;
		source.characteristics = normalizeVideoSourceCharacteristicsV25(source.characteristics, {
			rate: framescaperVideoSourceRateProfessionalMedia(source),
		});
		if (!Object.hasOwn(source, 'imageSequence')) source.imageSequence = null;
		if (source.imageSequence !== null) {
			const sequence = normalizeNativeMediaImageSequenceSourceV25(source.imageSequence);
			source.imageSequence = normalizeNativeMediaImageSequenceSourceV25({
				...sequence,
				characteristics: source.characteristics,
			});
		}
		if (source.proxyAttachment !== null) {
			source.proxyAttachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		}
	}
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsProfessionalMedia(profile, project);
}

/** Clipboard and archive code can normalize one selected source without a project rewrite. */
export function normalizeFramescaperProfessionalVideoSourceProfessionalMedia(
	value: unknown,
): FramescaperProfessionalVideoSourceProfessionalMedia {
	const source = structuredClone(record(value, 'Framescaper professionalMedia video source')) as Record<string, unknown>;
	if (source.kind !== 'video') throw new TypeError('Framescaper professionalMedia professional media requires a video source.');
	if (!Object.hasOwn(source, 'imageSequence')) throw new TypeError('professionalMedia video source imageSequence is required.');
	source.characteristics = normalizeVideoSourceCharacteristicsV25(source.characteristics, {
		rate: framescaperVideoSourceRateProfessionalMedia(source),
	});
	if (source.imageSequence !== null) {
		source.imageSequence = normalizeNativeMediaImageSequenceSourceV25(source.imageSequence);
	}
	if (source.proxyAttachment !== null) source.proxyAttachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
	validateProfessionalVideoSource(source);
	return source as FramescaperProfessionalVideoSourceProfessionalMedia;
}

function validateProfessionalSourceOwnership(project: Record<string, unknown>): void {
	for (const source of records(data(project, 'sources'), 'sources')) {
		if (source.kind !== 'video') {
			if (Object.hasOwn(source, 'imageSequence')) {
				throw new TypeError(`Framescaper audio source ${String(source.id)} must not carry imageSequence.`);
			}
			continue;
		}
		if (!Object.hasOwn(source, 'imageSequence')) {
			throw new TypeError(`professionalMedia video source ${String(source.id)} imageSequence is required.`);
		}
		validateProfessionalVideoSource(source);
	}
}

function validateProfessionalVideoSource(source: Record<string, unknown>): void {
	const characteristics = normalizeVideoSourceCharacteristicsV25(source.characteristics, {
		rate: framescaperVideoSourceRateProfessionalMedia(source),
	});
	assertCanonical(source.characteristics, characteristics, 'professional source characteristics');
	if (source.imageSequence !== null) {
		const sequence = normalizeNativeMediaImageSequenceSourceV25(source.imageSequence);
		assertCanonical(source.imageSequence, sequence, 'image-sequence source');
		if (sequence.id !== source.id || sequence.name !== source.name) {
			throw new RangeError('An image-sequence descriptor must bind its owning source identity and name.');
		}
		if (JSON.stringify(sequence.frameRate) !== JSON.stringify(source.frameRate)
			|| sequence.frameCount !== source.sourceFrameCount) {
			throw new RangeError('An image-sequence descriptor must bind its owning source frame authority.');
		}
		if (sequence.sourcePack.storageKey !== source.storageKey
			|| sequence.sourcePack.sha256 !== source.contentSha256) {
			throw new RangeError('An image-sequence source pack must bind the owning source storage and digest.');
		}
		if (JSON.stringify(sequence.characteristics) !== JSON.stringify(characteristics)) {
			throw new RangeError('An image-sequence descriptor must use its owning source characteristics.');
		}
	}
	if (source.proxyAttachment !== null) {
		const attachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		assertCanonical(source.proxyAttachment, attachment, 'video proxy attachment');
		if (attachment.originalSha256 !== source.contentSha256
			|| attachment.frameCount !== source.sourceFrameCount) {
			throw new RangeError('A professionalMedia proxy attachment must bind its owning original and frame authority.');
		}
	}
}

function assertCanonical(value: unknown, normalized: unknown, name: string): void {
	if (JSON.stringify(value) !== JSON.stringify(normalized)) throw new RangeError(`professionalMedia ${name} is not canonical.`);
}

function data(value: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${key} must be data.`);
	return descriptor.value;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
