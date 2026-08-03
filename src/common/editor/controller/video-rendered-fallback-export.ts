/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../project-feature-capabilities.ts';
import type {
	ProjectFeatureRequirementsReport,
	ProjectFeatureRequirementsReportItem,
} from '../project-feature-requirements.ts';
import {
	PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS,
	type ProjectFeatureVideoRenderedFallbackMetadata,
} from '../project-feature-video-rendered-fallback.ts';
import type { EngineChunkSource } from '../engine/types.ts';
import type {
	ProjectAudioFallbackIntegritySelector,
	ProjectVideoFallbackIntegritySelector,
} from '../project-fallback-integrity.ts';
import {
	assertAudioRenderedFallbackChunkProvider,
	assertAudioRenderedFallbackProjection,
	assertAudioRenderedFallbackSourceGeometry,
	audioRenderedFallbackIntegritySelector,
} from './audio-rendered-fallback-export.ts';
import type { VideoRenderedFallbackDeliveryProjection } from './playback-project-service.ts';

interface VideoRenderedFallbackDeliveryService {
	projectForVideoRenderedFallbackDelivery<Project extends object>(
		project: Project,
	): VideoRenderedFallbackDeliveryProjection<Project>;
}

interface FallbackIntegrityAdmission {
	assertCurrent(project: unknown): void;
	getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector): EngineChunkSource;
	getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector): Blob;
}

interface VideoRenderedFallbackIntegrityRuntime {
	readonly store: unknown;
	readonly verifyProjectFallbackIntegrity?: (
		project: unknown,
		store: unknown,
		options: Readonly<{
			signal?: AbortSignal;
			audioFallback?: ProjectAudioFallbackIntegritySelector;
			videoFallback?: ProjectVideoFallbackIntegritySelector;
			assertCurrent?: () => void;
		}>,
	) => PromiseLike<FallbackIntegrityAdmission> | FallbackIntegrityAdmission;
}

interface VideoRenderedFallbackExportAdmissionOptions {
	readonly signal?: AbortSignal;
	readonly assertCurrent: () => void;
}

interface VideoExportPublication {
	readonly cleanup?: () => PromiseLike<void> | void;
}

export interface VideoRenderedFallbackExportAdmission {
	readonly audioChunkProvider: EngineChunkSource | null;
	readonly videoBlob: Blob | null;
}

const EMPTY_VIDEO_DELIVERY = Object.freeze({
	featureRequirementsReport: null,
	audioRenderedFallback: null,
	videoRenderedFallback: null,
	requiredAudioSourceIds: Object.freeze([]),
	requiredVideoSourceIds: Object.freeze([]),
});
const EMPTY_FALLBACK_ADMISSION = Object.freeze({
	audioChunkProvider: null,
	videoBlob: null,
});
const FEATURE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;

/** Select the closed audio/video fallback projection used by final video delivery. */
export function projectForVideoRenderedFallbackExport<Project extends object>(
	project: Project,
	service?: VideoRenderedFallbackDeliveryService | null,
): VideoRenderedFallbackDeliveryProjection<Project> {
	if (!service) return Object.freeze({ project, ...EMPTY_VIDEO_DELIVERY });
	if (typeof service.projectForVideoRenderedFallbackDelivery !== 'function') {
		throw new TypeError('Video rendered-fallback delivery projection is unavailable.');
	}
	const projection = service.projectForVideoRenderedFallbackDelivery(project);
	assertDeliveryProjection(projection);
	return projection;
}

