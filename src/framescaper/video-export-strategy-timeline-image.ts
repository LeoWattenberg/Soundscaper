/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import { resolveVideoExportRange } from '../common/editor/video-export.js';
import {
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportPlan,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/product-video-export-strategy.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsNativeMedia,
} from './editor-project-feature-requirements-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { framescaperProjectForRuntimeConsumersTimelineImage } from './editor-project-timeline-image-runtime.ts';
import {
	validateFramescaperProjectNativeMedia,
	type FramescaperProjectNativeMedia,
} from './editor-project-native-media.ts';
import {
	cloneFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image.ts';
import { createFramescaperVideoExportImageExecutionTimelineImage } from './video-export-image-execution-timeline-image.ts';
import type { FramescaperStoredImageAssetStoreTimelineImage } from './editor-selected-timeline-image-image-frame-source.ts';
import {
	createFramescaperVideoExportStrategyNativeMedia,
} from './video-export-strategy-native-media.ts';
import type { FramescaperVideoExportStrategyFinishingDependencies } from './video-export-strategy-finishing.ts';
import type { FramescaperVideoExportVisualAssetStoreFinishing } from './video-export-visual-execution-finishing.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';

interface ExportAuthorityTimelineImage {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly canonicalSnapshot: FramescaperProjectTimelineImage;
	readonly inheritedProject: Readonly<Record<string, unknown>>;
	readonly hasTimelineImages: boolean;
}

export type FramescaperVideoExportAssetStoreTimelineImage = FramescaperVideoExportVisualAssetStoreFinishing
	& FramescaperStoredImageAssetStoreTimelineImage;

/** Retain nativeMedia browser delivery and supplement it with authenticated timelineImage image pictures. */
export function createFramescaperVideoExportStrategyTimelineImage(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyFinishingDependencies,
	assetStore?: FramescaperVideoExportAssetStoreTimelineImage,
	openFxExecute?: FramescaperSelectedOpenFxExecutionNativeMedia['execute'],
): ProductVideoExportStrategy {
	const foundationAuthorities = new WeakMap<object, ExportAuthorityTimelineImage>();
	const createSupplementalPictureExecution = async ({
		canonicalProject, foundationPlan, signal, assertCurrent,
	}: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly foundationPlan: Parameters<typeof createFramescaperVideoExportImageExecutionTimelineImage>[0]['foundationPlan'];
		readonly signal: AbortSignal;
		readonly assertCurrent: () => void;
	}>) => {
		const authority = foundationAuthorities.get(canonicalProject);
		if (!authority) throw new Error('Selected timelineImage image export lost its exact project authority.');
		if (!authority.hasTimelineImages) return null;
		return createFramescaperVideoExportImageExecutionTimelineImage({
			profile,
			project: authority.canonicalSnapshot,
			foundationPlan,
			store: assetStore,
			signal,
			assertCurrent,
		});
	};
	const delegate = createFramescaperVideoExportStrategyNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, dependencies, assetStore,
		openFxExecute, createSupplementalPictureExecution,
	);
	const exports = new WeakMap<object, ExportAuthorityTimelineImage>();
	const plans = new WeakMap<object, ExportAuthorityTimelineImage>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const authority = projectAuthority(profile, request.canonicalProject);
			foundationAuthorities.set(authority.inheritedProject, authority);
			const exportProject = delegate.createExportProject({
				canonicalProject: authority.inheritedProject,
				delivery: request.delivery,
			});
			exports.set(exportProject, authority);
			return exportProject;
		},
		hasPicture(exportProject: Readonly<Record<string, unknown>>) {
			if (!exports.has(exportProject)) {
				throw new TypeError('Selected timelineImage picture authority requires an owned export project.');
			}
			return delegate.hasPicture?.(exportProject) ?? false;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			const authority = currentAuthority(profile, request, exports);
			const plan = delegate.createPlan({
				...request,
				canonicalProject: authority.inheritedProject,
				...(authority.hasTimelineImages && request.range === 'project'
					? { range: completeProjectRange(profile, authority.canonicalSnapshot) } : {}),
			});
			if (plan) plans.set(plan, authority);
			return plan;
		},
		encode(request: ProductVideoExportStrategyEncodeRequest): Promise<ProductVideoExportEncodedOutput> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			return delegate.encode({ ...request, canonicalProject: authority.inheritedProject });
		},
		encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			return delegate.encodeToSink(
				{ ...request, canonicalProject: authority.inheritedProject }, sink,
			);
		},
		captureTimingSourceIds(plan: ProductVideoExportPlan) {
			if (!plans.has(plan)) throw new TypeError('Selected timelineImage timing closure requires an owned plan.');
			return delegate.captureTimingSourceIds?.(plan) ?? plan.activeSourceIds;
		},
	});
}

