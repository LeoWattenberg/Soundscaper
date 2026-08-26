/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import { resolveVideoExportRange } from '../common/editor/video-export.js';
import {
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
} from '../common/editor/timeline-image-model-v30.ts';
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
	reconcileFramescaperProjectFeatureRequirementsV28,
} from './editor-project-feature-requirements-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectV28FoundationShapeV30 } from './editor-project-v30-foundation.ts';
import { framescaperProjectForRuntimeConsumersV30 } from './editor-project-v30-runtime.ts';
import {
	validateFramescaperProjectV28,
	type FramescaperProjectV28,
} from './editor-project-v28.ts';
import {
	cloneFramescaperProjectV30,
	type FramescaperProjectV30,
} from './editor-project-v30.ts';
import { createFramescaperVideoExportImageExecutionV30 } from './video-export-image-execution-v30.ts';
import type { FramescaperStoredImageAssetStoreV30 } from './editor-selected-v30-image-frame-source.ts';
import {
	createFramescaperVideoExportStrategyV28,
} from './video-export-strategy-v28.ts';
import type { FramescaperVideoExportStrategyV27Dependencies } from './video-export-strategy-v27.ts';
import type { FramescaperVideoExportVisualAssetStoreV27 } from './video-export-visual-execution-v27.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';

interface ExportAuthorityV30 {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly canonicalSnapshot: FramescaperProjectV30;
	readonly inheritedProject: Readonly<Record<string, unknown>>;
	readonly hasTimelineImages: boolean;
}

export type FramescaperVideoExportAssetStoreV30 = FramescaperVideoExportVisualAssetStoreV27
	& FramescaperStoredImageAssetStoreV30;

/** Retain V28 browser delivery and supplement it with authenticated V30 image pictures. */
export function createFramescaperVideoExportStrategyV30(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyV27Dependencies,
	assetStore?: FramescaperVideoExportAssetStoreV30,
	openFxExecute?: FramescaperSelectedOpenFxExecutionV28['execute'],
): ProductVideoExportStrategy {
	const foundationAuthorities = new WeakMap<object, ExportAuthorityV30>();
	const createSupplementalPictureExecution = async ({
		canonicalProject, foundationPlan, signal, assertCurrent,
	}: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly foundationPlan: Parameters<typeof createFramescaperVideoExportImageExecutionV30>[0]['foundationPlan'];
		readonly signal: AbortSignal;
		readonly assertCurrent: () => void;
	}>) => {
		const authority = foundationAuthorities.get(canonicalProject);
		if (!authority) throw new Error('Selected V30 image export lost its exact project authority.');
		if (!authority.hasTimelineImages) return null;
		return createFramescaperVideoExportImageExecutionV30({
			profile,
			project: authority.canonicalSnapshot,
			foundationPlan,
			store: assetStore,
			signal,
			assertCurrent,
		});
	};
	const delegate = createFramescaperVideoExportStrategyV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, dependencies, assetStore,
		openFxExecute, createSupplementalPictureExecution,
	);
	const exports = new WeakMap<object, ExportAuthorityV30>();
	const plans = new WeakMap<object, ExportAuthorityV30>();
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
				throw new TypeError('Selected V30 picture authority requires an owned export project.');
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
			if (!plans.has(plan)) throw new TypeError('Selected V30 timing closure requires an owned plan.');
			return delegate.captureTimingSourceIds?.(plan) ?? plan.activeSourceIds;
		},
	});
}

function projectAuthority(
	profile: unknown,
	project: Readonly<Record<string, unknown>>,
): ExportAuthorityV30 {
	const canonicalSnapshot = cloneFramescaperProjectV30(profile, project);
	const hasTimelineImages = records(canonicalSnapshot.clips, 'V30 export clips')
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
	exports: WeakMap<object, ExportAuthorityV30>,
): ExportAuthorityV30 {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact V30 project.');
	}
	const currentSnapshot = cloneFramescaperProjectV30(profile, request.canonicalProject);
	if (!sameProjectSnapshot(currentSnapshot, authority.canonicalSnapshot)) {
		throw new Error('The selected V30 browser export projection is stale.');
	}
	return authority;
}

function ownedPlanAuthority(
	profile: unknown,
	request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityV30>,
	plans: WeakMap<object, ExportAuthorityV30>,
): ExportAuthorityV30 {
	const authority = currentAuthority(profile, request, exports);
	if (plans.get(request.plan) !== authority) {
		throw new TypeError('The V30 export plan is not owned by this exact project snapshot.');
	}
	return authority;
}

/** Retain image timing/range authority as transparent V28 visual nodes. */
function imageExportFoundation(project: Readonly<Record<string, unknown>>): FramescaperProjectV28 {
	const foundation = framescaperProjectV28FoundationShapeV30(project) as unknown as Record<string, unknown>;
	const imageClips = records(project.clips, 'V30 export clips')
		.filter(({ kind }) => kind === 'image')
		.map((clip) => normalizeFramescaperImageClipV1(clip));
	if (imageClips.length === 0) return foundation as unknown as FramescaperProjectV28;
	const imagesBySourceId = new Map(records(project.sources, 'V30 export sources')
		.filter(({ kind }) => kind === 'image')
		.map((source) => {
			const normalized = normalizeFramescaperImageSourceV1(source);
			return [normalized.id, normalized] as const;
		}));
	const sequences = new Map(records(project.sequences, 'V30 export sequences')
		.map((sequence) => [String(sequence.id), sequence] as const));
	const generatorSources = new Map<string, Record<string, unknown>>();
	const placeholderClips = new Map<string, Record<string, unknown>>();
	for (const clip of imageClips) {
		const source = imagesBySourceId.get(clip.sourceId);
		if (!source) throw new ReferenceError(`V30 export image source ${clip.sourceId} is unavailable.`);
		const sequence = sequences.get(clip.sequenceId);
		if (!sequence) throw new ReferenceError(`V30 export image sequence ${clip.sequenceId} is unavailable.`);
		const rate = rational(sequence.rate, `V30 export sequence ${clip.sequenceId} rate`);
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
	const inheritedClips = new Map(records(foundation.clips, 'V30 inherited export clips')
		.map((clip) => [String(clip.id), clip] as const));
	foundation.clips = records(project.clips, 'V30 canonical export clips').flatMap((clip) => {
		const id = String(clip.id);
		const placeholder = placeholderClips.get(id);
		if (placeholder) return [placeholder];
		const inherited = inheritedClips.get(id);
		return inherited ? [inherited] : [];
	});
	const canonicalTracks = new Map(records(project.tracks, 'V30 canonical export tracks')
		.map((track) => [String(track.id), track] as const));
	foundation.tracks = records(foundation.tracks, 'V30 inherited export tracks').map((track) => {
		const canonical = canonicalTracks.get(String(track.id));
		return canonical ? { ...track, clipIds: [...array(canonical.clipIds, 'V30 export track clip IDs')] } : track;
	});
	foundation.sources = [
		...records(foundation.sources, 'V30 inherited export sources'),
		...generatorSources.values(),
	];
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, foundation,
	);
	validateFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, foundation);
	return foundation as unknown as FramescaperProjectV28;
}

function completeProjectRange(
	profile: unknown,
	project: Readonly<Record<string, unknown>>,
): Readonly<{ readonly startFrame: number; readonly endFrame: number }> {
	const runtime = framescaperProjectForRuntimeConsumersV30(profile, project);
	const range = resolveVideoExportRange(runtime, 'project');
	if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame)
		|| range.startFrame !== 0 || range.endFrame <= 0) {
		throw new RangeError('The V30 image export project range is invalid.');
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
