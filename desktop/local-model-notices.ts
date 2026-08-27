/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pathless installed-model notice descriptors bound to authenticated evidence. */

import type { LocalModelCatalog, LocalModelCatalogEntry } from './local-model-catalog.ts';
import { localModelEvidenceSha256 } from './local-model-catalog-signature.ts';
import type { InstalledLocalModel } from './local-model-store.ts';

export const LOCAL_MODEL_NOTICE_SCHEMA_VERSION = 1;
export const LOCAL_MODEL_NOTICE_DOCUMENT = 'THIRD_PARTY_LICENSES.md#mirrored-assistance-models';

export interface InstalledLocalModelNotice {
	readonly schemaVersion: typeof LOCAL_MODEL_NOTICE_SCHEMA_VERSION;
	readonly modelId: string;
	readonly version: string;
	readonly purpose: string;
	readonly codeLicense: string;
	readonly weightsLicense: string;
	readonly attributionRequired: boolean;
	readonly provenanceSources: readonly string[];
	readonly upstreamRevision: string;
	readonly distributionKind: LocalModelCatalogEntry['distribution']['kind'];
	readonly noticeDocument: typeof LOCAL_MODEL_NOTICE_DOCUMENT;
}

export interface InstalledLocalModelNoticeOptions {
	readonly catalog: LocalModelCatalog;
	readonly licensingEvidence: readonly unknown[];
	readonly installed: readonly InstalledLocalModel[];
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
		throw new TypeError(`Installed local-model ${label} is invalid.`);
	}
	return value;
}

function provenanceSources(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
		throw new TypeError('Installed local-model provenance sources are invalid.');
	}
	const sources = value.map((source) => {
		const text = boundedText(source, 2_048, 'provenance source');
		let parsed: URL;
		try {
			parsed = new URL(text);
		} catch (error) {
			throw new TypeError('Installed local-model provenance source must be absolute.', { cause: error });
		}
		if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
			throw new TypeError('Installed local-model provenance source must be a clean HTTPS URL.');
		}
		return text;
	});
	if (new Set(sources).size !== sources.length) {
		throw new Error('Installed local-model provenance sources repeat an entry.');
	}
	return Object.freeze(sources);
}

function assertInstallationMatches(entry: LocalModelCatalogEntry, installed: InstalledLocalModel): void {
	const totalBytes = entry.artifacts.reduce((total, artifact) => total + artifact.byteLength, 0);
	const matches = installed.version === entry.version
		&& installed.totalBytes === totalBytes
		&& installed.artifacts.length === entry.artifacts.length
		&& installed.artifacts.every((artifact) => {
			const expected = entry.artifacts.find(({ fileName }) => fileName === artifact.fileName);
			return expected !== undefined
				&& expected.byteLength === artifact.byteLength
				&& expected.sha256 === artifact.sha256;
		});
	if (!matches) {
		throw new Error(`Installed local model ${installed.modelId} does not match its authenticated catalog entry.`);
	}
}

function evidenceFor(
	entry: LocalModelCatalogEntry,
	licensingEvidence: readonly unknown[],
): Record<string, unknown> {
	const matching = licensingEvidence.filter((value) => plainRecord(value) && value.id === entry.modelId);
	if (matching.length !== 1) {
		throw new Error(`Installed local model ${entry.modelId} needs exactly one licensing evidence row.`);
	}
	const evidence = matching[0] as Record<string, unknown>;
	if (entry.licensingEvidence.id !== entry.modelId
		|| localModelEvidenceSha256(evidence) !== entry.licensingEvidence.sha256) {
		throw new Error(`Installed local model ${entry.modelId} licensing evidence digest is invalid.`);
	}
	return evidence;
}

/** Every installed row must have one exact current catalog/evidence binding. */
export function createInstalledLocalModelNotices(
	options: InstalledLocalModelNoticeOptions,
): readonly InstalledLocalModelNotice[] {
	const seen = new Set<string>();
	const notices = [...options.installed]
		.sort((left, right) => left.modelId.localeCompare(right.modelId))
		.map((installed) => {
			if (seen.has(installed.modelId)) {
				throw new Error(`Installed local model ${installed.modelId} is repeated.`);
			}
			seen.add(installed.modelId);
			const entry = options.catalog.entries.find(({ modelId }) => modelId === installed.modelId);
			if (!entry) {
				throw new Error(`Installed local model ${installed.modelId} has no authenticated catalog notice.`);
			}
			assertInstallationMatches(entry, installed);
			const evidence = evidenceFor(entry, options.licensingEvidence);
			if (typeof evidence.attributionRequired !== 'boolean') {
				throw new TypeError(`Installed local model ${entry.modelId} has invalid attribution evidence.`);
			}
			return Object.freeze({
				schemaVersion: LOCAL_MODEL_NOTICE_SCHEMA_VERSION,
				modelId: entry.modelId,
				version: entry.version,
				purpose: boundedText(evidence.purpose, 1_024, 'purpose'),
				codeLicense: boundedText(evidence.codeLicense, 128, 'code license'),
				weightsLicense: boundedText(evidence.weightsLicense, 128, 'weights license'),
				attributionRequired: evidence.attributionRequired,
				provenanceSources: provenanceSources(evidence.provenanceSources),
				upstreamRevision: boundedText(entry.upstream.revision, 256, 'upstream revision'),
				distributionKind: entry.distribution.kind,
				noticeDocument: LOCAL_MODEL_NOTICE_DOCUMENT,
			});
		});
	return Object.freeze(notices);
}
