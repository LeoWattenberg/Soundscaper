/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-owned, pathless projection of the optional desktop model manager. */

export const LOCAL_MODEL_AVAILABILITIES = Object.freeze([
	'installed', 'installable', 'unsupported-platform', 'insufficient-memory',
] as const);

export type LocalModelAvailability = (typeof LOCAL_MODEL_AVAILABILITIES)[number];

export interface LocalModelManagerModel {
	readonly modelId: string;
	readonly version: string;
	readonly task: string;
	readonly availability: LocalModelAvailability;
	readonly downloadBytes: number | null;
	readonly installedBytes: number | null;
	readonly attributionRequired: boolean;
}

export interface LocalModelManagerStatus {
	readonly runtimeAvailable: boolean;
	readonly runtimeReason: string | null;
	readonly models: readonly LocalModelManagerModel[];
}

export interface LocalModelInstallProgress {
	readonly modelId: string;
	readonly fileName: string;
	readonly completedBytes: number;
	readonly totalBytes: number;
}

export interface LocalModelInstallCancellation {
	readonly contractVersion: 1;
	readonly modelId: string;
	readonly outcome: 'cancelled' | 'not-active';
}

export interface LocalModelReconciliation {
	readonly installedModelIds: readonly string[];
	readonly incompleteModelIds: readonly string[];
	readonly rejected: readonly Readonly<{ modelId: string; reason: string }>[];
}

export interface LocalModelGarbageCollection {
	readonly reclaimedBlobBytes: number;
	readonly discardedManifestCount: number;
	readonly discardedPartialCount: number;
	readonly discardedPartialBytes: number;
	readonly reclaimedBytes: number;
}

export interface LocalModelInstalledNotice {
	readonly schemaVersion: 1;
	readonly modelId: string;
	readonly version: string;
	readonly purpose: string;
	readonly codeLicense: string;
	readonly weightsLicense: string;
	readonly attributionRequired: boolean;
	readonly provenanceSources: readonly string[];
	readonly upstreamRevision: string;
	readonly distributionKind: 'identity-mirrored';
}

export interface LocalModelRelocation {
	readonly contractVersion: 1;
	readonly totalBytes: number;
	readonly fileCount: number;
	readonly sourceRemoved: boolean;
}

export interface LocalModelManagerBridge {
	readonly listAssistanceModels: () => Promise<unknown>;
	readonly installAssistanceModel: (modelId: string) => Promise<unknown>;
	readonly cancelAssistanceModelInstall: (modelId: string) => Promise<unknown>;
	readonly installPreseededAssistanceModel: (modelId: string) => Promise<unknown>;
	readonly reconcileAssistanceModels: () => Promise<unknown>;
	readonly collectAssistanceModelGarbage: () => Promise<unknown>;
	readonly listAssistanceModelNotices: () => Promise<unknown>;
	readonly relocateAssistanceModels: () => Promise<unknown>;
	readonly removeAssistanceModel: (modelId: string) => Promise<unknown>;
	readonly onAssistanceInstallProgress:
		(listener: (progress: unknown) => void) => () => void;
}

const MODEL_ID_PATTERN = /^[a-z\d][a-z\d.-]{0,62}[a-z\d]$/u;
const AVAILABILITIES = new Set<string>(LOCAL_MODEL_AVAILABILITIES);
const REQUIRED_METHODS = Object.freeze([
	'listAssistanceModels', 'installAssistanceModel', 'cancelAssistanceModelInstall',
	'installPreseededAssistanceModel', 'reconcileAssistanceModels',
	'collectAssistanceModelGarbage', 'listAssistanceModelNotices',
	'relocateAssistanceModels', 'removeAssistanceModel',
	'onAssistanceInstallProgress',
] as const);

export function resolveLocalModelManagerBridge(value: unknown): LocalModelManagerBridge | null {
	if (!isRecord(value)) return null;
	if (REQUIRED_METHODS.some((method) => typeof value[method] !== 'function')) return null;
	return value as unknown as LocalModelManagerBridge;
}