function projectAuthority(
	profile: unknown,
	project: Readonly<Record<string, unknown>>,
): ExportAuthorityTimelineImage {
	const canonicalSnapshot = cloneFramescaperProjectTimelineImage(profile, project);
	const hasTimelineImages = records(canonicalSnapshot.clips, 'timelineImage export clips')
		.some(({ kind }) => kind === 'image');
	return Object.freeze({
		canonicalProject: project,
		canonicalSnapshot,
		inheritedProject: imageExportFoundation(canonicalSnapshot),
		hasTimelineImages,
	});
}

function currentAuthority(
	profile: unknown,
	request: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly exportProject: Readonly<Record<string, unknown>>;
	}>,
	exports: WeakMap<object, ExportAuthorityTimelineImage>,
): ExportAuthorityTimelineImage {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact timelineImage project.');
	}
	const currentSnapshot = cloneFramescaperProjectTimelineImage(profile, request.canonicalProject);
	if (!sameProjectSnapshot(currentSnapshot, authority.canonicalSnapshot)) {
		throw new Error('The selected timelineImage browser export projection is stale.');
	}
	return authority;
}

function ownedPlanAuthority(
	profile: unknown,
	request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityTimelineImage>,
	plans: WeakMap<object, ExportAuthorityTimelineImage>,
): ExportAuthorityTimelineImage {
	const authority = currentAuthority(profile, request, exports);
	if (plans.get(request.plan) !== authority) {
		throw new TypeError('The timelineImage export plan is not owned by this exact project snapshot.');
	}
	return authority;
}

/** Retain image timing/range authority as transparent nativeMedia visual nodes. */
function imageExportFoundation(project: Readonly<Record<string, unknown>>): FramescaperProjectNativeMedia {
	const foundation = framescaperProjectNativeMediaFoundationShapeTimelineImage(project) as unknown as Record<string, unknown>;
	const imageClips = records(project.clips, 'timelineImage export clips')
		.filter(({ kind }) => kind === 'image')
		.map((clip) => normalizeFramescaperImageClipV1(clip));
	if (imageClips.length === 0) return foundation as unknown as FramescaperProjectNativeMedia;
	const imagesBySourceId = new Map(records(project.sources, 'timelineImage export sources')
		.filter(({ kind }) => kind === 'image')
		.map((source) => {
			const normalized = normalizeFramescaperImageSourceV1(source);
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
			width: source.canonical.width,
			height: source.canonical.height,
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

function completeProjectRange(
	profile: unknown,
	project: Readonly<Record<string, unknown>>,
): Readonly<{ readonly startFrame: number; readonly endFrame: number }> {
	const runtime = framescaperProjectForRuntimeConsumersTimelineImage(profile, project);
	const range = resolveVideoExportRange(runtime, 'project');
	if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame)
		|| range.startFrame !== 0 || range.endFrame <= 0) {
		throw new RangeError('The timelineImage image export project range is invalid.');
	}
	return Object.freeze({ startFrame: range.startFrame, endFrame: range.endFrame });
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