/** Jointly reverify active delivery fallbacks before planning or media reads. */
export async function admitVideoRenderedFallbackExport(
	canonicalProject: unknown,
	projection: VideoRenderedFallbackDeliveryProjection<object>,
	runtime: VideoRenderedFallbackIntegrityRuntime,
	options: VideoRenderedFallbackExportAdmissionOptions,
): Promise<VideoRenderedFallbackExportAdmission> {
	assertDeliveryProjection(projection);
	if (!projection.audioRenderedFallback && !projection.videoRenderedFallback) {
		return EMPTY_FALLBACK_ADMISSION;
	}
	if (typeof options?.assertCurrent !== 'function') {
		throw new TypeError('Video rendered-fallback export requires a currentness assertion.');
	}
	if (typeof runtime.verifyProjectFallbackIntegrity !== 'function') {
		throw new TypeError('Video rendered-fallback export integrity verification is unavailable.');
	}
	const audioSelector = projection.audioRenderedFallback
		? audioRenderedFallbackIntegritySelector(projection)
		: null;
	const videoSelector = projection.videoRenderedFallback
		? videoFallbackIntegritySelector(projection)
		: null;
	if (audioSelector) {
		assertAudioRenderedFallbackSourceGeometry(
			canonicalProject,
			projection.project,
			audioSelector.sourceId,
		);
	}
	options.assertCurrent();
	const admission = await runtime.verifyProjectFallbackIntegrity(
		canonicalProject,
		runtime.store,
		{
			signal: options.signal,
			...(audioSelector ? { audioFallback: audioSelector } : {}),
			...(videoSelector ? { videoFallback: videoSelector } : {}),
			assertCurrent: options.assertCurrent,
		},
	);
	if (!admission || typeof admission.assertCurrent !== 'function'
		|| (audioSelector && typeof admission.getVerifiedAudioChunkProvider !== 'function')
		|| (videoSelector && typeof admission.getVerifiedVideoBlob !== 'function')) {
		throw new TypeError('Video rendered-fallback export integrity admission is invalid.');
	}
	admission.assertCurrent(canonicalProject);
	const audioChunkProvider = audioSelector
		? admission.getVerifiedAudioChunkProvider(audioSelector)
		: null;
	if (audioSelector) {
		assertAudioRenderedFallbackChunkProvider(canonicalProject, audioSelector.sourceId, audioChunkProvider);
	}
	const videoBlob = videoSelector ? admission.getVerifiedVideoBlob(videoSelector) : null;
	if (videoSelector && !(videoBlob instanceof Blob)) {
		throw new TypeError('Video rendered-fallback export integrity returned invalid media.');
	}
	options.assertCurrent();
	return Object.freeze({ audioChunkProvider, videoBlob });
}

export function sanitizeVideoExportFileName(value: unknown): string {
	return String(value || 'video-project')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '')
		.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/gu, '-')
		.replace(/-{2,}/gu, '-')
		.replace(/^[-_.]+|[-_.]+$/gu, '')
		.slice(0, 96) || 'video-project';
}

/** Refuse a stale publication result and release any recoverable output handle. */
export async function assertVideoExportPublicationCurrent(
	published: VideoExportPublication,
	assertCurrent: () => void,
): Promise<void> {
	try { assertCurrent(); } catch (error) {
		await published.cleanup?.();
		throw error;
	}
}

function assertDeliveryProjection(
	projection: VideoRenderedFallbackDeliveryProjection<object>,
): void {
	assertAudioRenderedFallbackProjection(projection);
	const requiredVideoSourceIds = projectionDataProperty(
		projection,
		'requiredVideoSourceIds',
	);
	if (!Array.isArray(requiredVideoSourceIds)) {
		throw new TypeError('Video rendered-fallback delivery returned invalid source roots.');
	}
	const metadata = projectionDataProperty(projection, 'videoRenderedFallback');
	if (metadata === null) {
		if (requiredVideoSourceIds.length !== 0) {
			throw new TypeError('Inactive video rendered-fallback delivery retained a source root.');
		}
	} else {
		if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
			throw new TypeError('Video rendered-fallback delivery returned invalid metadata.');
		}
		const typedMetadata = metadata as ProjectFeatureVideoRenderedFallbackMetadata;
		assertActiveMetadata(typedMetadata, requiredVideoSourceIds);
		assertVideoFallbackReport(projection.featureRequirementsReport, typedMetadata);
	}
	assertExactRenderedFallbackSet(projection);
}

