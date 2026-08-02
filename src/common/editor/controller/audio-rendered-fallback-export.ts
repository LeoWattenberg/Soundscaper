/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_STORAGE_CHUNK_FRAMES } from '../chunk-stream.js';
import type { EngineChunkSource } from '../engine/types.ts';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../project-feature-audio-rendered-fallback.ts';
import type { ProjectFeatureAudioRenderedFallbackMetadata } from '../project-feature-audio-rendered-fallback.ts';
import { isProjectFeatureAudioCapabilityId } from '../project-feature-capabilities.ts';
import type {
	ProjectFeatureRequirementsReport,
	ProjectFeatureRequirementsReportItem,
} from '../project-feature-requirements.ts';
import type { ProjectAudioFallbackIntegritySelector } from '../project-fallback-integrity.ts';
import { EDITOR_EXPORT_FORMATS } from './export-settings.ts';
import type { AudioRenderedFallbackDeliveryProjection } from './playback-project-service.ts';

interface AudioRenderedFallbackDeliveryService {
	projectForAudioRenderedFallbackDelivery<Project extends object>(
		project: Project,
	): AudioRenderedFallbackDeliveryProjection<Project>;
}

interface FallbackIntegrityAdmission {
	assertCurrent(project: unknown): void;
	getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector): EngineChunkSource;
}

interface AudioRenderedFallbackIntegrityRuntime {
	readonly store: unknown;
	readonly verifyProjectFallbackIntegrity?: (
		project: unknown,
		store: unknown,
		options: Readonly<{
			signal?: AbortSignal;
			audioFallback?: ProjectAudioFallbackIntegritySelector;
			assertCurrent?: () => void;
		}>,
	) => PromiseLike<FallbackIntegrityAdmission> | FallbackIntegrityAdmission;
}

interface AudioRenderedFallbackExportAdmissionOptions {
	readonly signal?: AbortSignal;
	readonly assertCurrent: () => void;
}

type RecordValue = Readonly<Record<PropertyKey, unknown>>;

interface AudioSourceDescriptor {
	readonly channelCount: number;
	readonly frameCount: number;
	readonly chunkFrames: number;
	readonly sampleRate: number;
}

const EMPTY_AUDIO_DELIVERY = Object.freeze({
	featureRequirementsReport: null,
	audioRenderedFallback: null,
	requiredAudioSourceIds: Object.freeze([]),
});

/** Select only the maintained audio whole-mix fallback projection used by final delivery. */
export function projectForAudioRenderedFallbackExport<Project extends object>(
	project: Project,
	service?: AudioRenderedFallbackDeliveryService | null,
): AudioRenderedFallbackDeliveryProjection<Project> {
	if (!service) return Object.freeze({ project, ...EMPTY_AUDIO_DELIVERY });
	if (typeof service.projectForAudioRenderedFallbackDelivery !== 'function') {
		throw new TypeError('Audio rendered-fallback delivery projection is unavailable.');
	}
	const projection = service.projectForAudioRenderedFallbackDelivery(project);
	assertDeliveryProjection(projection);
	return projection;
}

/** Refuse export shapes that cannot preserve one admitted whole-mix fallback. */
export function assertAudioRenderedFallbackExportSettings(
	projection: AudioRenderedFallbackDeliveryProjection<object>,
	settings: unknown,
): void {
	assertDeliveryProjection(projection);
	if (!projection.audioRenderedFallback) return;
	const record = recordValue(settings, 'Normalized audio export settings');
	const mode = ownData(record, 'mode', 'Normalized audio export settings');
	const format = ownData(record, 'format', 'Normalized audio export settings');
	if (mode !== 'mix') {
		throw new RangeError('Audio rendered-fallback export supports only normalized mix mode, not stems.');
	}
	if (typeof format !== 'string' || !(EDITOR_EXPORT_FORMATS as readonly string[]).includes(format)) {
		throw new TypeError('Audio rendered-fallback export requires normalized export settings.');
	}
	if (format === 'bw64' || optionalOwnData(record, 'adm', 'Normalized audio export settings') != null) {
		throw new RangeError('Audio rendered-fallback export does not support BW64 or ADM delivery.');
	}
}

