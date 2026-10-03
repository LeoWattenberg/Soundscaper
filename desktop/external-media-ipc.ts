/* SPDX-License-Identifier: AGPL-3.0-only */

import { open } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { withScapeProjectInput } from '../src/common/editor/scape-project-input.ts';
import { normalizeExternalMedia } from '../src/common/editor/desktop-external-media.ts';
import type { ScapeArchiveEntry } from '../src/common/editor/scape-archive-envelope.ts';

interface ReadCapabilities {
	resolveHelperGrant(id: string, options: { owner: object }): Promise<{
		path: string; size: number; identity: { dev: number; ino: number };
	} | null>;
	registerSelectedRangePath(path: string, options: { owner: object }): Promise<unknown>;
}

interface ExternalMediaIpcOptions {
	readonly channels: { captureExternalMedia: string; resolveExternalMedia: string };
	readonly handle: (channel: string, handler: (event: unknown, value: unknown) => Promise<unknown>) => void;
	readonly ownerFor: (event: unknown) => object;
	readonly readCapabilities: ReadCapabilities;
	readonly acceptsFile: (purpose: string, path: string) => boolean;
}

/** References carry paths inside archive metadata, never independent renderer read authority. */
export function registerExternalMediaIpc(options: ExternalMediaIpcOptions): void {
	const { readCapabilities, ownerFor, channels, handle, acceptsFile } = options;
	handle(channels.captureExternalMedia, async (event, value) => {
		const grant = await readCapabilities.resolveHelperGrant(readId(value), { owner: ownerFor(event) });
		if (!grant || !acceptsFile('media', grant.path)) return null;
		return Buffer.from(JSON.stringify({ version: 1, path: grant.path })).toString('base64');
	});
	handle(channels.resolveExternalMedia, async (event, value) => {
		if (!record(value) || typeof value.sourceId !== 'string' || !value.sourceId || value.sourceId.length > 256) {
			throw new TypeError('An external media source request is required.');
		}
		const owner = ownerFor(event);
		const grant = await readCapabilities.resolveHelperGrant(readId(value.projectReadId), { owner });
		if (!grant || !['.sscape', '.fscape', '.scape', '.liscape'].includes(extname(grant.path).toLowerCase())) {
			throw new Error('External media resolution requires a selected desktop project file.');
		}
		const file = await open(grant.path, 'r');
		try {
			const stat = await file.stat();
			if (stat.dev !== grant.identity.dev || stat.ino !== grant.identity.ino || stat.size !== grant.size) {
				throw new Error('The selected project file changed before its references were read.');
			}
			const archive = createScapeArchiveByteSource({ size: stat.size, read: async ({ offset, length }) => {
				const bytes = new Uint8Array(length);
				let received = 0;
				while (received < length) {
					const result = await file.read(bytes, received, length - received, offset + received);
					if (!result.bytesRead) throw new Error('The selected project file was truncated.');
					received += result.bytesRead;
				}
				return bytes;
			} });
			// Read the reference from the actual user-selected file. A forged token
			// or source document supplied by the renderer cannot grant another path.
			const path = await withScapeProjectInput(archive, undefined, async (entries) => {
				const manifest = JSON.parse(await readText(entries, 'manifest.json', 32 * 1024 * 1024)) as unknown;
				const projectText = await readText(entries, 'project.json', 256 * 1024 * 1024);
				if (!record(manifest) || manifest.format !== 'scape-project' || manifest.formatVersion !== 1
					|| !record(manifest.project) || manifest.project.entry !== 'project.json'
					|| manifest.project.sha256 !== sha256(projectText) || !Array.isArray(manifest.assets)) {
					throw new Error('The selected project manifest failed verification.');
				}
				const project = JSON.parse(projectText) as unknown;
				const sources: unknown[] = record(project) && Array.isArray(project.sources) ? project.sources as unknown[] : [];
				const source = sources.find((source) => record(source) && source.id === value.sourceId);
				if (!record(source) || !record(source.opaqueExtensions)) throw new Error('The external source is not in the selected project.');
				const reference = normalizeExternalMedia(source.opaqueExtensions.desktopExternalMedia);
				const asset = (manifest.assets as unknown[]).find((asset) => record(asset) && asset.sourceId === value.sourceId);
				if (!record(asset) || asset.encoding !== 'external-file-v1' || typeof asset.entry !== 'string') {
					throw new Error('The source is not an external media asset.');
				}
				const referenceText = await readText(entries, asset.entry, 64 * 1024);
				if (sha256(referenceText) !== asset.sha256
					|| JSON.stringify(normalizeExternalMedia(JSON.parse(referenceText) as unknown)) !== JSON.stringify(reference)) {
					throw new Error('The external media asset failed verification.');
				}
				const decoded = JSON.parse(Buffer.from(reference.reference, 'base64').toString('utf8')) as unknown;
				if (!record(decoded) || decoded.version !== 1 || typeof decoded.path !== 'string'
					|| !isAbsolute(decoded.path) || !acceptsFile('media', decoded.path)) {
					throw new TypeError('The referenced external media path is invalid.');
				}
				return decoded.path;
			});
			try { return await readCapabilities.registerSelectedRangePath(path, { owner }); }
			catch (error) { throw new Error(`External media ${basename(path)} is unavailable. Restore the original file.`, { cause: error }); }
		} finally { await file.close(); }
	});
}

async function readText(entries: readonly ScapeArchiveEntry[], name: string, maximum: number): Promise<string> {
	const entry = entries.find((entry) => entry.filename === name);
	if (!entry?.getData || entry.directory || entry.uncompressedSize > maximum) {
		throw new Error(`The project metadata ${name} is unavailable or too large.`);
	}
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const parts: string[] = [];
	let received = 0;
	await entry.getData(new WritableStream<Uint8Array>({ write(bytes) {
		received += bytes.byteLength;
		if (received > maximum) throw new RangeError('Project metadata exceeded its bound.');
		parts.push(decoder.decode(bytes, { stream: true }));
	} }), { strictness: 'strict' });
	if (received !== entry.uncompressedSize) throw new Error('Project metadata length is inconsistent.');
	parts.push(decoder.decode());
	return parts.join('');
}

function readId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('A desktop read capability is required.');
	return value;
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
