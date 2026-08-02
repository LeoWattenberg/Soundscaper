/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectFeatureVideoCapabilityId } from '../project-feature-capabilities.ts';
import type {
	ProjectFeatureRequirementsReport,
	ProjectFeatureRequirementsReportItem,
} from '../project-feature-requirements.ts';
import type { ProjectFeatureVideoRenderedFallbackMetadata } from '../project-feature-video-rendered-fallback.ts';
import type { ProjectVideoFallbackIntegritySelector } from '../project-fallback-integrity.ts';
import type { VideoRenderedFallbackDeliveryProjection } from './playback-project-service.ts';

interface VideoRenderedFallbackDeliveryService {
	projectForVideoRenderedFallbackDelivery<Project extends object>(
		project: Project,
	): VideoRenderedFallbackDeliveryProjection<Project>;
}

interface FallbackIntegrityAdmission {
	assertCurrent(project: unknown): void;
	getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector): Blob;
}

interface VideoRenderedFallbackIntegrityRuntime {
	readonly store: unknown;
	readonly verifyProjectFallbackIntegrity?: (
		project: unknown,
		store: unknown,
		options: Readonly<{
			signal?: AbortSignal;
			videoFallback?: ProjectVideoFallbackIntegritySelector;
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

const EMPTY_VIDEO_DELIVERY = Object.freeze({
	featureRequirementsReport: null,
	videoRenderedFallback: null,
	requiredVideoSourceIds: Object.freeze([]),
});

/** Select only the maintained video fallback projection used by final delivery. */
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

/** Reverify an active fallback at operation time before planning or media reads. */
export async function admitVideoRenderedFallbackExport(
	canonicalProject: unknown,
	projection: VideoRenderedFallbackDeliveryProjection<object>,
	runtime: VideoRenderedFallbackIntegrityRuntime,
	options: VideoRenderedFallbackExportAdmissionOptions,
): Promise<Blob | null> {
	if (!projection.videoRenderedFallback) return null;
	if (typeof runtime.verifyProjectFallbackIntegrity !== 'function') {
		throw new TypeError('Video rendered-fallback export integrity verification is unavailable.');
	}
	const selector = videoFallbackIntegritySelector(projection);
	options.assertCurrent();
	const admission = await runtime.verifyProjectFallbackIntegrity(
		canonicalProject,
		runtime.store,
		{ signal: options.signal, videoFallback: selector },
	);
	if (!admission || typeof admission.assertCurrent !== 'function'
		|| typeof admission.getVerifiedVideoBlob !== 'function') {
		throw new TypeError('Video rendered-fallback export integrity admission is invalid.');
	}
	admission.assertCurrent(canonicalProject);
	const blob = admission.getVerifiedVideoBlob(selector);
	if (!(blob instanceof Blob)) {
		throw new TypeError('Video rendered-fallback export integrity returned invalid media.');
	}
	options.assertCurrent();
	return blob;
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
	if (!projection || typeof projection !== 'object' || !projection.project
		|| typeof projection.project !== 'object' || Array.isArray(projection.project)) {
		throw new TypeError('Video rendered-fallback delivery returned an invalid project.');
	}
	if (!Array.isArray(projection.requiredVideoSourceIds)) {
		throw new TypeError('Video rendered-fallback delivery returned invalid source roots.');
	}
	const metadata = projection.videoRenderedFallback;
	if (!metadata) {
		if (projection.requiredVideoSourceIds.length !== 0) {
			throw new TypeError('Inactive video rendered-fallback delivery retained a source root.');
		}
		return;
	}
	assertActiveMetadata(metadata, projection.requiredVideoSourceIds);
	assertFallbackReport(projection.featureRequirementsReport, metadata);
}

function assertActiveMetadata(
	metadata: ProjectFeatureVideoRenderedFallbackMetadata,
	requiredSourceIds: readonly string[],
): void {
	if (metadata.schemaVersion !== 1
		|| !isProjectFeatureVideoCapabilityId(metadata.featureId)
		|| requiredSourceIds.length !== 1
		|| requiredSourceIds[0] !== metadata.sourceId) {
		throw new TypeError('Video rendered-fallback delivery metadata does not match its required source.');
	}
}

function assertFallbackReport(
	report: ProjectFeatureRequirementsReport | null,
	metadata: ProjectFeatureVideoRenderedFallbackMetadata,
): ProjectFeatureRequirementsReportItem {
	if (report?.format !== 'soundscaper-project' || report.compatible !== false || !Array.isArray(report.items)) {
		throw new TypeError('Video rendered-fallback delivery requires an incompatible project report.');
	}
	const renderedFallbacks = report.items.filter((item) => item.disposition === 'rendered-fallback');
	if (renderedFallbacks.length !== 1 || !matchesFallback(renderedFallbacks[0], metadata)) {
		throw new RangeError('Video export does not support simultaneous rendered fallbacks.');
	}
	return renderedFallbacks[0]!;
}

function videoFallbackIntegritySelector(
	projection: VideoRenderedFallbackDeliveryProjection<object>,
): ProjectVideoFallbackIntegritySelector {
	const metadata = projection.videoRenderedFallback!;
	const item = assertFallbackReport(projection.featureRequirementsReport, metadata);
	return Object.freeze({
		requirementId: metadata.requirementId,
		featureId: metadata.featureId,
		kind: 'video',
		sourceId: metadata.sourceId,
		sha256: item.fallback!.sha256,
	});
}

function matchesFallback(
	item: ProjectFeatureRequirementsReportItem | undefined,
	metadata: ProjectFeatureVideoRenderedFallbackMetadata,
): boolean {
	return Boolean(item
		&& item.requirementId === metadata.requirementId
		&& item.featureId === metadata.featureId
		&& item.availability === 'unavailable'
		&& item.declaredDisposition === 'rendered-fallback'
		&& item.disposition === 'rendered-fallback'
		&& item.fallback?.kind === 'video'
		&& item.fallback.sourceId === metadata.sourceId);
}
