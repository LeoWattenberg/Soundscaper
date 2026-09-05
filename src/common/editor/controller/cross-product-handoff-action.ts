/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { withProjectFileExtension } from '../../project-file-extensions.ts';
import { SCAPE_MIME_TYPE } from '../scape-project-format.ts';
import {
	admitCrossProductHandoffLaunchIntent,
	type CrossProductHandoffLaunchIntentV1,
} from '../../cross-product-handoff-intent.ts';
import type { TransferRuntime } from '../../transfer/transfer-session.ts';
import {
	boundCrossProductHandoffArchiveFileName,
	CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MIME_TYPE,
	createCrossProductHandoffReportSidecarFromBinding,
	crossProductHandoffReportSidecarFileName,
	encodeCrossProductHandoffReportSidecar,
} from '../../transfer/cross-product-handoff-report-sidecar.ts';

const MAXIMUM_EDITABLE_COPY_BYTES = 512 * 1024 * 1024;

export interface CrossProductHandoffActionScope {
	readonly getProject: () => unknown;
	readonly assertProjectHandoffAllowed: () => unknown;
	readonly flushProject: () => PromiseLike<unknown> | unknown;
	readonly store: unknown;
	readonly fileService: Readonly<{
		saveFile(request: Readonly<{
			purpose: 'project-copy' | 'report'; blob: Blob; suggestedName: string; mimeType: string;
			signal: AbortSignal; useFileSystemAccess: boolean;
		}>): PromiseLike<unknown> | unknown;
	}>;
}

export interface CrossProductHandoffActionDependencies {
	readonly signal: AbortSignal;
	readonly loadRuntime: () => PromiseLike<TransferRuntime> | TransferRuntime;
}

export interface CrossProductHandoffActionResult {
	readonly saved: unknown;
	readonly reportSaved: unknown | null;
	readonly report: unknown;
	readonly fileName: string;
	readonly reportFileName: string | null;
}

/** The archive is externally committed, but its exact companion set is not confirmed. */
export class CrossProductHandoffPartialSaveError extends Error {
	readonly code = 'cross-product-handoff-partial-save';
	readonly archiveFileName: string;
	readonly reportFileName: string | null;

	constructor(archiveFileName: string, reportFileName: string | null, cause: unknown) {
		super(
			`Editable-copy archive ${archiveFileName} was saved, but its conversion report`
				+ `${reportFileName === null ? '' : ` ${reportFileName}`} was not confirmed.`,
			{ cause },
		);
		this.name = 'CrossProductHandoffPartialSaveError';
		this.archiveFileName = archiveFileName;
		this.reportFileName = reportFileName;
	}
}

/** Desktop fallback: build the destination-family archive and save it without changing source storage. */
export async function saveCrossProductEditableCopy(
	scope: CrossProductHandoffActionScope,
	intentValue: unknown,
	dependencies: CrossProductHandoffActionDependencies,
): Promise<Readonly<CrossProductHandoffActionResult>> {
	const intent = admitCrossProductHandoffLaunchIntent(intentValue);
	const { signal } = dependencies;
	signal.throwIfAborted();
	scope.assertProjectHandoffAllowed();
	signal.throwIfAborted();
	await scope.flushProject();
	signal.throwIfAborted();
	const project = scope.getProject() as { readonly id?: unknown } | null;
	if (!project || project.id !== intent.source.projectId) {
		throw new RangeError('The active project no longer matches the editable-copy launch intent.');
	}
	const runtime = await dependencies.loadRuntime();
	if (typeof runtime.exportEditableCopy !== 'function') {
		throw new TypeError('The desktop runtime cannot export editable cross-product copies.');
	}
	const exported = await runtime.exportEditableCopy(project as never, scope.store, {
		intent: intent as CrossProductHandoffLaunchIntentV1,
		signal,
		maximumBlobBytes: MAXIMUM_EDITABLE_COPY_BYTES,
	});
	if (!(exported.blob instanceof Blob)) {
		throw new TypeError('The editable cross-product copy did not produce an archive Blob.');
	}
	signal.throwIfAborted();
	const suggestedFileName = boundCrossProductHandoffArchiveFileName(
		withProjectFileExtension(exported.title, exported.fileExtension),
	);
	const archiveSha256 = await blobSha256(exported.blob, signal);
	const sidecar = createCrossProductHandoffReportSidecarFromBinding({
		entryId: exported.projectId,
		archiveByteLength: exported.blob.size,
		archiveSha256,
		report: exported.conversionReport,
	});
	const reportBytes = encodeCrossProductHandoffReportSidecar(sidecar);
	const saved = await scope.fileService.saveFile({
		purpose: 'project-copy',
		blob: exported.blob,
		suggestedName: suggestedFileName,
		mimeType: SCAPE_MIME_TYPE,
		signal,
		useFileSystemAccess: false,
	});
	if (cancelledSave(saved)) {
		return Object.freeze({
			saved, reportSaved: null, report: exported.conversionReport,
			fileName: suggestedFileName, reportFileName: null,
		});
	}
	const fileName = savedFileName(saved, suggestedFileName);
	let reportFileName: string | null = null;
	try {
		signal.throwIfAborted();
		reportFileName = crossProductHandoffReportSidecarFileName(fileName);
		const reportSaved = await scope.fileService.saveFile({
			purpose: 'report',
			blob: new Blob([reportBytes], { type: CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MIME_TYPE }),
			suggestedName: reportFileName,
			mimeType: CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MIME_TYPE,
			signal,
			useFileSystemAccess: false,
		});
		if (cancelledSave(reportSaved)) {
			throw new Error('The conversion-report save was cancelled.');
		}
		if (savedFileName(reportSaved, reportFileName) !== reportFileName) {
			throw new Error('The conversion report was saved under a name that no longer pairs with its archive.');
		}
		return Object.freeze({
			saved, reportSaved, report: exported.conversionReport, fileName, reportFileName,
		});
	} catch (error) {
		throw new CrossProductHandoffPartialSaveError(fileName, reportFileName, error);
	}
}

function cancelledSave(value: unknown): boolean {
	return Boolean(value && typeof value === 'object'
		&& Object.getOwnPropertyDescriptor(value, 'cancelled')?.value === true);
}

function savedFileName(value: unknown, fallback: string): string {
	if (!value || typeof value !== 'object') return fallback;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'fileName');
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
		&& descriptor.value.length > 0 ? descriptor.value : fallback;
}

async function blobSha256(blob: Blob, signal: AbortSignal): Promise<string> {
	const digest = sha256.create();
	const reader = blob.stream().getReader();
	let byteLength = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const chunk = await reader.read();
			signal.throwIfAborted();
			if (chunk.done) break;
			byteLength += chunk.value.byteLength;
			if (byteLength > blob.size) throw new Error('The editable-copy archive stream exceeded its Blob size.');
			digest.update(chunk.value);
		}
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (byteLength !== blob.size) {
		throw new Error('The editable-copy archive stream ended before its complete Blob size.');
	}
	return bytesToHex(digest.digest());
}
