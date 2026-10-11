/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseMotionAeExchange, motionAeMediaPath } from '../common/editor/motion-ae-exchange.ts';
import { MOTION_AE_EXCHANGE_LIMITS } from '../common/editor/motion-ae-exchange-types.ts';
import { MOTION_MEDIA_IMPORT_MAXIMUM_BYTES } from '../common/editor/motion-media-limits.ts';
import { admitMotionAeSelectedFonts, type MotionAeSelectedFont, type MotionAeFontDecoder } from '../common/editor/motion-ae-font-import.ts';
import type { MotionAeTextImportOptions } from '../common/editor/motion-ae-text-conversion.ts';
import type { MotionAeFontBinding } from '../common/editor/motion-ae-text-fonts.ts';
import type { MotionImportedMedia, prepareMotionMedia } from '../common/editor/motion-media-import.ts';
import { createScapeDigest, scapeHex } from '../common/editor/scape-archive-media.ts';
import { aggregateScapeErrors, throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import { freezeMotionValue } from '../common/editor/motion-values.ts';
import { convertMotionscaperAeExchange, type MotionscaperAeConversion } from './editor-ae-conversion.ts';
import type { MotionArchiveImportTransaction } from './editor-scape.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';

export const MOTION_AE_IMPORT_MAXIMUM_SELECTED_BYTES = 256 * 1024 * 1024;
export interface MotionAeSelectedFile { readonly path: string; readonly file: Blob }
export interface MotionscaperAeImportOptions {
	readonly projectId?: string; readonly allocateId?: () => string; readonly primaryCompositionId?: string;
	/** Narrow metadata decoder seam; publication independently verifies returned body hashes. */
	readonly prepareMedia?: typeof prepareMotionMedia;
	readonly fonts?: readonly MotionAeSelectedFont[]; readonly text?: MotionAeTextImportOptions;
	readonly prepareFont?: MotionAeFontDecoder;
}
export type PreparedMotionscaperAeImport = MotionscaperAeConversion;
interface PrivatePreparation { readonly media: readonly MotionImportedMedia[]; state: 'prepared' | 'publishing' | 'committed' | 'cleanup-failed' }
const PREPARATIONS = new WeakMap<PreparedMotionscaperAeImport, PrivatePreparation>();

/** Read-only preparation. No store transaction begins until explicit report acknowledgement. */
export async function prepareMotionscaperAeImport(manifest: Blob, files: readonly MotionAeSelectedFile[], options: MotionscaperAeImportOptions = {}, signal?: AbortSignal): Promise<PreparedMotionscaperAeImport> {
	throwIfScapeAborted(signal);
	if (!(manifest instanceof Blob) || manifest.size < 1 || manifest.size > MOTION_AE_EXCHANGE_LIMITS.jsonBytes) throw new RangeError('AE exchange manifest exceeds its 16 MiB admission.');
	if (files.length > MOTION_AE_EXCHANGE_LIMITS.footage) throw new RangeError('Too many AE media selections.');
	const exchange = parseMotionAeExchange(await manifest.text()); throwIfScapeAborted(signal);
	const selected = new Map<string, Blob>(), aliases = new Set<string>(); let total = admitMotionAeSelectedFonts(options.fonts ?? [], exchange);
	if (total > MOTION_AE_IMPORT_MAXIMUM_SELECTED_BYTES) throw new RangeError('AE selected font/media bytes exceed the 256 MiB transfer budget.');
	const referenced = new Set(exchange.footage.map((entry) => entry.path));
	for (const entry of files) {
		const path = motionAeMediaPath(entry.path), alias = path.toLowerCase();
		if (aliases.has(alias)) throw new Error('Duplicate or ambiguous AE media selection.'); aliases.add(alias);
		if (!referenced.has(path)) throw new Error('Selected AE media is not referenced by this manifest.');
		if (!(entry.file instanceof Blob) || entry.file.size < 1 || entry.file.size > MOTION_MEDIA_IMPORT_MAXIMUM_BYTES) throw new RangeError('AE media conversion accepts each selected file up to 64 MiB. Render or convert larger media first.');
		total += entry.file.size;
		if (total > MOTION_AE_IMPORT_MAXIMUM_SELECTED_BYTES) throw new RangeError('AE media conversion accepts at most 256 MiB of selected media per transfer. Split the composition transfer.');
		selected.set(path, entry.file);
	}
	const allocateId = options.allocateId ?? (() => crypto.randomUUID()), projectId = options.projectId ?? allocateId();
	const prepare = options.prepareMedia ?? (await import('../common/editor/motion-media-import.ts')).prepareMotionMedia;
	const bindings = [], media: MotionImportedMedia[] = [], fonts: MotionAeFontBinding[] = [];
	if (options.fonts?.length) {
		const prepareFont = options.prepareFont ?? (await import('../common/editor/motion-ae-font-import.ts')).prepareMotionAeSelectedFont;
		for (const font of options.fonts) {
			throwIfScapeAborted(signal);
			const imported = await prepareFont(font.file, { id: allocateId(), name: font.name, style: font.style }, signal); throwIfScapeAborted(signal);
			if (!(imported.body instanceof Blob) || imported.body.size !== font.file.size || imported.asset.byteLength !== font.file.size) throw new Error('AE font decoder returned inconsistent retained bytes.');
			fonts.push({ postScriptName: font.postScriptName, asset: imported.asset }); media.push(imported);
		}
	}
	for (const source of exchange.footage) {
		throwIfScapeAborted(signal); const file = source.path === null ? undefined : selected.get(source.path);
		if (!file) {
			throw new Error('Every original AE media file must be selected and retained, including unused sources. Relink missing files in AE and export again.');
		}
		if (file.size !== source.byteLength) throw new Error('Selected AE media byte length differs from its manifest.');
		const imported = await prepare(file, { id: allocateId(), name: source.name, signal }); throwIfScapeAborted(signal);
		if (!(imported.body instanceof Blob) || imported.body.size !== file.size || imported.asset.byteLength !== file.size) throw new Error('AE media decoder returned inconsistent retained bytes.');
		bindings.push({ footageId: source.id, asset: imported.asset }); media.push(imported);
	}
	const conversion = convertMotionscaperAeExchange(exchange, { projectId, allocateId, bindings, fonts, text: options.text, primaryCompositionId: options.primaryCompositionId });
	const project = normalizeMotionscaperProject({ ...conversion.project, interchangeCustody: {
		format: 'org.motionscaper.ae-project-custody', version: 1, exchange, report: conversion.report,
		...(fonts.length ? { fonts: fonts.map(binding => ({ postScriptName: binding.postScriptName, assetId: binding.asset.id, sha256: binding.asset.sha256, byteLength: binding.asset.byteLength })) } : {}),
		media: bindings.map((binding) => ({ sourceId: binding.footageId, assetId: binding.asset.id, sha256: binding.asset.sha256, byteLength: binding.asset.byteLength })),
	} });
	const prepared = freezeMotionValue({ ...conversion, project });
	const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
	PREPARATIONS.set(prepared, { media: media.map(({ asset, body }) => ({ asset: assets.get(asset.id)!, body })), state: 'prepared' }); return prepared;
}

/** Write verified private chunks and publish a new document once; existing documents are never replaced. */
export async function commitMotionscaperAeImport(
	prepared: PreparedMotionscaperAeImport, acknowledgement: Readonly<{ acknowledgeUnsupported: boolean }>,
	begin: (project: MotionscaperProject) => PromiseLike<MotionArchiveImportTransaction> | MotionArchiveImportTransaction, signal?: AbortSignal,
): Promise<MotionscaperProject> {
	throwIfScapeAborted(signal);
	const retained = PREPARATIONS.get(prepared);
	if (!retained || retained.state !== 'prepared') throw new Error('AE import preparation is unknown, already publishing or closed.');
	if (acknowledgement.acknowledgeUnsupported !== true) throw new Error('Acknowledge the partial conversion report before importing this AE exchange.');
	retained.state = 'publishing'; let transaction: MotionArchiveImportTransaction | undefined;
	try {
		transaction = await begin(prepared.project); throwIfScapeAborted(signal);
		for (const { asset, body } of retained.media) {
			const digest = createScapeDigest(); let written = 0;
			for (let offset = 0; offset < body.size; offset += 4 * 1024 * 1024) {
				throwIfScapeAborted(signal);
				const bytes = new Uint8Array(await body.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer()); throwIfScapeAborted(signal);
				if (bytes.byteLength > asset.byteLength - written) throw new Error('AE retained media exceeds its declared byte length.');
				digest.update(bytes); written += bytes.byteLength; await transaction.writeAssetChunk(asset, bytes);
			}
			throwIfScapeAborted(signal);
			if (written !== asset.byteLength || scapeHex(digest.digest()) !== asset.sha256) throw new Error('AE retained media digest or byte length changed before publication.');
			await transaction.finishAsset(asset); throwIfScapeAborted(signal);
		}
		throwIfScapeAborted(signal); await transaction.commit(prepared.project);
		retained.state = 'committed'; return prepared.project;
	} catch (error) {
		if (transaction) try { await transaction.rollback(); } catch (cleanup) {
			retained.state = 'cleanup-failed'; throw aggregateScapeErrors(error, [cleanup], 'AE import failed and private media cleanup also failed.');
		}
		retained.state = 'prepared'; throw error;
	}
}

/** Portable review custody, including every captured unsupported property and inert expression. */
export function createMotionscaperAeImportCustody(prepared: PreparedMotionscaperAeImport): Blob {
	if (!PREPARATIONS.has(prepared)) throw new Error('Unknown AE import preparation.');
	return new Blob([JSON.stringify({ format: 'org.motionscaper.ae-import-custody', version: 1,
		destinationProjectId: prepared.project.id, sourceExchange: prepared.exchange, report: prepared.report })], { type: 'application/json' });
}
