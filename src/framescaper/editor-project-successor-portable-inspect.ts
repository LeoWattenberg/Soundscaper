/* SPDX-License-Identifier: AGPL-3.0-only */
import { withScapeProjectInput, type ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { isDesktopScapeArchiveByteSource } from '../common/editor/desktop-scape-archive-byte-source.ts';
import { readScapeArchiveEnvelope, type ScapeArchiveEnvelope } from '../common/editor/scape-archive-envelope.ts';
import { createScapeDigest, scapeHex, verifyScapeAssetBytes } from '../common/editor/scape-archive-media.ts';
import { indexScapeProjectAssets, indexScapeProjectTimingAssets } from '../common/editor/scape-project-assets.ts';
import { framescaperSuccessorPortableAssets } from './editor-project-successor-portable-assets.ts';
import { createFramescaperLinkedAssetDescriptor, MOTION_LINKED_ARCHIVE_ASSET_KIND } from './editor-project-successor-link-assets.ts';
import { createFramescaperScapeProjectAssetExtension } from './editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';

/** Authenticate current intent and exact asset ownership before asking any repository to publish. */
export function admitFramescaperSuccessorPortableEnvelope(envelope: ScapeArchiveEnvelope) {
	verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'successor project');
	if (envelope.manifest.project.schemaFamily !== 'framescaper' || envelope.manifest.project.schemaVersion !== 2) throw new RangeError('Portable successor archive requires Framescaper schema2.');
	const closure = framescaperSuccessorPortableAssets(JSON.parse(envelope.projectText) as unknown);
	const extensionValidation = closure.extension.validateImportAssets(closure.baseline, envelope.manifest);
	const ordinaryTiming = new Set(closure.ordinary.sources.flatMap(source => source.kind === 'video' && source.timingAsset ? [String(Reflect.get(source.timingAsset as object, 'storageKey'))] : []));
	const ordinaryManifest = { ...envelope.manifest, assets: envelope.manifest.assets.filter(asset => asset.kind !== MOTION_LINKED_ARCHIVE_ASSET_KIND && (asset.kind !== 'video-timing' || ordinaryTiming.has(asset.sourceId))) };
	const ordinaryAssets = indexScapeProjectAssets(closure.ordinary, ordinaryManifest, { currentProjectSchemaFamily: 'framescaper', currentProjectSchemaVersion: 1, additionalSourceKinds: closure.extension.sourceKinds });
	const timing = indexScapeProjectTimingAssets(closure.baseline, envelope.manifest);
	for (const [key, asset] of closure.timing) {
		const descriptor = timing.get(key); if (!descriptor || descriptor.sha256 !== asset.expectedSha256 || descriptor.size !== asset.size || descriptor.encoding !== asset.encoding) throw new RangeError('Virtual timing differs from the accepted composition.');
	}
	const linked = envelope.manifest.assets.filter(asset => asset.kind === MOTION_LINKED_ARCHIVE_ASSET_KIND);
	if (linked.length !== closure.linked.length) throw new RangeError('Successor linked inventory is incomplete or includes unowned originals.');
	for (const asset of closure.linked) {
		const expected = createFramescaperLinkedAssetDescriptor(asset); const actual = linked.find(value => value.sourceId === expected.sourceId);
		if (!actual || Object.keys(actual).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => actual[key] !== value)) throw new RangeError('Successor linked descriptor differs from its retained snapshot.');
	}
	if (envelope.manifest.assets.some(asset => asset.encoding === 'external-file-v1')) throw new RangeError('Successor portable archive requires complete original media bytes.');
	return { ...closure, extensionValidation, ordinaryAssets, ordinaryManifest };
}

/** Bounded digest checks cover unused originals too. Callers may reuse the admitted inventory inside this reader lifetime. */
export async function withFramescaperSuccessorPortableArchive<T>(input: ScapeProjectInput, signal: AbortSignal | undefined, action: (envelope: ScapeArchiveEnvelope, closure: ReturnType<typeof admitFramescaperSuccessorPortableEnvelope>) => Promise<T>): Promise<T> {
	const extension = createFramescaperScapeProjectAssetExtension(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	return withScapeProjectInput(input, signal, async entries => {
		const envelope = await readScapeArchiveEnvelope(entries, {}, signal, [...extension.assetKinds, MOTION_LINKED_ARCHIVE_ASSET_KIND], isDesktopScapeArchiveByteSource(input));
		const closure = admitFramescaperSuccessorPortableEnvelope(envelope);
		for (const asset of envelope.manifest.assets) {
			signal?.throwIfAborted(); const entry = envelope.entryByName.get(asset.entry)!; if (!entry.getData) throw new RangeError('Successor archive entry is unreadable.');
			const digest = createScapeDigest(); let size = 0;
			await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
				signal?.throwIfAborted(); if (!(chunk instanceof Uint8Array) || chunk.length > asset.size - size) throw new RangeError('Successor archive body exceeds its admitted length.');
				size += chunk.length; digest.update(chunk);
			} }), { signal, strictness: 'strict' });
			if (size !== asset.size || scapeHex(digest.digest()) !== asset.sha256) throw new RangeError('Successor archive body digest or length changed.');
		}
		signal?.throwIfAborted(); return action(envelope, closure);
	});
}
export async function inspectFramescaperSuccessorPortableArchive(input: ScapeProjectInput, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return withFramescaperSuccessorPortableArchive(input, options.signal, async (envelope, closure) => ({ project: closure.project, manifest: envelope.manifest, readOnly: false as const, reason: null, collision: null }));
}
