/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectStorageKeys, compactProjectSourceMetadata } from '../common/editor/retention.js';
import { deleteByIndex, request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { trustedMediaContentSha256 } from '../common/editor/storage/media-content-provenance.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import { publishSource, type StorageRecord } from '../common/editor/storage/media-records.ts';
import { applyMemoryMutations, asRecord, createProjectCreationFence, deleteMemoryMutation,
	memoryHasProjectRevision, revisionKey, setMemoryMutation, storedCreationFence, storedProjectId } from '../common/editor/storage/project-repository-support.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts';
import type { StorageRepositories } from '../common/editor/storage/repositories.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { framescaperImageSourceResourceReferencesCurrentV1 } from '../common/editor/timeline-image-model-current-v1.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from './timeline-image-mask-raster-source-v1.ts';
import { createFramescaperCubeLutSourceFinishing } from './cube-lut-source-finishing.ts';
import { validateFramescaperImageAssetBodyTimelineImage } from './editor-scape-asset-plan-timeline-image.ts';
import type { FramescaperProject } from './editor-project.ts';
import { prepareFramescaperTimelineImageResourceAuditV1 } from './internal/timeline-image-resource-audit-v1.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../common/editor/video-cube-lut-project-references-current-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from '../common/editor/timeline-image-pack-source-current-v1.ts';

interface BodyPin { readonly key: string; readonly identity: Readonly<Record<string, unknown>> }
export interface FramescaperScapeImagePublicationDependencies {
	readonly port: StorageRepositoryPort;
	readonly media: StorageRepositories['media'];
	readonly retention: StorageRepositories['retention'];
}

/** Current Scape owns authenticated image creation separately from ordinary
 * save and the unchanged V1 single-image publisher. Immutable native bodies
 * are read sequentially, then their trusted content/storage tokens are checked
 * again in the transaction that creates the project and publishes pending roots.
 * Only the returned object owns its creation fence; scalar copies grant none. */
export class FramescaperScapeImageProjectPublication {
	readonly #dependencies: FramescaperScapeImagePublicationDependencies;
	readonly #created = new WeakMap<object, Readonly<{ project: ProjectDocument; fence: string }>>();

	constructor(dependencies: FramescaperScapeImagePublicationDependencies) { this.#dependencies = dependencies; }
	owns(value: object): boolean { return this.#created.has(value); }

	async prepareSave(project: FramescaperProject): Promise<void> {
		if (!project.sources.some(source => source.kind === 'image' && (source.schemaVersion === 3 || source.schemaVersion === 4 || source.schemaVersion === 5))) return;
		await this.#dependencies.retention.ensureSession();
		await prepareFramescaperTimelineImageResourceAuditV1(this.#dependencies, project);
	}

	async create(project: FramescaperProject): Promise<ProjectDocument | null> {
		const { port, media, retention } = this.#dependencies;
		collectFramescaperImageProjectResourcesCurrentV1(project);
		await retention.ensureSession();
		const pins = new Map<string, BodyPin>();
		const bodyStore = { loadMediaAsset: media.loadAsset.bind(media) };
		const lutSource = createFramescaperCubeLutSourceFinishing(bodyStore), maskSource = createFramescaperMaskRasterSourceTimelineImageV1(bodyStore), failures: unknown[] = [];
		try {
			for (const source of project.sources) {
				if (source.kind !== 'image') continue;
				const pin = await this.#pin(source.storageKey, source.assetByteLength, source.contentSha256);
				const row = pin.identity;
				if (row.kind !== 'timeline-image' || row.encoding !== 'framescaper-image-asset-v1' || row.mimeType !== source.mimeType) {
					throw new Error('The Scape image body conflicts with its immutable image authority.');
				}
				pins.set(pin.key, pin);
				const body = await media.loadAsset(source.storageKey, { expectedSize: source.assetByteLength });
				const packed = framescaperImagePackSourceCurrentV1(source);
				if (source.schemaVersion === 4 || source.schemaVersion === 5) await (await import('../common/editor/timeline-image-native-body-current-v1.ts')).validateFramescaperNativeImageBodyCurrentV1(source, body);
				await validateFramescaperImageAssetBodyTimelineImage(packed, body);
				const resources = framescaperImageSourceResourceReferencesCurrentV1(source);
				for (const reference of resources.luts) {
					const lutPin = await this.#pin(reference.storageKey, reference.byteLength, reference.sha256);
					await lutSource.withBytes(reference, () => undefined);
					const previous = pins.get(lutPin.key);
					if (previous && !sameProjectSnapshot(previous.identity, lutPin.identity)) throw new Error('The staged image body changed between recipe owners.');
					pins.set(lutPin.key, lutPin);
				}
				for (const reference of resources.brushes) {
					const maskPin = await this.#pin(reference.storageKey, reference.byteLength, reference.sha256);
					await maskSource.withBytes(reference, () => undefined);
					const previous = pins.get(maskPin.key);
					if (previous && !sameProjectSnapshot(previous.identity, maskPin.identity)) throw new Error('The staged brush body changed between source owners.');
					pins.set(maskPin.key, maskPin);
				}
			}
		} catch (error) { failures.push(error); }
		for (const result of await Promise.allSettled([lutSource.close(), maskSource.close()])) if (result.status === 'rejected' && !failures.some(error => Object.is(error, result.reason))) failures.push(result.reason);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Frame resource authentication and source retirement failed.', { cause: failures[0] });
		const snapshot = compactProjectSourceMetadata(structuredClone(project)) as ProjectDocument;
		const fence = createProjectCreationFence(), key = revisionKey(snapshot.id, Number(snapshot.revision));
		const revision = { key, projectId: snapshot.id, revision: snapshot.revision, project: snapshot, creationFence: fence };
		const roots = new Set<string>(collectProjectStorageKeys(snapshot));
		for (const pin of pins.values()) roots.add(pin.key);
		const database = await port.database();
		let created: boolean;
		if (!database) {
			const memory = port.memory;
			if (memory.projects.has(snapshot.id) || memoryHasProjectRevision(memory.revisions, snapshot.id)) return null;
			for (const pin of pins.values()) assertPin(memory.mediaAssets.get(pin.key), pin);
			const mutations = [setMemoryMutation(memory.projects, snapshot.id, snapshot), setMemoryMutation(memory.revisions, key, revision)];
			for (const root of roots) for (const rows of [memory.sources, memory.mediaAssets]) {
				const row = asRecord(rows.get(root));
				if (row?.pendingProjectUntil) mutations.push(setMemoryMutation(rows, root, publishSource(row)));
			}
			applyMemoryMutations(mutations); created = true;
		} else created = await transact(database, ['projects', 'revisions', 'sources', 'mediaAssets'], 'readwrite', async stores => {
			const [current, count] = await Promise.all([request(stores.projects!.get(snapshot.id)), request(stores.revisions!.index('projectId').count(snapshot.id))]);
			if (current !== undefined || count !== 0) return false;
			for (const pin of pins.values()) assertPin(await request(stores.mediaAssets!.get(pin.key)), pin);
			await Promise.all([request(stores.projects!.put(snapshot)), request(stores.revisions!.put(revision))]);
			for (const root of roots) for (const rows of [stores.sources!, stores.mediaAssets!]) {
				const row = asRecord(await request(rows.get(root)));
				if (row?.pendingProjectUntil) await request(rows.put(publishSource(row)));
			}
			return true;
		});
		if (!created) return null;
		const result = structuredClone(snapshot); this.#created.set(result, { project: snapshot, fence }); return result;
	}

	async deleteIfCurrent(value: object): Promise<boolean> {
		const owned = this.#created.get(value); if (!owned) return false;
		const { port, retention } = this.#dependencies;
		const result = await retention.withSoleSession(async () => {
			const key = revisionKey(owned.project.id, Number(owned.project.revision)), database = await port.database();
			if (!database) {
				const memory = port.memory;
				if (!sameProjectSnapshot(memory.projects.get(owned.project.id), owned.project)
					|| storedCreationFence(memory.revisions.get(key)) !== owned.fence) return false;
				const mutations = [deleteMemoryMutation(memory.projects, owned.project.id)];
				for (const [revision, row] of memory.revisions) if (storedProjectId(row) === owned.project.id) mutations.push(deleteMemoryMutation(memory.revisions, revision));
				applyMemoryMutations(mutations); return true;
			}
			return transact(database, ['projects', 'revisions'], 'readwrite', async ({ projects, revisions }) => {
				const [current, row] = await Promise.all([request(projects!.get(owned.project.id)), request(revisions!.get(key))]);
				if (!sameProjectSnapshot(current, owned.project) || storedCreationFence(row) !== owned.fence) return false;
				await Promise.all([request(projects!.delete(owned.project.id)), deleteByIndex(revisions!.index('projectId'), owned.project.id)]); return true;
			});
		});
		if (!result.admitted) throw new Error('Another editor session still owns local project history.');
		if (result.value) this.#created.delete(value); return result.value;
	}

	async #pin(key: string, size: number, digest: string): Promise<BodyPin> {
		const { port } = this.#dependencies, database = await port.database();
		const row = asRecord(database ? await transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets!.get(key))) : port.memory.mediaAssets.get(key));
		if (!row) throw new Error('The Scape image body is missing before atomic publication.');
		if (row.sourceId !== key || row.size !== size || trustedMediaContentSha256(row as StorageRecord) !== digest) throw new Error('The Scape image body conflicts with immutable size or digest authority.');
		return { key, identity: rowIdentity(row) };
	}
}

function rowIdentity(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
	const { blob, ...identity } = value;
	return { ...identity, ...(blob === undefined ? {} : { blob: { size: canonicalMediaContentBlob(blob).size, type: canonicalMediaContentBlob(blob).type } }) };
}
function assertPin(value: unknown, pin: BodyPin): void {
	const row = asRecord(value);
	if (!row || !sameProjectSnapshot(rowIdentity(row), pin.identity)) throw new Error('The staged image body changed before atomic publication.');
}
