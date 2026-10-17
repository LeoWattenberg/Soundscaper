/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { ScapeAssetDescriptor } from '../common/editor/scape-archive-envelope.ts';
import type { FramescaperSuccessorProject } from './editor-project-successor.ts';

export const MOTION_LINKED_ARCHIVE_ASSET_KIND = 'motion-linked-original';
export function indexFramescaperLinkedAssets(project: FramescaperSuccessorProject): readonly MotionAsset[] {
	const assets = new Map<string, MotionAsset>();
	for (const link of project.compositionLinks) for (const asset of link.snapshot.project.assets) {
		const prior = assets.get(asset.sha256);
		if (prior && prior.byteLength !== asset.byteLength) throw new RangeError('Linked archive asset aliases disagree about byte length.');
		if (!prior) assets.set(asset.sha256, asset);
	}
	return [...assets.values()].sort((first, second) => first.sha256.localeCompare(second.sha256));
}
export function createFramescaperLinkedAssetDescriptor(asset: MotionAsset): ScapeAssetDescriptor {
	return { sourceId: `motion-linked:${asset.sha256}`, kind: MOTION_LINKED_ARCHIVE_ASSET_KIND, encoding: 'motion-linked-original-v1', entry: `motion-links/sha256/${asset.sha256}/original`, size: asset.byteLength, sha256: asset.sha256, mimeType: 'application/octet-stream' };
}
