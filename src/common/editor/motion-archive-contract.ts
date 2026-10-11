/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from './motion-asset.ts';
import type { MotionscaperProject } from './motion-project-types.ts';
import type { ScapeAssetDescriptor } from './scape-archive-envelope.ts';
import { safeScapeEntryId } from './scape-archive-media.ts';
export const MOTION_ARCHIVE_ASSET_KINDS = ['motion-image', 'motion-footage', 'motion-audio', 'motion-font'] as const;

export function motionArchiveAssetEntry(asset: MotionAsset): string {
	return `media/${safeScapeEntryId(asset.id)}/original`;
}

export function motionArchiveAssetDescriptor(asset: MotionAsset): ScapeAssetDescriptor {
	return {
		sourceId: asset.id, kind: `motion-${asset.kind}`, entry: motionArchiveAssetEntry(asset),
		encoding: 'motion-original-v1', size: asset.byteLength, sha256: asset.sha256, mimeType: asset.mimeType,
	};
}

export function validateMotionArchiveAssetClosure(project: MotionscaperProject, descriptors: readonly ScapeAssetDescriptor[]): void {
	if (project.assets.length !== descriptors.length) throw new RangeError('Motion archive has an incomplete asset closure.');
	const byId = new Map(descriptors.map((asset) => [asset.sourceId, asset]));
	for (const asset of project.assets) {
		const actual = byId.get(asset.id);
		const expected = motionArchiveAssetDescriptor(asset);
		if (!actual || Object.keys(expected).some((key) => actual[key] !== expected[key])) {
			throw new RangeError(`Motion asset ${asset.id} descriptor does not match its closure contract.`);
		}
	}
}

