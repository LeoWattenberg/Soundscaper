/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAudioEditorClipboardDescriptor,
} from '../common/editor/commands/clipboard-codec.ts';
import type { AudioEditorClipboard } from '../common/editor/commands/protocol.ts';
import {
	normalizeAudioEditorSessionClipboard,
	type AudioEditorSessionClipboardSource,
} from '../common/editor/session-clipboard-codec.ts';
import {
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { validateFramescaperProjectTimelineImage, type FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	createFramescaperSessionClipboardV12,
	normalizeFramescaperSessionClipboardV12,
	type FramescaperSessionClipboardV12,
} from './editor-session-clipboard-v12.ts';
import {
	normalizeFramescaperClipboardClipBindingsV11,
	type FramescaperClipboardClipBindingV11,
} from './editor-session-clipboard-v11-selection.ts';

export interface FramescaperImageClipboardV13 {
	readonly schemaVersion: 1;
	readonly kind: 'framescaper-image-fragment';
	readonly sourceIds: readonly string[];
	readonly clips: readonly FramescaperImageClipV1[];
}

export interface FramescaperSessionClipboardV13 extends Omit<
	FramescaperSessionClipboardV12,
	'schemaVersion' | 'descriptor' | 'sources' | 'clipBindings'
> {
	readonly schemaVersion: 13;
	readonly descriptor: AudioEditorClipboard;
	readonly sources: readonly (AudioEditorSessionClipboardSource | FramescaperImageSourceV1)[];
	readonly clipBindings: readonly FramescaperClipboardClipBindingV11[];
	readonly images: FramescaperImageClipboardV13;
}

const FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'descriptor', 'sources',
	'clipBindings', 'finishing', 'ofxEffects', 'images',
]);
const IMAGE_FIELDS = Object.freeze(['schemaVersion', 'kind', 'sourceIds', 'clips']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Snapshot selected timelineImage image authority beside an exact filtered V12 foundation. */
export function createFramescaperSessionClipboardV13(
	profile: unknown,
	projectValue: unknown,
	descriptorValue: AudioEditorClipboard,
): FramescaperSessionClipboardV13 {
	validateFramescaperProjectTimelineImage(profile, projectValue);
	const project = projectValue as FramescaperProjectTimelineImage;
	const descriptor = normalizeAudioEditorClipboardDescriptor(descriptorValue);
	const bindings = bindDescriptorClips(project, descriptor);
	const imageClips = imageClipsForBindings(project, bindings, descriptor);
	const imageClipIds = new Set(imageClips.map(({ id }) => id));
	const imageSourceIds = [...new Set(imageClips.map(({ sourceId }) => sourceId))].sort(compareText);
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	const imageSources = imageSourceIds.map((sourceId) => {
		const source = sourceById.get(sourceId);
		if (!source || source.kind !== 'image') {
			throw new ReferenceError(`V13 clipboard image source ${sourceId} is missing.`);
		}
		return normalizeFramescaperImageSourceV1(source);
	});
	const imageKeys = new Set(bindings.flatMap(({ clipId, descriptorKey }) => (
		imageClipIds.has(clipId) ? [descriptorKey] : []
	)));
	const foundation = createFramescaperSessionClipboardV12(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		framescaperProjectNativeMediaFoundationShapeTimelineImage(project),
		filterDescriptor(descriptor, imageKeys),
	);
	return normalizeFramescaperSessionClipboardV13({
		...foundation,
		schemaVersion: 13,
		descriptor,
		sources: [...foundation.sources, ...imageSources],
		clipBindings: bindings,
		images: {
			schemaVersion: 1,
			kind: 'framescaper-image-fragment',
			sourceIds: imageSourceIds,
			clips: imageClips,
		},
	});
}

/** Exact V13 admission; image rows never pass through historical V12 visual normalization. */
export function normalizeFramescaperSessionClipboardV13(value: unknown): FramescaperSessionClipboardV13 {
	const input = closedRecord(value, FIELDS, 'Framescaper session clipboard V13');
	if (input.schemaVersion !== 13) throw new RangeError('Framescaper session clipboard requires V13 re-copy.');
	if (input.kind !== 'framescaper-session-clipboard') throw new RangeError('V13 clipboard kind is unsupported.');
	const descriptor = normalizeAudioEditorClipboardDescriptor(input.descriptor);
	const bindings = normalizeFramescaperClipboardClipBindingsV11(input.clipBindings, descriptor);
	const generic = normalizeAudioEditorSessionClipboard({
		schemaVersion: 1,
		originProjectId: input.originProjectId,
		descriptor,
		sources: input.sources,
	});
	const images = normalizeImages(input.images);
	const imageSourceIdSet = new Set(images.sourceIds);
	const imageSources = new Map<string, FramescaperImageSourceV1>();
	for (const sourceValue of generic.sources) {
		const source = sourceValue as Readonly<Record<string, unknown>>;
		if (source.kind !== 'image') continue;
		const normalized = normalizeFramescaperImageSourceV1(source);
		imageSources.set(normalized.id, normalized);
	}
	if (!sameStrings([...imageSources.keys()].sort(compareText), images.sourceIds)) {
		throw new ReferenceError('V13 image source closure disagrees with its descriptor-owned sources.');
	}
	const imageClipIds = new Set(images.clips.map(({ id }) => id));
	const bindingByClipId = new Map(bindings.map((binding) => [binding.clipId, binding]));
	const descriptorByKey = new Map(descriptor.tracks.flatMap((track) => track.clips.map((clip) => [
		String(clip.key), clip,
	] as const)));
	for (const clip of images.clips) {
		if (!imageSourceIdSet.has(clip.sourceId)) {
			throw new ReferenceError(`V13 image clip ${clip.id} has no selected image source.`);
		}
		const binding = bindingByClipId.get(clip.id);
		const descriptorClip = binding ? descriptorByKey.get(binding.descriptorKey) : undefined;
		if (!binding || descriptorClip?.sourceId !== clip.sourceId) {
			throw new ReferenceError(`V13 image clip ${clip.id} has no matching descriptor binding.`);
		}
	}
	const imageKeys = new Set(bindings.flatMap(({ clipId, descriptorKey }) => (
		imageClipIds.has(clipId) ? [descriptorKey] : []
	)));
	const { images: _images, ...foundationInput } = input;
	const foundation = normalizeFramescaperSessionClipboardV12({
		...foundationInput,
		schemaVersion: 12,
		descriptor: filterDescriptor(descriptor, imageKeys),
		sources: generic.sources.filter(({ id }) => !imageSourceIdSet.has(id)),
		clipBindings: bindings.filter(({ clipId }) => !imageClipIds.has(clipId)),
	});
	const foundationSourceById = new Map(foundation.sources.map((source) => [source.id, source]));
	const sources = generic.sources.map((source) => (
		imageSources.get(source.id) ?? foundationSourceById.get(source.id) ?? missingSource(source.id)
	));
	return deepFreeze({
		...foundation,
		schemaVersion: 13 as const,
		descriptor,
		sources,
		clipBindings: bindings,
		images,
	});
}

export function framescaperSessionClipboardV12FoundationV13(
	value: unknown,
): FramescaperSessionClipboardV12 {
	const clipboard = normalizeFramescaperSessionClipboardV13(value);
	const imageClipIds = new Set(clipboard.images.clips.map(({ id }) => id));
	const imageKeys = new Set(clipboard.clipBindings.flatMap(({ clipId, descriptorKey }) => (
		imageClipIds.has(clipId) ? [descriptorKey] : []
	)));
	const { images: _images, ...foundation } = clipboard;
	return normalizeFramescaperSessionClipboardV12({
		...foundation,
		schemaVersion: 12,
		descriptor: filterDescriptor(clipboard.descriptor, imageKeys),
		sources: clipboard.sources.filter(({ id }) => !clipboard.images.sourceIds.includes(id)),
		clipBindings: clipboard.clipBindings.filter(({ clipId }) => !imageClipIds.has(clipId)),
	});
}

/** Clipboard roots equal storage keys by timelineImage invariant, so generic source-ID retention remains sound. */
export function collectFramescaperSessionClipboardImageStorageKeysV13(value: unknown): readonly string[] {
	const clipboard = normalizeFramescaperSessionClipboardV13(value);
	const imageIds = new Set(clipboard.images.sourceIds);
	return Object.freeze(clipboard.sources.filter((source): source is FramescaperImageSourceV1 => (
		imageIds.has(source.id) && (source as Readonly<Record<string, unknown>>).kind === 'image'
	)).map(({ storageKey }) => storageKey).sort(compareText));
}

function normalizeImages(value: unknown): FramescaperImageClipboardV13 {
	const input = closedRecord(value, IMAGE_FIELDS, 'Framescaper V13 image fragment');
	if (input.schemaVersion !== 1 || input.kind !== 'framescaper-image-fragment') {
		throw new RangeError('Framescaper V13 image fragment identity is unsupported.');
	}
	if (!Array.isArray(input.sourceIds) || input.sourceIds.length > 100_000) {
		throw new RangeError('V13 image source IDs must be a bounded array.');
	}
	const sourceIds = input.sourceIds.map((id, index) => stableId(id, `image sourceIds[${String(index)}]`));
	if (new Set(sourceIds).size !== sourceIds.length || !sameStrings([...sourceIds].sort(compareText), sourceIds)) {
		throw new RangeError('V13 image source IDs must be unique and sorted.');
	}
	if (!Array.isArray(input.clips) || input.clips.length > 100_000) {
		throw new RangeError('V13 image clips must be a bounded array.');
	}
	const clips = input.clips.map(normalizeFramescaperImageClipV1);
	if (new Set(clips.map(({ id }) => id)).size !== clips.length) throw new RangeError('V13 image clip IDs must be unique.');
	return Object.freeze({
		schemaVersion: 1,
		kind: 'framescaper-image-fragment',
		sourceIds: Object.freeze(sourceIds),
		clips: Object.freeze(clips),
	});
}

function imageClipsForBindings(
	project: FramescaperProjectTimelineImage,
	bindings: readonly FramescaperClipboardClipBindingV11[],
	descriptor: AudioEditorClipboard,
): readonly FramescaperImageClipV1[] {
	const selected = new Set(bindings.map(({ clipId }) => clipId));
	const clips = project.clips.filter((clip): clip is FramescaperImageClipV1 => (
		clip.kind === 'image' && selected.has(String(clip.id))
	)).map(normalizeFramescaperImageClipV1);
	const descriptorByKey = new Map(descriptor.tracks.flatMap((track) => track.clips.map((clip) => [
		String(clip.key), clip,
	] as const)));
	const bindingByClip = new Map(bindings.map((binding) => [binding.clipId, binding]));
	for (const clip of clips) {
		const binding = bindingByClip.get(clip.id);
		if (!binding || descriptorByKey.get(binding.descriptorKey)?.sourceId !== clip.sourceId) {
			throw new ReferenceError(`V13 descriptor does not preserve image clip ${clip.id}.`);
		}
	}
	return Object.freeze(clips);
}

function bindDescriptorClips(
	project: FramescaperProjectTimelineImage,
	descriptor: AudioEditorClipboard,
): readonly FramescaperClipboardClipBindingV11[] {
	const trackById = new Map(project.tracks.map((track) => [track.id, track]));
	const bindings: FramescaperClipboardClipBindingV11[] = [];
	for (const descriptorTrack of descriptor.tracks) {
		const track = trackById.get(descriptorTrack.sourceTrackId);
		if (!track) throw new ReferenceError(`V13 descriptor track ${descriptorTrack.sourceTrackId} is missing.`);
		const candidates = [...track.clipIds].sort((left, right) => right.length - left.length);
		for (const descriptorClip of descriptorTrack.clips) {
			const key = String(descriptorClip.key);
			const clipId = candidates.find((candidate) => key.startsWith(`${candidate}:`));
			if (!clipId) throw new ReferenceError(`V13 descriptor key ${key} has no authored clip.`);
			bindings.push(Object.freeze({ clipId, descriptorKey: key }));
		}
	}
	return normalizeFramescaperClipboardClipBindingsV11(bindings, descriptor);
}

function filterDescriptor(descriptor: AudioEditorClipboard, excludedKeys: ReadonlySet<string>): AudioEditorClipboard {
	const value = structuredClone(descriptor) as unknown as Record<string, unknown>;
	value.tracks = descriptor.tracks.map((track) => ({
		...structuredClone(track),
		clips: track.clips.filter(({ key }) => !excludedKeys.has(String(key))),
	}));
	return normalizeAudioEditorClipboardDescriptor(value);
}

function closedRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must carry exactly its schema fields.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${field} must be data.`);
	}
	return value as Record<string, unknown>;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`V13 ${name} must be a stable ID.`);
	return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function missingSource(id: string): never { throw new ReferenceError(`V13 source ${id} left its foundation.`); }

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