/** Reverify one active fallback at operation time and return its private chunk provider. */
export async function admitAudioRenderedFallbackExport(
	canonicalProject: unknown,
	projection: AudioRenderedFallbackDeliveryProjection<object>,
	runtime: AudioRenderedFallbackIntegrityRuntime,
	options: AudioRenderedFallbackExportAdmissionOptions,
): Promise<EngineChunkSource | null> {
	assertDeliveryProjection(projection);
	if (!projection.audioRenderedFallback) return null;
	if (typeof options?.assertCurrent !== 'function') {
		throw new TypeError('Audio rendered-fallback export requires a currentness assertion.');
	}
	if (typeof runtime?.verifyProjectFallbackIntegrity !== 'function') {
		throw new TypeError('Audio rendered-fallback export integrity verification is unavailable.');
	}
	const selector = audioFallbackIntegritySelector(projection);
	const projectedSource = audioSourceDescriptor(projection.project, selector.sourceId);
	const canonicalSource = audioSourceDescriptor(canonicalProject, selector.sourceId);
	if (!sameSourceDescriptor(projectedSource, canonicalSource)) {
		throw new TypeError('Audio rendered-fallback delivery source geometry changed before integrity admission.');
	}
	throwIfAborted(options.signal);
	options.assertCurrent();
	const admission = await runtime.verifyProjectFallbackIntegrity(
		canonicalProject,
		runtime.store,
		{ signal: options.signal, audioFallback: selector, assertCurrent: options.assertCurrent },
	);
	throwIfAborted(options.signal);
	if (!admission || typeof admission.assertCurrent !== 'function'
		|| typeof admission.getVerifiedAudioChunkProvider !== 'function') {
		throw new TypeError('Audio rendered-fallback export integrity admission is invalid.');
	}
	admission.assertCurrent(canonicalProject);
	const provider = admission.getVerifiedAudioChunkProvider(selector);
	assertChunkProvider(provider, canonicalSource);
	throwIfAborted(options.signal);
	options.assertCurrent();
	return provider;
}

function assertDeliveryProjection(
	projection: AudioRenderedFallbackDeliveryProjection<object>,
): void {
	if (!projection || typeof projection !== 'object' || Array.isArray(projection)
		|| !projection.project || typeof projection.project !== 'object'
		|| Array.isArray(projection.project)) {
		throw new TypeError('Audio rendered-fallback delivery returned an invalid project.');
	}
	if (!Object.hasOwn(projection, 'featureRequirementsReport')
		|| !Object.hasOwn(projection, 'audioRenderedFallback')
		|| !Array.isArray(projection.requiredAudioSourceIds)) {
		throw new TypeError('Audio rendered-fallback delivery returned an invalid projection.');
	}
	const metadata = projection.audioRenderedFallback;
	if (metadata === null) {
		if (projection.requiredAudioSourceIds.length !== 0) {
			throw new TypeError('Inactive audio rendered-fallback delivery retained a source root.');
		}
		return;
	}
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
		throw new TypeError('Audio rendered-fallback delivery returned invalid metadata.');
	}
	assertActiveMetadata(metadata, projection.requiredAudioSourceIds);
	audioSourceDescriptor(projection.project, metadata.sourceId);
	assertFallbackReport(projection.featureRequirementsReport, metadata);
}

function assertActiveMetadata(
	metadata: ProjectFeatureAudioRenderedFallbackMetadata,
	requiredSourceIds: readonly string[],
): void {
	if (metadata.schemaVersion !== 1
		|| !isProjectFeatureAudioCapabilityId(metadata.featureId)
		|| typeof metadata.requirementId !== 'string' || !metadata.requirementId
		|| typeof metadata.sourceId !== 'string' || !metadata.sourceId
		|| metadata.trackId !== PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track
		|| metadata.clipId !== PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip
		|| requiredSourceIds.length !== 1
		|| requiredSourceIds[0] !== metadata.sourceId) {
		throw new TypeError('Audio rendered-fallback delivery metadata does not match its required source.');
	}
}

function assertFallbackReport(
	report: ProjectFeatureRequirementsReport | null,
	metadata: ProjectFeatureAudioRenderedFallbackMetadata,
): ProjectFeatureRequirementsReportItem {
	if (report?.format !== 'soundscaper-project' || report.compatible !== false || !Array.isArray(report.items)) {
		throw new TypeError('Audio rendered-fallback delivery requires an incompatible project report.');
	}
	const renderedFallbacks = report.items.filter((item) => item?.disposition === 'rendered-fallback');
	if (renderedFallbacks.length !== 1) {
		throw new RangeError('Audio export does not support simultaneous rendered fallbacks.');
	}
	const item = renderedFallbacks[0];
	if (!matchesFallback(item, metadata)) {
		throw new TypeError('Audio rendered-fallback delivery report does not match its metadata.');
	}
	return item;
}

