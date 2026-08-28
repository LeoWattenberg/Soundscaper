/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import type {
	ProductVideoTimelineFilmstripFrame,
	ProductVideoTimelineFilmstripRequest,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import {
	framescaperImageSourceForClipTimelineImage,
	mapFramescaperImageFrameAtSampleTimelineImage,
	openFramescaperStoredImageFramePackTimelineImage,
	scaleFramescaperImageRgbaTimelineImage,
	throwIfFramescaperImagePreviewAbortedTimelineImage,
	type FramescaperImageClipV1,
	type FramescaperImageFramePackReaderV1,
	type FramescaperImageSourceV1,
} from './editor-selected-timeline-image-image-frame-source.ts';
import {
	admitFramescaperImageTimelineFilmstripResourcesTimelineImage,
	assertFramescaperImagePreviewReaderMetadataTimelineImage,
} from './editor-selected-timeline-image-image-preview-resources.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import {
	cloneFramescaperProjectTimelineImage,
} from './editor-project-timeline-image.ts';

export interface FramescaperSelectedTimelineFilmstripOptionsTimelineImage
	extends ProductVideoTimelineFilmstripRequest {
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly createInheritedFilmstrip?: (
		request: ProductVideoTimelineFilmstripRequest,
	) => Promise<readonly ProductVideoTimelineFilmstripFrame[] | null>;
	readonly cloneProject?: (profile: unknown, project: unknown) => ReturnType<typeof cloneFramescaperProjectTimelineImage>;
}

interface ImageFilmstripContextTimelineImage {
	readonly index: number;
	readonly request: ProductVideoTimelineFilmstripRequest['frames'][number];
	readonly clip: FramescaperImageClipV1;
	readonly source: FramescaperImageSourceV1;
	readonly sequenceRate: Readonly<{ readonly num: number; readonly den: number }>;
}

/** Resolve image filmstrip cells directly and retain finishing execution for inherited media cells. */
export async function createFramescaperSelectedTimelineFilmstripTimelineImage(
	options: FramescaperSelectedTimelineFilmstripOptionsTimelineImage,
): Promise<readonly ProductVideoTimelineFilmstripFrame[] | null> {
	const project = (options?.cloneProject ?? cloneFramescaperProjectTimelineImage)(options?.profile, options?.project);
	const frames = frameRequests(options?.frames);
	throwIfFramescaperImagePreviewAbortedTimelineImage(options.signal);
	if (frames.length === 0) return Object.freeze([]);
	const width = evenDimension(options.width, 'timelineImage timeline filmstrip width');
	const height = evenDimension(options.height, 'timelineImage timeline filmstrip height');
	const imageClips = new Map(project.clips.filter(({ kind }) => kind === 'image')
		.map((clip) => [String(clip.id), clip as FramescaperImageClipV1]));
	const inheritedRequests: typeof frames = [];
	const inheritedIndexes: number[] = [];
	const images: ImageFilmstripContextTimelineImage[] = [];
	for (const [index, request] of frames.entries()) {
		const clip = imageClips.get(request.clipId);
		if (!clip) {
			inheritedRequests.push(request);
			inheritedIndexes.push(index);
			continue;
		}
		if (clip.sourceId !== request.sourceId) {
			throw new Error(`timelineImage timeline filmstrip clip ${clip.id} changed source authority.`);
		}
		const source = framescaperImageSourceForClipTimelineImage(project.sources, clip);
		const sequence = project.sequences.find(({ id }) => id === clip.sequenceId);
		if (!sequence) throw new ReferenceError(`timelineImage image sequence ${clip.sequenceId} is unavailable.`);
		images.push({ index, request, clip, source, sequenceRate: sequence.rate });
	}
	admitFramescaperImageTimelineFilmstripResourcesTimelineImage(images.map(({ source }) => ({
		source, width, height,
	})));
	const output = new Array<ProductVideoTimelineFilmstripFrame>(frames.length);
	const inheritedFactory = options.createInheritedFilmstrip ?? ((request) => (
		createDefaultInheritedFilmstrip(request, options.store)
	));
	const inheritedPromise = inheritedRequests.length === 0 ? Promise.resolve(Object.freeze([]))
		: Promise.resolve().then(() => inheritedFactory({ ...options, project, frames: inheritedRequests }));
	const readers = new Map<string, Promise<FramescaperImageFramePackReaderV1>>();
	const scaledFrames = new Map<string, Uint8Array<ArrayBuffer>>();
	let inheritedOutput: readonly ProductVideoTimelineFilmstripFrame[] | null = null;
	let published = false;
	try {
		const [imageResult, inheritedResult] = await Promise.allSettled([
			materializeImages(), inheritedPromise,
		]);
		if (inheritedResult.status === 'fulfilled') inheritedOutput = inheritedResult.value;
		if (imageResult.status === 'rejected' && inheritedResult.status === 'rejected') {
			throw new AggregateError(
				[imageResult.reason, inheritedResult.reason],
				'The timelineImage timeline filmstrip image and inherited routes both failed.',
			);
		}
		if (imageResult.status === 'rejected') throw imageResult.reason;
		if (inheritedResult.status === 'rejected') throw inheritedResult.reason;
		const inherited = inheritedResult.value;
		if (inherited === null) return null;
		if (inherited.length !== inheritedIndexes.length) {
			throw new Error('The inherited timelineImage timeline filmstrip returned an incomplete frame set.');
		}
		for (let index = 0; index < inherited.length; index += 1) {
			output[inheritedIndexes[index]!] = inherited[index]!;
		}
		if (output.some((frame) => frame === undefined)) {
			throw new Error('The timelineImage timeline filmstrip omitted a requested frame.');
		}
		published = true;
		return Object.freeze(output);
	} finally {
		for (const pixels of scaledFrames.values()) pixels.fill(0);
		scaledFrames.clear();
		readers.clear();
		if (!published) disposeUnpublishedOutputs(output, inheritedOutput);
		images.length = 0;
	}

	async function materializeImages(): Promise<void> {
		for (const context of images) {
			throwIfFramescaperImagePreviewAbortedTimelineImage(options.signal);
			let readerPromise = readers.get(context.source.id);
			if (!readerPromise) {
				readerPromise = openFramescaperStoredImageFramePackTimelineImage(
					options.store, context.source, options.signal, (byteLength) => {
						assertFramescaperImagePreviewReaderMetadataTimelineImage(context.source, byteLength);
					},
				);
				readers.set(context.source.id, readerPromise);
			}
			const reader = await readerPromise;
			const address = mapFramescaperImageFrameAtSampleTimelineImage(
				reader, context.clip, context.request.timelineSample,
				context.sequenceRate, project.sampleRate,
			);
			const cacheKey = `${context.source.id}:${String(address.frameIndex)}`;
			let pixels = scaledFrames.get(cacheKey);
			if (!pixels) {
				const raw = await reader.readFrame(address.frameIndex, options.signal);
				try {
					pixels = scaleFramescaperImageRgbaTimelineImage(
						raw, context.source.canonical.width, context.source.canonical.height,
						width, height, options.signal,
					);
				} finally { raw.fill(0); }
				scaledFrames.set(cacheKey, pixels);
			}
			output[context.index] = Object.freeze({
				key: context.request.key,
				timelineSample: context.request.timelineSample,
				width,
				height,
				pixels: pixels.slice() as Uint8Array<ArrayBuffer>,
			});
		}
	}
}

