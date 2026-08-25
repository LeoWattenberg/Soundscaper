/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../common/editor/scape-archive-envelope.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from '../common/editor/storage/media-content-digest.ts';
import type { OwnedMediaAssetPublication } from '../common/editor/storage/media-asset-write-contract.ts';
import {
	FRAMESCAPER_DESKTOP_V12_MAXIMUM_BODY_CHUNK_BYTES,
	type FramescaperDesktopV12BodyStore,
} from './desktop-project-library-v12-body-transfer.ts';
import {
	acquireFramescaperDesktopV28Bodies,
	prepareFramescaperDesktopV28PublicationBodies,
	uploadFramescaperDesktopV28PublicationBodies,
	type FramescaperDesktopV28PreparedBody,
} from './desktop-project-library-v28-body-transfer.ts';
import {
	collectFramescaperDesktopV31AssistanceBodyReferences,
	FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND,
	validateFramescaperDesktopV31Bodies,
	type FramescaperDesktopV31AssistanceBodyDescriptor,
	type FramescaperDesktopV31BodyDescriptor,
} from './desktop-project-library-v31-body-contract.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import type { FramescaperProjectV31 } from './editor-project-v31.ts';

export type { FramescaperDesktopV31BodyDescriptor } from './desktop-project-library-v31-body-contract.ts';
export { validateFramescaperDesktopV31Bodies } from './desktop-project-library-v31-body-contract.ts';

export interface FramescaperDesktopV31PreparedBody {
	readonly descriptor: Readonly<FramescaperDesktopV31BodyDescriptor>;
	readonly blob: Blob;
	readonly metadataIdentity: string;
}

export interface FramescaperDesktopV31BodyBridge {
	readBodyChunk(request: Readonly<{
		body: Readonly<FramescaperDesktopV31BodyDescriptor>;
		offset: number;
		length: number;
	}>): Promise<unknown>;
	writePublicationChunk(request: Readonly<{
		publicationId: string;
		bodyIndex: number;
		offset: number;
		bytes: Uint8Array;
	}>): Promise<unknown>;
}

interface TrustedMetadata {
	readonly sourceId: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sha256: string;
	readonly kind: string | null;
	readonly encoding: string | null;
}

export async function prepareFramescaperDesktopV31PublicationBodies(
	project: FramescaperProjectV31,
	projectSha256: string,
	store: FramescaperDesktopV12BodyStore,
	signal?: AbortSignal,
): Promise<readonly Readonly<FramescaperDesktopV31PreparedBody>[]> {
	const base = await prepareFramescaperDesktopV28PublicationBodies(
		framescaperProjectV28FoundationShapeV31(project), projectSha256, store, signal,
	);
	const assistance: FramescaperDesktopV31PreparedBody[] = [];
	for (const reference of collectFramescaperDesktopV31AssistanceBodyReferences(project)) {
		throwIfScapeAborted(signal);
		const metadata = transcriptMetadata(reference.descriptor,
			await store.getMediaAssetMetadata(reference.descriptor.storageKey));
		const blob = await verifiedBlob(store, reference.descriptor, metadata, signal);
		const current = transcriptMetadata(reference.descriptor,
			await store.getMediaAssetMetadata(reference.descriptor.storageKey));
		if (metadataIdentity(current) !== metadataIdentity(metadata)) {
			throw new Error('Managed F31 transcript metadata changed during preflight.');
		}
		assistance.push(Object.freeze({
			descriptor: reference.descriptor,
			blob,
			metadataIdentity: metadataIdentity(metadata),
		}));
	}
	const prepared: readonly Readonly<FramescaperDesktopV31PreparedBody>[] = Object.freeze([
		...base as readonly Readonly<FramescaperDesktopV28PreparedBody>[], ...assistance,
	]);
	validateFramescaperDesktopV31Bodies(project, projectSha256,
		prepared.map(({ descriptor }) => descriptor));
	assertAggregateBytes(prepared.map(({ descriptor }) => descriptor));
	return prepared;
}

export async function uploadFramescaperDesktopV31PublicationBodies(
	publicationId: string,
	prepared: readonly Readonly<FramescaperDesktopV31PreparedBody>[],
	bridge: Pick<FramescaperDesktopV31BodyBridge, 'writePublicationChunk'>,
	store: Pick<FramescaperDesktopV12BodyStore, 'getMediaAssetMetadata'>,
	signal?: AbortSignal,
): Promise<void> {
	await uploadFramescaperDesktopV28PublicationBodies(
		publicationId,
		prepared as unknown as readonly Readonly<FramescaperDesktopV28PreparedBody>[],
		bridge,
		store,
		signal,
	);
}