export function normalizeLocalModelManagerStatus(value: unknown): LocalModelManagerStatus {
	if (!isRecord(value) || !Array.isArray(value.models)) {
		throw new TypeError('The desktop returned a malformed local-model status.');
	}
	const seen = new Set<string>();
	const models = value.models.map((candidate) => {
		const model = normalizeLocalModelManagerModel(candidate);
		if (seen.has(model.modelId)) {
			throw new TypeError(`The desktop repeated local model ${model.modelId}.`);
		}
		seen.add(model.modelId);
		return model;
	});
	return Object.freeze({
		runtimeAvailable: boolean(value.runtimeAvailable, 'runtime availability'),
		runtimeReason: nullableText(value.runtimeReason, 512, 'runtime reason'),
		models: Object.freeze(models),
	});
}

export function normalizeLocalModelManagerModel(value: unknown): LocalModelManagerModel {
	if (!isRecord(value)) throw new TypeError('The desktop returned a malformed local model.');
	const availability = boundedText(value.availability, 32, 'availability');
	if (!AVAILABILITIES.has(availability)) {
		throw new TypeError('The desktop returned an unsupported local-model availability.');
	}
	return Object.freeze({
		modelId: localModelId(value.modelId),
		version: boundedText(value.version, 64, 'version'),
		task: boundedText(value.task, 64, 'task'),
		availability: availability as LocalModelAvailability,
		downloadBytes: optionalBytes(value.downloadBytes),
		installedBytes: optionalBytes(value.installedBytes),
		attributionRequired: boolean(value.attributionRequired, 'attribution requirement'),
	});
}

export function normalizeLocalModelInstallProgress(value: unknown): LocalModelInstallProgress {
	if (!isRecord(value)) throw new TypeError('The desktop returned malformed model progress.');
	const fileName = boundedText(value.fileName, 160, 'artifact name');
	if (fileName.includes('/') || fileName.includes('\\')) {
		throw new TypeError('Local-model progress must not expose a path.');
	}
	const completedBytes = bytes(value.completedBytes, 'completed bytes');
	const totalBytes = bytes(value.totalBytes, 'total bytes');
	if (totalBytes < 1 || completedBytes > totalBytes) {
		throw new RangeError('Local-model progress is outside its declared byte range.');
	}
	return Object.freeze({
		modelId: localModelId(value.modelId), fileName, completedBytes, totalBytes,
	});
}

export function normalizeLocalModelInstallCancellation(value: unknown): LocalModelInstallCancellation {
	if (!isRecord(value) || value.contractVersion !== 1
		|| (value.outcome !== 'cancelled' && value.outcome !== 'not-active')) {
		throw new TypeError('The desktop returned malformed model cancellation state.');
	}
	return Object.freeze({
		contractVersion: 1, modelId: localModelId(value.modelId), outcome: value.outcome,
	});
}

function modelIds(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length > 256) {
		throw new TypeError(`The local-model ${label} are invalid.`);
	}
	return Object.freeze(value.map(localModelId));
}

export function normalizeLocalModelReconciliation(value: unknown): LocalModelReconciliation {
	if (!isRecord(value) || !Array.isArray(value.rejected) || value.rejected.length > 256) {
		throw new TypeError('The desktop returned a malformed model reconciliation.');
	}
	return Object.freeze({
		installedModelIds: modelIds(value.installedModelIds, 'installed ids'),
		incompleteModelIds: modelIds(value.incompleteModelIds, 'incomplete ids'),
		rejected: Object.freeze(value.rejected.map((candidate) => {
			if (!isRecord(candidate)) throw new TypeError('A model reconciliation rejection is invalid.');
			return Object.freeze({
				modelId: localModelId(candidate.modelId),
				reason: boundedText(candidate.reason, 512, 'reconciliation reason'),
			});
		})),
	});
}