function disposeUnpublishedOutputs(
	output: readonly (ProductVideoTimelineFilmstripFrame | undefined)[],
	inherited: readonly ProductVideoTimelineFilmstripFrame[] | null,
): void {
	for (const frame of [...output, ...(inherited ?? [])]) {
		try { frame?.pixels.fill(0); } catch { /* Continue releasing sibling output frames. */ }
	}
}

async function createDefaultInheritedFilmstrip(
	request: ProductVideoTimelineFilmstripRequest,
	store: AudioEditorProjectStore,
): Promise<readonly ProductVideoTimelineFilmstripFrame[] | null> {
	const module = await import('./editor-selected-finishing-timeline-filmstrip.ts');
	return module.createFramescaperSelectedTimelineFilmstripFinishing({
		...request,
		project: framescaperProjectFinishingFoundationShapeNativeMedia(
			framescaperProjectNativeMediaFoundationShapeTimelineImage(request.project),
		),
		profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		store,
	});
}

function frameRequests(value: unknown): ProductVideoTimelineFilmstripRequest['frames'][number][] {
	if (!Array.isArray(value) || value.length > 4_096) {
		throw new RangeError('timelineImage timeline filmstrip requests must be a bounded array.');
	}
	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`timelineImage timeline filmstrip request ${String(index)} must be an object.`);
		}
		const request = candidate as ProductVideoTimelineFilmstripRequest['frames'][number];
		return Object.freeze({
			key: text(request.key, 'filmstrip key'),
			clipId: stableId(request.clipId, 'filmstrip clip ID'),
			sourceId: stableId(request.sourceId, 'filmstrip source ID'),
			timelineSample: nonNegativeInteger(request.timelineSample, 'filmstrip timeline sample'),
			sourceUrl: text(request.sourceUrl, 'filmstrip source URL'),
		});
	});
}

function evenDimension(value: unknown, name: string): number {
	const dimension = positiveInteger(value, name);
	return Math.max(2, dimension - dimension % 2);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded integer.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`timelineImage ${name} must be a stable ID.`);
	}
	return value;
}

function text(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError(`timelineImage ${name} must be bounded text.`);
	}
	return value;
}
