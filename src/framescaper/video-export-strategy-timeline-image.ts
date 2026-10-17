/* SPDX-License-Identifier: AGPL-3.0-only */
import { bindFramescaperVideoFrameConsumer, consumeFramescaperVideoFrames } from './video-export-frame-consumer.ts';

import type { FileSizeWarningConfirmation } from '../common/editor/controller/shared/file-size-warning.ts';
import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import { resolveVideoExportRange } from '../common/editor/video-export.js';
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportPlan,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/export/product-video-export-strategy.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperTimelineImageExactFoundation } from './editor-timeline-image-exact-foundation.ts';
import { framescaperProjectForRuntimeConsumersTimelineImage } from './editor-project-timeline-image-runtime.ts';
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
		canonicalProject, foundationPlan, signal, assertCurrent, confirmFileSizeWarning,
	}: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly foundationPlan: Parameters<typeof createFramescaperVideoExportImageExecutionTimelineImage>[0]['foundationPlan'];
		readonly signal: AbortSignal;
		readonly assertCurrent: () => void;
		readonly confirmFileSizeWarning?: FileSizeWarningConfirmation;
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
			assertCurrent, confirmFileSizeWarning,
		});
	};
	const delegate = createFramescaperVideoExportStrategyNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, dependencies, assetStore,
		openFxExecute, createSupplementalPictureExecution,
	);
	const exports = new WeakMap<object, ExportAuthorityTimelineImage>();
	const plans = new WeakMap<object, ExportAuthorityTimelineImage>();
	return bindFramescaperVideoFrameConsumer(Object.freeze({
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
	}), (request, consume) => {
		const authority = ownedPlanAuthority(profile, request, exports, plans);
		return consumeFramescaperVideoFrames(delegate, { ...request, canonicalProject: authority.inheritedProject }, consume);
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
		inheritedProject: framescaperTimelineImageExactFoundation(canonicalSnapshot),
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

function records(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError(`${name}[${String(index)}] must be an object.`);
		}
		return item as Readonly<Record<string, unknown>>;
	});
}