function audioFallbackIntegritySelector(
	projection: AudioRenderedFallbackDeliveryProjection<object>,
): ProjectAudioFallbackIntegritySelector {
	const metadata = projection.audioRenderedFallback!;
	const item = assertFallbackReport(projection.featureRequirementsReport, metadata);
	const digest = item.fallback!.sha256;
	if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
		throw new TypeError('Audio rendered-fallback delivery report has an invalid SHA-256 digest.');
	}
	return Object.freeze({
		requirementId: metadata.requirementId,
		featureId: metadata.featureId,
		kind: 'audio',
		sourceId: metadata.sourceId,
		sha256: digest,
	});
}

function matchesFallback(
	item: ProjectFeatureRequirementsReportItem | undefined,
	metadata: ProjectFeatureAudioRenderedFallbackMetadata,
): boolean {
	return Boolean(item
		&& item.requirementId === metadata.requirementId
		&& item.featureId === metadata.featureId
		&& item.availability === 'unavailable'
		&& item.declaredDisposition === 'rendered-fallback'
		&& item.disposition === 'rendered-fallback'
		&& item.fallback?.kind === 'audio'
		&& item.fallback.sourceId === metadata.sourceId);
}

function assertChunkProvider(
	value: unknown,
	expected: AudioSourceDescriptor,
): asserts value is EngineChunkSource {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Audio rendered-fallback integrity returned an invalid chunk provider.');
	}
	const provider = value as Partial<EngineChunkSource>;
	if (!positiveSafeInteger(provider.channelCount) || provider.channelCount > 64
		|| !positiveSafeInteger(provider.frameCount)
		|| !positiveSafeInteger(provider.chunkFrames)
		|| provider.chunkFrames > AUDIO_EDITOR_STORAGE_CHUNK_FRAMES
		|| !positiveSafeInteger(provider.sampleRate)
		|| provider.channelCount !== expected.channelCount
		|| provider.frameCount !== expected.frameCount
		|| provider.chunkFrames !== expected.chunkFrames
		|| provider.sampleRate !== expected.sampleRate
		|| typeof provider.readStorageChunk !== 'function') {
		throw new TypeError('Audio rendered-fallback integrity returned an invalid chunk provider.');
	}
}

function audioSourceDescriptor(project: unknown, sourceId: string): AudioSourceDescriptor {
	const projectRecord = recordValue(project, 'Audio rendered-fallback delivery project');
	const sources = ownData(projectRecord, 'sources', 'Audio rendered-fallback delivery project');
	if (!Array.isArray(sources)) {
		throw new TypeError('Audio rendered-fallback delivery project sources must be an array.');
	}
	const matches = sources.filter((candidate) => Boolean(candidate && typeof candidate === 'object'
		&& !Array.isArray(candidate)
		&& optionalOwnData(candidate as RecordValue, 'id', 'Audio rendered-fallback source') === sourceId));
	if (matches.length !== 1) {
		throw new TypeError('Audio rendered-fallback delivery source is missing or duplicated.');
	}
	const source = matches[0] as RecordValue;
	if (ownData(source, 'kind', `Audio rendered-fallback source ${sourceId}`) !== 'audio') {
		throw new TypeError('Audio rendered-fallback delivery source must be audio.');
	}
	const descriptor = Object.freeze({
		channelCount: ownData(source, 'channelCount', `Audio rendered-fallback source ${sourceId}`),
		frameCount: ownData(source, 'frameCount', `Audio rendered-fallback source ${sourceId}`),
		chunkFrames: ownData(source, 'chunkFrames', `Audio rendered-fallback source ${sourceId}`),
		sampleRate: ownData(source, 'sampleRate', `Audio rendered-fallback source ${sourceId}`),
	});
	if (!positiveSafeInteger(descriptor.channelCount) || descriptor.channelCount > 64
		|| !positiveSafeInteger(descriptor.frameCount)
		|| !positiveSafeInteger(descriptor.chunkFrames)
		|| descriptor.chunkFrames > AUDIO_EDITOR_STORAGE_CHUNK_FRAMES
		|| !positiveSafeInteger(descriptor.sampleRate)) {
		throw new TypeError('Audio rendered-fallback delivery source geometry is invalid.');
	}
	return descriptor as AudioSourceDescriptor;
}

function sameSourceDescriptor(left: AudioSourceDescriptor, right: AudioSourceDescriptor): boolean {
	return left.channelCount === right.channelCount
		&& left.frameCount === right.frameCount
		&& left.chunkFrames === right.chunkFrames
		&& left.sampleRate === right.sampleRate;
}

function positiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function recordValue(value: unknown, name: string): RecordValue {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as RecordValue;
}

function ownData(record: RecordValue, key: PropertyKey, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${String(key)} must be a data property.`);
	}
	return descriptor.value;
}

function optionalOwnData(record: RecordValue, key: PropertyKey, name: string): unknown {
	if (!Object.hasOwn(record, key)) return undefined;
	return ownData(record, key, name);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
}
