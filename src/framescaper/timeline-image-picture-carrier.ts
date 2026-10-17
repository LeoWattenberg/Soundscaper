/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeFramescaperImageClipV1 } from '../common/editor/timeline-image-model.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../common/editor/timeline-image-model-current-v1.ts';
import { framescaperImageDimensionsTimelineImage } from './editor-selected-timeline-image-image-frame-source.ts';
import { reconcileFramescaperProjectFeatureRequirementsNativeMedia } from './editor-project-feature-requirements-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { validateFramescaperProjectNativeMedia, type FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

/** Retain image timing/range authority as transparent nativeMedia visual nodes. */
export function createTimelineImagePictureCarrier(project: Readonly<Record<string, unknown>>): FramescaperProjectNativeMedia {
	const foundation = framescaperProjectNativeMediaFoundationShapeTimelineImage(project) as unknown as Record<string, unknown>;
	const imageClips = records(project.clips, 'timelineImage export clips')
		.filter(({ kind }) => kind === 'image')
		.map((clip) => normalizeFramescaperImageClipV1(clip));
	if (imageClips.length === 0) return foundation as unknown as FramescaperProjectNativeMedia;
	const imagesBySourceId = new Map(records(project.sources, 'timelineImage export sources')
		.filter(({ kind }) => kind === 'image')
		.map((source) => {
			const normalized = normalizeFramescaperImageSourceCurrentV1(source);
			return [normalized.id, normalized] as const;
		}));
	const sequences = new Map(records(project.sequences, 'timelineImage export sequences')
		.map((sequence) => [String(sequence.id), sequence] as const));
	const generatorSources = new Map<string, Record<string, unknown>>();
	const placeholderClips = new Map<string, Record<string, unknown>>();
	for (const clip of imageClips) {
		const source = imagesBySourceId.get(clip.sourceId);
		if (!source) throw new ReferenceError(`timelineImage export image source ${clip.sourceId} is unavailable.`);
		const sequence = sequences.get(clip.sequenceId);
		if (!sequence) throw new ReferenceError(`timelineImage export image sequence ${clip.sequenceId} is unavailable.`);
		const rate = rational(sequence.rate, `timelineImage export sequence ${clip.sequenceId} rate`);
		const existing = generatorSources.get(source.id);
		const frameCount = Math.max(clip.sequenceFrameCount, Number(existing?.frameCount ?? 0));
		generatorSources.set(source.id, {
			schemaVersion: 1,
			kind: 'generator',
			id: source.id,
			name: source.name,
			width: framescaperImageDimensionsTimelineImage(source).width,
			height: framescaperImageDimensionsTimelineImage(source).height,
			frameRate: rate,
			frameCount,
			generator: { kind: 'solid', color: '#00000000' },
		});
		placeholderClips.set(clip.id, {
			schemaVersion: 1,
			kind: 'generator',
			id: clip.id,
			sourceId: clip.sourceId,
			sequenceId: clip.sequenceId,
			sequenceStartFrame: clip.sequenceStartFrame,
			sequenceFrameCount: clip.sequenceFrameCount,
			sourceInFrame: 0,
			sourceFrameCount: clip.sequenceFrameCount,
		});
	}
	const inheritedClips = new Map(records(foundation.clips, 'timelineImage inherited export clips')
		.map((clip) => [String(clip.id), clip] as const));
	foundation.clips = records(project.clips, 'timelineImage canonical export clips').flatMap((clip) => {
		const id = String(clip.id);
		const placeholder = placeholderClips.get(id);
		if (placeholder) return [placeholder];
		const inherited = inheritedClips.get(id);
		return inherited ? [inherited] : [];
	});
	const canonicalTracks = new Map(records(project.tracks, 'timelineImage canonical export tracks')
		.map((track) => [String(track.id), track] as const));
	foundation.tracks = records(foundation.tracks, 'timelineImage inherited export tracks').map((track) => {
		const canonical = canonicalTracks.get(String(track.id));
		return canonical ? { ...track, clipIds: [...array(canonical.clipIds, 'timelineImage export track clip IDs')] } : track;
	});
	foundation.sources = [
		...records(foundation.sources, 'timelineImage inherited export sources'),
		...generatorSources.values(),
	];
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, foundation,
	);
	validateFramescaperProjectNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, foundation);
	return foundation as unknown as FramescaperProjectNativeMedia;
}

function rational(value: unknown, name: string): Readonly<{ readonly num: number; readonly den: number }> {
	const record = mutableRecord(value, name);
	if (!Number.isSafeInteger(record.num) || !Number.isSafeInteger(record.den)
		|| Number(record.num) < 1 || Number(record.den) < 1) throw new RangeError(`${name} is invalid.`);
	return Object.freeze({ num: Number(record.num), den: Number(record.den) });
}

function mutableRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function records(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError(`${name}[${String(index)}] must be an object.`);
		}
		return item as Readonly<Record<string, unknown>>;
	});
}