export async function acquireFramescaperDesktopV31Bodies(
	project: FramescaperProjectV31,
	projectSha256: string,
	bodiesValue: unknown,
	bridge: Pick<FramescaperDesktopV31BodyBridge, 'readBodyChunk'>,
	store: FramescaperDesktopV12BodyStore,
	signal?: AbortSignal,
): Promise<void> {
	const bodies = validateFramescaperDesktopV31Bodies(project, projectSha256, bodiesValue);
	assertAggregateBytes(bodies);
	const transcriptBodies = bodies.filter((body): body is FramescaperDesktopV31AssistanceBodyDescriptor => (
		body.kind === FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND
	));
	const publications = await acquireTranscriptBodies(transcriptBodies, bridge, store, signal);
	try {
		await acquireFramescaperDesktopV28Bodies(
			framescaperProjectV28FoundationShapeV31(project),
			projectSha256,
			bodies.filter(({ kind }) => kind !== FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND),
			bridge,
			store,
			signal,
		);
	} catch (error) {
		const cleanup: unknown[] = [];
		for (const publication of publications.reverse()) {
			try { await publication.discardIfCurrent(); } catch (cause) { cleanup.push(cause); }
		}
		if (cleanup.length) {
			throw new AggregateError([error, ...cleanup], 'F31 body acquisition rollback failed.', {
				cause: error,
			});
		}
		throw error;
	}
}
async function acquireTranscriptBodies(
	bodies: readonly Readonly<FramescaperDesktopV31AssistanceBodyDescriptor>[],
	bridge: Pick<FramescaperDesktopV31BodyBridge, 'readBodyChunk'>,
	store: FramescaperDesktopV12BodyStore,
	signal?: AbortSignal,
): Promise<OwnedMediaAssetPublication[]> {
	const missing = new Set<string>();
	for (const body of bodies) {
		const metadataValue = await store.getMediaAssetMetadata(body.storageKey);
		if (metadataValue == null) { missing.add(body.storageKey); continue; }
		await verifiedBlob(store, body, transcriptMetadata(body, metadataValue), signal);
	}
	const publications: OwnedMediaAssetPublication[] = [];
	let writer: Awaited<ReturnType<FramescaperDesktopV12BodyStore['beginMediaAssetWrite']>> | null = null;
	try {
		for (const body of bodies) {
			throwIfScapeAborted(signal);
			writer = missing.has(body.storageKey) ? await store.beginMediaAssetWrite(
				body.storageKey,
				{
					kind: FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND,
					encoding: body.encoding,
					mimeType: body.mimeType,
					name: body.storageKey,
				},
				{ expectedBytes: body.byteLength, expectedSha256: body.sha256, signal },
			) : null;
			const digest = sha256.create();
			for (let offset = 0; offset < body.byteLength;) {
				throwIfScapeAborted(signal);
				const length = Math.min(
					FRAMESCAPER_DESKTOP_V12_MAXIMUM_BODY_CHUNK_BYTES, body.byteLength - offset,
				);
				const value = await bridge.readBodyChunk({ body, offset, length });
				if (!(value instanceof Uint8Array) || value.byteLength !== length) {
					throw new Error('Framescaper desktop F31 transcript read returned an inexact chunk.');
				}
				const bytes = value.slice();
				digest.update(bytes);
				if (writer) await writer.write(bytes, { signal });
				offset += length;
			}
			if (bytesToHex(digest.digest()) !== body.sha256) {
				throw new Error('Framescaper desktop F31 transcript failed its SHA-256 binding.');
			}
			if (writer) {
				const publication = await writer.commitOwned({ signal });
				assertPublication(publication, body);
				publications.push(publication);
				writer = null;
			}
		}
		return publications;
	} catch (error) {
		const cleanup: unknown[] = [];
		if (writer) try { await writer.abort(); } catch (cause) { cleanup.push(cause); }
		for (const publication of publications.reverse()) {
			try { await publication.discardIfCurrent(); } catch (cause) { cleanup.push(cause); }
		}
		if (cleanup.length) throw new AggregateError([error, ...cleanup], 'F31 transcript rollback failed.');
		throw error;
	}
}

async function verifiedBlob(
	store: Pick<FramescaperDesktopV12BodyStore, 'loadMediaAsset'>,
	descriptor: Readonly<FramescaperDesktopV31AssistanceBodyDescriptor>,
	metadata: TrustedMetadata,
	signal?: AbortSignal,
): Promise<Blob> {
	throwIfScapeAborted(signal);
	const blob = canonicalMediaContentBlob(await store.loadMediaAsset(descriptor.storageKey, { signal }));
	if (blob.size !== metadata.size || await digestMediaContent(blob, { signal }) !== metadata.sha256) {
		throw new Error('Managed F31 transcript body failed immutable verification.');
	}
	return blob;
}

function transcriptMetadata(
	descriptor: Readonly<FramescaperDesktopV31AssistanceBodyDescriptor>,
	value: unknown,
): TrustedMetadata {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Managed F31 transcript metadata is missing.');
	}
	const row = value as Record<string, unknown>;
	const metadata = Object.freeze({
		sourceId: String(row.sourceId ?? ''), mimeType: String(row.mimeType ?? ''),
		size: Number(row.size), sha256: String(row.sha256 ?? ''),
		kind: typeof row.kind === 'string' && row.kind ? row.kind : null,
		encoding: typeof row.encoding === 'string' && row.encoding ? row.encoding : null,
	});
	if (metadata.sourceId !== descriptor.storageKey || metadata.mimeType !== descriptor.mimeType
		|| metadata.size !== descriptor.byteLength || metadata.sha256 !== descriptor.sha256
		|| (metadata.kind !== null && metadata.kind !== FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND)
		|| (metadata.encoding !== null && metadata.encoding !== descriptor.encoding)) {
		throw new Error('Managed F31 transcript metadata conflicts with its project binding.');
	}
	return metadata;
}

function assertPublication(
	publication: OwnedMediaAssetPublication,
	body: Readonly<FramescaperDesktopV31AssistanceBodyDescriptor>,
): void {
	if (!publication || typeof publication.discardIfCurrent !== 'function'
		|| publication.metadata.sourceId !== body.storageKey
		|| publication.metadata.mimeType !== body.mimeType
		|| publication.metadata.size !== body.byteLength
		|| publication.metadata.sha256 !== body.sha256) {
		throw new Error('Managed F31 transcript publication changed its descriptor.');
	}
}

function metadataIdentity(value: TrustedMetadata): string { return JSON.stringify(value); }

function assertAggregateBytes(bodies: readonly Readonly<{ byteLength: number }>[]): void {
	let total = 0;
	for (const { byteLength } of bodies) {
		if (byteLength > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes - total) {
			throw new RangeError('Framescaper desktop F31 bodies exceed their aggregate byte limit.');
		}
		total += byteLength;
	}
}
