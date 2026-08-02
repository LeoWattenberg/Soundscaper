/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	commitDirectPcmDestination,
	openDirectPcmDestination,
	type DirectPcmDestination,
	type DirectPcmPreparation,
} from './direct-pcm-export.ts';
import { inspectZip32Layout, type Zip32Layout } from './zip32.ts';

const ZIP_CONTAINER_LABEL = 'ZIP';
const ZIP_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'ZIP stem archive',
	accept: Object.freeze({ 'application/zip': Object.freeze(['.zip']) }),
})]);
const DIRECT_STEM_FORMATS = new Set(['wav', 'aiff', 'bwf']);

interface DirectStemOutput {
	readonly fileName?: unknown;
}

interface DirectStemArchiveEntry {
	readonly expectedByteLength?: unknown;
	readonly fileName?: unknown;
}

interface DirectStemArchive {
	readonly entries?: unknown;
	readonly expectedByteLength?: unknown;
	readonly fileName?: unknown;
	readonly format?: unknown;
	readonly mimeType?: unknown;
	readonly zip32?: unknown;
}

interface DirectStemArchivePlan {
	readonly archive?: DirectStemArchive | null;
	readonly format?: unknown;
	readonly mode?: unknown;
	readonly outputFileBytesPerRender?: unknown;
	readonly outputs?: unknown;
}

interface DirectStemArchiveFileService {
	readonly prepareSave?: (
		request: Readonly<Record<string, unknown>>,
	) => PromiseLike<unknown> | unknown;
}

interface ExactDirectStemArchivePlan extends DirectStemArchivePlan {
	readonly archive: DirectStemArchive & {
		readonly entries: readonly DirectStemArchiveEntry[];
		readonly expectedByteLength: number;
		readonly fileName: string;
		readonly zip32: Zip32Layout;
	};
	readonly outputFileBytesPerRender: number;
	readonly outputs: readonly DirectStemOutput[];
}

export type DirectStemArchiveDestination = DirectPcmDestination;
export type DirectStemArchivePreparation = DirectPcmPreparation;

/** Select and open an exact direct destination only for validated native-PCM ZIP stems. */
export async function prepareDirectStemArchiveDestination(
	fileService: DirectStemArchiveFileService,
	plan: DirectStemArchivePlan,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectStemArchivePreparation> {
	if (!exactDirectStemArchivePlan(plan) || typeof fileService.prepareSave !== 'function') {
		return emptyPreparation();
	}
	const settings = requestedSettings || {};
	const prepared = await fileService.prepareSave({
		purpose: 'audio',
		suggestedName: plan.archive.fileName,
		mimeType: 'application/zip',
		target: settings.saveTarget,
		types: ZIP_FILE_TYPES,
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
	return openDirectPcmDestination(
		prepared,
		plan.archive.expectedByteLength,
		ZIP_CONTAINER_LABEL,
	);
}

/** Largest sequential intermediate retained while the final archive streams directly. */
export function directStemArchiveTemporaryBytes(plan: DirectStemArchivePlan): number | null {
	return exactDirectStemArchivePlan(plan) ? plan.outputFileBytesPerRender : null;
}

export function commitDirectStemArchiveDestination(
	destination: DirectStemArchiveDestination,
	plannedByteLength: number,
	emittedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	return commitDirectPcmDestination(
		destination,
		plannedByteLength,
		emittedByteLength,
		assertReadyToCommit,
		ZIP_CONTAINER_LABEL,
	);
}

function exactDirectStemArchivePlan(
	plan: DirectStemArchivePlan,
): plan is ExactDirectStemArchivePlan {
	try {
		if (plan?.mode !== 'stems'
			|| !DIRECT_STEM_FORMATS.has(String(plan.format))
			|| !Number.isSafeInteger(plan.outputFileBytesPerRender)
			|| Number(plan.outputFileBytesPerRender) <= 0
			|| !Array.isArray(plan.outputs)
			|| !plan.outputs.length
			|| plan.archive?.format !== 'zip'
			|| plan.archive.mimeType !== 'application/zip'
			|| typeof plan.archive.fileName !== 'string'
			|| !plan.archive.fileName.toLowerCase().endsWith('.zip')
			|| !Number.isSafeInteger(plan.archive.expectedByteLength)
			|| Number(plan.archive.expectedByteLength) <= 0
			|| !Array.isArray(plan.archive.entries)
			|| plan.archive.entries.length !== plan.outputs.length
			|| !isZip32Layout(plan.archive.zip32)) return false;
		const entryBytes = plan.outputFileBytesPerRender as number;
		const entries = plan.archive.entries as readonly DirectStemArchiveEntry[];
		const outputs = plan.outputs as readonly DirectStemOutput[];
		for (const [index, entry] of entries.entries()) {
			if (typeof entry?.fileName !== 'string'
				|| entry.fileName !== outputs[index]?.fileName
				|| entry.expectedByteLength !== entryBytes) return false;
		}
		const expected = inspectZip32Layout(entries.map((entry) => ({
			fileName: entry.fileName as string,
			byteLength: entry.expectedByteLength as number,
		})));
		return expected.eligible
			&& sameZip32Layout(expected, plan.archive.zip32)
			&& expected.archiveByteLength === plan.archive.expectedByteLength;
	} catch {
		return false;
	}
}

function isZip32Layout(value: unknown): value is Zip32Layout {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const layout = value as Readonly<Record<string, unknown>>;
	return layout.eligible === true
		&& ['entryCount', 'localByteLength', 'centralDirectoryByteLength', 'archiveByteLength']
			.every((field) => Number.isSafeInteger(layout[field]) && Number(layout[field]) >= 0);
}

function sameZip32Layout(left: Zip32Layout, right: Zip32Layout): boolean {
	return left.eligible === right.eligible
		&& left.entryCount === right.entryCount
		&& left.localByteLength === right.localByteLength
		&& left.centralDirectoryByteLength === right.centralDirectoryByteLength
		&& left.archiveByteLength === right.archiveByteLength;
}

function emptyPreparation(): DirectStemArchivePreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
