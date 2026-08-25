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

export interface LocalModelManagerBridge {
	readonly listAssistanceModels: () => Promise<unknown>;
	readonly installAssistanceModel: (modelId: string) => Promise<unknown>;
	readonly removeAssistanceModel: (modelId: string) => Promise<unknown>;
	readonly onAssistanceInstallProgress:
		(listener: (progress: unknown) => void) => () => void;
}

const MODEL_ID_PATTERN = /^[a-z\d][a-z\d.-]{0,62}[a-z\d]$/u;
const AVAILABILITIES = new Set<string>(LOCAL_MODEL_AVAILABILITIES);
const REQUIRED_METHODS = Object.freeze([
	'listAssistanceModels', 'installAssistanceModel', 'removeAssistanceModel',
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
