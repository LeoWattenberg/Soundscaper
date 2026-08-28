/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStableId } from './project.js';
import { awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import type { ScapeArchiveEntry, ScapeManifest } from './scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from './scape-expanded-byte-budget.ts';
import type { PlannedScapeExportAsset } from './scape-export-plan.ts';
import type { ScapeImportStore, ScapeImportTransaction } from './scape-import-transaction.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface ScapeProjectAssetExtensionExportRequest {
	readonly project: Readonly<Record<string, unknown>>;
	readonly store: Readonly<{
		getMediaAssetMetadata(sourceId: string): Awaitable<unknown>;
	}>;
	readonly signal?: AbortSignal;
}

export interface ScapeProjectAssetExtensionImportRequest {
	readonly archiveProject: Record<string, unknown>;
	readonly project: Record<string, unknown>;
	readonly manifest: ScapeManifest;
	readonly entryByName: ReadonlyMap<string, ScapeArchiveEntry>;
	readonly expandedByteBudget: ScapeExpandedByteBudget;
	readonly sourceIdMap: ReadonlyMap<string, string>;
	readonly validation: unknown;
	readonly store: ScapeImportStore;
	readonly transaction: ScapeImportTransaction;
	readonly signal?: AbortSignal;
}

export interface ScapeProjectAssetExtension {
	readonly assetKinds: readonly string[];
	readonly sourceKinds: readonly string[];
	planExportAssets(
		request: Readonly<ScapeProjectAssetExtensionExportRequest>,
	): Awaitable<readonly PlannedScapeExportAsset[]>;
	validateExportAssetBody(asset: PlannedScapeExportAsset, body: Blob, signal?: AbortSignal): Awaitable<void>;
	validateImportAssets(project: unknown, manifest: ScapeManifest): unknown;
	stageImportAssets(request: Readonly<ScapeProjectAssetExtensionImportRequest>): Awaitable<void>;
	validateReboundProject(project: unknown): void;
	sourceStorageRole(source: Readonly<Record<string, unknown>>): 'media' | 'none';
}

const CANONICAL_ASSET_KINDS = new Set(['audio', 'video', 'video-timing']);
const CANONICAL_SOURCE_KINDS = new Set(['audio', 'video']);
const KIND = /^[a-z][a-z0-9-]{0,63}$/u;

export function resolveScapeProjectAssetExtension(value: unknown): ScapeProjectAssetExtension | null {
	if (value === undefined || value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The Scape project asset extension must be a record.');
	}
	const candidate = value as Partial<ScapeProjectAssetExtension>;
	for (const method of [
		'planExportAssets', 'validateExportAssetBody', 'validateImportAssets', 'stageImportAssets',
		'validateReboundProject', 'sourceStorageRole',
	] as const) {
		if (typeof candidate[method] !== 'function') {
			throw new TypeError(`The Scape project asset extension requires ${method}.`);
		}
	}
	const assetKinds = extensionKinds(candidate.assetKinds, CANONICAL_ASSET_KINDS, 'asset');
	const sourceKinds = extensionKinds(candidate.sourceKinds, CANONICAL_SOURCE_KINDS, 'source');
	const extension: ScapeProjectAssetExtension = {
		assetKinds,
		sourceKinds,
		planExportAssets: (request) => candidate.planExportAssets!(request),
		validateExportAssetBody: (asset, body, signal) => (
			candidate.validateExportAssetBody!(asset, body, signal)
		),
		validateImportAssets: (project, manifest) => candidate.validateImportAssets!(project, manifest),
		stageImportAssets: (request) => candidate.stageImportAssets!(request),
		validateReboundProject: (project) => { candidate.validateReboundProject!(project); },
		sourceStorageRole: (source) => candidate.sourceStorageRole!(source),
	};
	return Object.freeze(extension);
}

export async function prepareScapeImportSourceIdentities(
	project: Record<string, unknown>,
	store: Pick<ScapeImportStore, 'getMediaAssetMetadata' | 'getSourceMetadata'>,
	extension: ScapeProjectAssetExtension | null,
	signal?: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
	const sources = Array.isArray(project.sources) ? project.sources : [];
	const sourceIdMap = new Map<string, string>();
	for (const value of sources) {
		throwIfScapeAborted(signal);
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError('The admitted Scape project contains an invalid source.');
		}
		const source = value as Record<string, unknown>;
		const sourceId = stableId(source.id, 'admitted source ID');
		const kind = String(source.kind);
		const role = kind === 'audio' ? 'audio' : kind === 'video' ? 'media'
			: extensionSourceRole(extension, source, kind);
		const storageKey = role === 'media' && kind !== 'video'
			? stableId(source.storageKey, `admitted ${kind} storage key`) : sourceId;
		const occupied = role === 'audio'
			? await awaitScapeOperation(store.getSourceMetadata(sourceId), signal)
			: role === 'media'
				? await awaitScapeOperation(store.getMediaAssetMetadata(storageKey), signal) : null;
		const nextId = occupied ? createStableId(role === 'audio' ? 'source' : `${kind}-source`) : sourceId;
		sourceIdMap.set(sourceId, nextId);
		source.id = nextId;
		if (role !== 'none') source.storageKey = nextId;
		if (kind === 'video') {
			source.posterStorageKey = null;
			source.thumbnailStorageKey = null;
		}
	}
	return sourceIdMap;
}

function extensionKinds(
	value: unknown,
	reserved: ReadonlySet<string>,
	label: string,
): readonly string[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
		throw new TypeError(`The Scape extension ${label} kinds must be a bounded array.`);
	}
	const kinds = value.map((kind) => {
		if (typeof kind !== 'string' || !KIND.test(kind) || reserved.has(kind)) {
			throw new TypeError(`The Scape extension ${label} kind is invalid: ${String(kind)}.`);
		}
		return kind;
	});
	if (new Set(kinds).size !== kinds.length) {
		throw new Error(`The Scape extension ${label} kinds must be unique.`);
	}
	return Object.freeze(kinds);
}

function extensionSourceRole(
	extension: ScapeProjectAssetExtension | null,
	source: Readonly<Record<string, unknown>>,
	kind: string,
): 'media' | 'none' {
	if (!extension || !extension.sourceKinds.includes(kind)) {
		throw new TypeError(`Source ${String(source.id)} has an unsupported kind.`);
	}
	const role = extension.sourceStorageRole(source);
	if (role !== 'media' && role !== 'none') {
		throw new TypeError(`The Scape extension returned an invalid ${kind} storage role.`);
	}
	return role;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`The ${label} is invalid.`);
	return value;
}
