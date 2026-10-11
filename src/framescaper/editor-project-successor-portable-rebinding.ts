/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { canonicalJsonSha256 } from '../common/canonical-json-sha256.ts';
import { createProjectCopyDocument } from '../common/editor/storage/project-copy-document.ts';
import { motionArray, motionId, motionRecord } from '../common/editor/motion-values.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { remapScapeProjectSourceReferences } from '../common/editor/scape-project-source-remap.ts';
import { rebindFramescaperSourceIdentities } from './editor-project-source-rebind.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { scapeAudioSourceStream, type ScapeAudioSource } from '../common/editor/scape-archive-media.ts';
import { ScapeAudioChunkBudget } from '../common/editor/scape-expanded-byte-budget.ts';
import type { admitFramescaperSuccessorPortableEnvelope } from './editor-project-successor-portable-inspect.ts';

type Closure = ReturnType<typeof admitFramescaperSuccessorPortableEnvelope>;
export interface FramescaperSuccessorPortableBinding {
	readonly copy: Readonly<{ id: string; timestamp: string }> | null;
	readonly storageSourceIds: readonly string[];
}
/** Rebinding changes local custody identities only; Motion identities and authored source references remain intact. */
export function bindFramescaperSuccessorPortableProject(closure: Closure, value: unknown) {
	const record = motionRecord(value, ['copy', 'storageSourceIds'], 'portable import binding');
	let copy: FramescaperSuccessorPortableBinding['copy'] = null;
	if (record.copy !== null) {
		const item = motionRecord(record.copy, ['id', 'timestamp'], 'portable copy identity');
		const id = motionId(item.id); const timestamp = item.timestamp;
		if (id === closure.project.id || typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) throw new RangeError('Portable copy requires a fresh identity and canonical timestamp.');
		copy = { id, timestamp };
	}
	const storageSourceIds = motionArray(record.storageSourceIds, 16384, 'portable storage bindings').map(value => motionId(value));
	if (new Set(storageSourceIds).size !== storageSourceIds.length) throw new RangeError('Portable storage bindings are duplicated.');
	const keys = new Map<string, string>();
	for (const id of storageSourceIds) {
		const source = closure.ordinary.sources.find(source => source.id === id);
		const asset = closure.ordinaryManifest.assets.find(asset => asset.sourceId === (source?.kind === 'image' ? `framescaper:image:${id}` : id));
		if (!source || !asset || !['audio', 'video', 'image'].includes(source.kind)) throw new RangeError('Portable storage binding requires an ordinary owned media body.');
		const geometry = source.kind === 'audio' ? [source.sampleRate, source.channelCount, source.frameCount, source.chunkFrames] : null;
		keys.set(id, `successor-import:${canonicalJsonSha256({ id, kind: source.kind, sha256: asset.sha256, geometry })}`);
	}
	const selected = copy ? createProjectCopyDocument(closure.project, copy) : closure.project;
	const base = { ...structuredClone(selected), sources: closure.project.sources.map(source => keys.has(source.id) && source.kind !== 'image' ? { ...structuredClone(source), id: keys.get(source.id)!, storageKey: keys.get(source.id)! } : structuredClone(source)) };
	rebindFramescaperSourceIdentities(base, keys); remapScapeProjectSourceReferences(base, keys);
	const project = normalizeFramescaperSuccessorProject(base);
	return { project, binding: { copy, storageSourceIds } satisfies FramescaperSuccessorPortableBinding };
}

/** Existing content is never overwritten, including when another owner uses the same source key. */
export async function planFramescaperSuccessorPortableStorageBindings(closure: Closure, media: AudioEditorProjectStore, signal?: AbortSignal): Promise<readonly string[]> {
	const ids: string[] = [];
	for (const source of closure.ordinary.sources) {
		signal?.throwIfAborted();
		const asset = closure.ordinaryManifest.assets.find(asset => asset.sourceId === (source.kind === 'image' ? `framescaper:image:${source.id}` : source.id));
		if (!asset) continue;
		if (source.kind === 'audio') {
			const existing = await media.getSourceMetadata(String(source.storageKey));
			if (!existing) continue;
			if (['sampleRate', 'channelCount', 'frameCount', 'chunkFrames'].some(key => existing[key] !== source[key])) { ids.push(source.id); continue; }
			const digest = sha256.create(); let size = 0;
			try {
				await scapeAudioSourceStream(media, source as unknown as ScapeAudioSource, digest, count => { size += count; }, signal, new ScapeAudioChunkBudget()).pipeTo(new WritableStream({ write() {} }), { signal });
				if (size !== asset.size || bytesToHex(digest.digest()) !== asset.sha256) ids.push(source.id);
			} catch { signal?.throwIfAborted(); ids.push(source.id); }
		}
		else if (source.kind === 'video' || source.kind === 'image') {
			const existing = await media.getMediaAssetMetadata(String(source.storageKey));
			if (existing && (existing.sha256 !== asset.sha256 || existing.size !== asset.size)) ids.push(source.id);
		}
	}
	return ids;
}
