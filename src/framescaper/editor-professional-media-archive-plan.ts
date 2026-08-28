/* SPDX-License-Identifier: AGPL-3.0-only */

import { nativeMediaImageSequenceArchiveRootsV25 } from '../common/editor/native-media-image-sequence-v25.ts';
import { planScapeVideoProxyArchiveAssets } from '../common/editor/scape-video-proxy-archive-plan.ts';
export type FramescaperProfessionalMediaArchiveAsset = Readonly<{
	readonly sourceId: string;
	readonly kind: 'image-sequence-inventory' | 'image-sequence-source-pack' | 'video-proxy' | 'video-timing';
	readonly encoding: string;
	readonly entry: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sha256: string;
}>;

/** Baseline custody metadata for sequence inventory/pack and inherited proxy roots. */
export function createFramescaperProfessionalMediaArchivePlan(
	project: unknown,
): Readonly<{
	readonly formatVersion: 1;
	readonly assets: readonly FramescaperProfessionalMediaArchiveAsset[];
}> {
	const candidate = record(project, 'Framescaper project');
	const assets: FramescaperProfessionalMediaArchiveAsset[] = [];
	const byId = new Map<string, FramescaperProfessionalMediaArchiveAsset>();
	const attachments: unknown[] = [];
	for (const source of records(candidate.sources, 'sources')) {
		if (source.kind !== 'video') continue;
		if (source.imageSequence !== null) {
			const sequence = record(source.imageSequence, 'Framescaper image-sequence source');
			const [inventoryRoot, packRoot] = nativeMediaImageSequenceArchiveRootsV25(sequence);
			const inventory = record(sequence.inventory, 'image-sequence inventory');
			const pack = record(sequence.sourcePack, 'image-sequence source pack');
			addAsset(byId, assets, Object.freeze({
				sourceId: inventoryRoot!, kind: 'image-sequence-inventory',
				encoding: 'framescaper-image-sequence-inventory-v1',
				entry: `image-sequence/${String(inventory.sha256)}/inventory.json`,
				mimeType: 'application/json', size: Number(inventory.byteLength),
				sha256: String(inventory.sha256),
			}));
			addAsset(byId, assets, Object.freeze({
				sourceId: packRoot!, kind: 'image-sequence-source-pack',
				encoding: 'framescaper-image-sequence-source-pack-v1',
				entry: `image-sequence/${String(pack.sha256)}/source-pack`,
				mimeType: 'application/vnd.soundscaper.image-sequence-pack',
				size: Number(pack.byteLength), sha256: String(pack.sha256),
			}));
		}
		const attachment = source.proxyAttachment;
		attachments.push(attachment === null ? null : {
			storageKey: record(attachment, 'video proxy attachment').storageKey,
			mimeType: record(attachment, 'video proxy attachment').mimeType,
			byteLength: record(attachment, 'video proxy attachment').byteLength,
			sha256: record(attachment, 'video proxy attachment').sha256,
			timingAsset: record(attachment, 'video proxy attachment').timingAsset,
		});
	}
	for (const asset of planScapeVideoProxyArchiveAssets(attachments).assets) {
		addAsset(byId, assets, asset);
	}
	return Object.freeze({
		formatVersion: 1,
		assets: Object.freeze(assets),
	});
}

function addAsset(
	byId: Map<string, FramescaperProfessionalMediaArchiveAsset>,
	assets: FramescaperProfessionalMediaArchiveAsset[],
	asset: FramescaperProfessionalMediaArchiveAsset,
): void {
	const prior = byId.get(asset.sourceId);
	if (prior) {
		if (JSON.stringify(prior) !== JSON.stringify(asset)) {
			throw new RangeError(`Professional archive root ${asset.sourceId} has conflicting identity.`);
		}
		return;
	}
	if (assets.length >= 4_094) throw new RangeError('Professional archive roots exceed the archive ceiling.');
	byId.set(asset.sourceId, asset);
	assets.push(asset);
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