export function normalizeLocalModelGarbageCollection(value: unknown): LocalModelGarbageCollection {
	if (!isRecord(value)) throw new TypeError('The desktop returned malformed model cleanup state.');
	return Object.freeze({
		reclaimedBlobBytes: bytes(value.reclaimedBlobBytes, 'reclaimed blob bytes'),
		discardedManifestCount: bytes(value.discardedManifestCount, 'discarded manifest count'),
		discardedPartialCount: bytes(value.discardedPartialCount, 'discarded partial count'),
		discardedPartialBytes: bytes(value.discardedPartialBytes, 'discarded partial bytes'),
		reclaimedBytes: bytes(value.reclaimedBytes, 'reclaimed bytes'),
	});
}

function provenanceSource(value: unknown): string {
	const source = boundedText(value, 2_048, 'notice source');
	let parsed: URL;
	try { parsed = new URL(source); }
	catch (error) { throw new TypeError('A local-model notice source is invalid.', { cause: error }); }
	if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
		throw new TypeError('A local-model notice source must be a clean HTTPS URL.');
	}
	return parsed.href;
}

export function normalizeLocalModelInstalledNotices(value: unknown): readonly LocalModelInstalledNotice[] {
	if (!Array.isArray(value) || value.length > 256) {
		throw new TypeError('The desktop returned malformed installed-model notices.');
	}
	return Object.freeze(value.map((notice) => {
		if (!isRecord(notice) || notice.schemaVersion !== 1
			|| notice.distributionKind !== 'identity-mirrored'
			|| !Array.isArray(notice.provenanceSources)
			|| notice.provenanceSources.length === 0 || notice.provenanceSources.length > 32) {
			throw new TypeError('The desktop returned a malformed installed-model notice.');
		}
		return Object.freeze({
			schemaVersion: 1,
			modelId: localModelId(notice.modelId),
			version: boundedText(notice.version, 64, 'notice version'),
			purpose: boundedText(notice.purpose, 1_024, 'notice purpose'),
			codeLicense: boundedText(notice.codeLicense, 128, 'code license'),
			weightsLicense: boundedText(notice.weightsLicense, 128, 'weights license'),
			attributionRequired: boolean(notice.attributionRequired, 'notice attribution requirement'),
			provenanceSources: Object.freeze(notice.provenanceSources.map(provenanceSource)),
			upstreamRevision: boundedText(notice.upstreamRevision, 256, 'upstream revision'),
			distributionKind: 'identity-mirrored',
		});
	}));
}

export function normalizeLocalModelRelocation(value: unknown): LocalModelRelocation {
	if (!isRecord(value) || value.contractVersion !== 1 || typeof value.sourceRemoved !== 'boolean') {
		throw new TypeError('The desktop returned malformed model relocation state.');
	}
	return Object.freeze({
		contractVersion: 1,
		totalBytes: bytes(value.totalBytes, 'relocation bytes'),
		fileCount: bytes(value.fileCount, 'relocation file count'),
		sourceRemoved: value.sourceRemoved,
	});
}

export function localModelId(value: unknown): string {
	if (typeof value !== 'string' || !MODEL_ID_PATTERN.test(value)) {
		throw new TypeError('Unsupported local model id.');
	}
	return value;
}

export function localModelByteCount(value: unknown, label = 'byte count'): number {
	return bytes(value, label);
}

function optionalBytes(value: unknown): number | null {
	return value === null || value === undefined ? null : bytes(value, 'model byte count');
}

function bytes(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The local-model ${label} is invalid.`);
	}
	return Number(value);
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
		throw new TypeError(`The local-model ${label} is invalid.`);
	}
	return value;
}

function nullableText(value: unknown, maximum: number, label: string): string | null {
	if (value === null || value === undefined) return null;
	return boundedText(value, maximum, label);
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`The local-model ${label} is invalid.`);
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