function projectionDataProperty(
	projection: VideoRenderedFallbackDeliveryProjection<object>,
	key: 'requiredVideoSourceIds' | 'videoRenderedFallback',
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(projection, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Video rendered-fallback delivery ${key} must be an own data property.`);
	}
	return descriptor.value;
}

function assertActiveMetadata(
	metadata: ProjectFeatureVideoRenderedFallbackMetadata,
	requiredSourceIds: readonly string[],
): void {
	if (metadata.schemaVersion !== 1
		|| typeof metadata.featureId !== 'string' || !FEATURE_ID_PATTERN.test(metadata.featureId)
		|| typeof metadata.requirementId !== 'string' || !metadata.requirementId
		|| typeof metadata.sourceId !== 'string' || !metadata.sourceId
		|| requiredSourceIds.length !== 1
		|| requiredSourceIds[0] !== metadata.sourceId) {
		throw new TypeError('Video rendered-fallback delivery metadata does not match its required source.');
	}
	if (metadata.role === 'project-video-render-v1') {
		if (metadata.trackId !== PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track
			|| metadata.clipId !== PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip) {
			throw new TypeError('Video rendered-fallback delivery metadata has invalid full-render identity.');
		}
		return;
	}
	if (metadata.role !== 'video-clip-render-v1'
		|| metadata.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.videoEffects
		|| typeof metadata.targetClipId !== 'string' || !metadata.targetClipId
		|| metadata.targetClipId !== metadata.targetClipId.trim()) {
		throw new TypeError('Video rendered-fallback delivery metadata has an invalid clip relationship.');
	}
}

function assertVideoFallbackReport(
	report: ProjectFeatureRequirementsReport | null,
	metadata: ProjectFeatureVideoRenderedFallbackMetadata,
): ProjectFeatureRequirementsReportItem {
	if (report?.format !== 'soundscaper-project' || report.compatible !== false || !Array.isArray(report.items)) {
		throw new TypeError('Video rendered-fallback delivery requires an incompatible project report.');
	}
	const renderedFallbacks = report.items.filter((item) => (
		item.disposition === 'rendered-fallback' && item.fallback?.kind === 'video'
	));
	if (renderedFallbacks.length !== 1 || !matchesFallback(renderedFallbacks[0], metadata)) {
		throw new RangeError('Video export requires exactly one matching video rendered fallback.');
	}
	return renderedFallbacks[0]!;
}

function assertExactRenderedFallbackSet(
	projection: VideoRenderedFallbackDeliveryProjection<object>,
): void {
	const renderedFallbacks = projection.featureRequirementsReport?.items
		.filter((item) => item.disposition === 'rendered-fallback') ?? [];
	const expectedCount = Number(Boolean(projection.audioRenderedFallback))
		+ Number(Boolean(projection.videoRenderedFallback));
	const audioCount = renderedFallbacks.filter((item) => item.fallback?.kind === 'audio').length;
	const videoCount = renderedFallbacks.filter((item) => item.fallback?.kind === 'video').length;
	if (renderedFallbacks.length !== expectedCount
		|| audioCount !== Number(Boolean(projection.audioRenderedFallback))
		|| videoCount !== Number(Boolean(projection.videoRenderedFallback))) {
		throw new RangeError(
			'Video export supports at most one represented audio and one represented video rendered fallback.',
		);
	}
}

function videoFallbackIntegritySelector(
	projection: VideoRenderedFallbackDeliveryProjection<object>,
): ProjectVideoFallbackIntegritySelector {
	const metadata = projection.videoRenderedFallback!;
	const item = assertVideoFallbackReport(projection.featureRequirementsReport, metadata);
	const base = {
		requirementId: metadata.requirementId,
		featureId: metadata.featureId,
		kind: 'video',
		sourceId: metadata.sourceId,
		sha256: item.fallback!.sha256,
	} as const;
	return metadata.role === 'video-clip-render-v1'
		? Object.freeze({ ...base, role: metadata.role, targetClipId: metadata.targetClipId })
		: Object.freeze({ ...base, role: metadata.role, targetClipId: null });
}

function matchesFallback(
	item: ProjectFeatureRequirementsReportItem | undefined,
	metadata: ProjectFeatureVideoRenderedFallbackMetadata,
): boolean {
	return Boolean(item
		&& item.requirementId === metadata.requirementId
		&& item.featureId === metadata.featureId
		&& (
			(metadata.role === 'project-video-render-v1'
				&& (item.availability === 'unavailable' || item.availability === 'unknown'))
			|| (metadata.role === 'video-clip-render-v1' && item.availability === 'unavailable')
		)
		&& item.declaredDisposition === 'rendered-fallback'
		&& item.disposition === 'rendered-fallback'
		&& item.fallback?.kind === 'video'
		&& item.fallback.role === metadata.role
		&& item.fallback.sourceId === metadata.sourceId
		&& (item.fallback.role === 'video-clip-render-v1' ? item.fallback.targetClipId : null)
			=== (metadata.role === 'video-clip-render-v1' ? metadata.targetClipId : null));
}
