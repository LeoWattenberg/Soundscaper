/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	validateFramescaperProjectFeatureRequirementsV18,
} from './editor-project-feature-requirements-v18.ts';

interface CanonicalAsset {
	readonly sourceId: string;
	readonly kind: string;
	readonly sha256: string;
}

/** Bind every V18 rendered fallback to its completed canonical descriptor. */
export function assertFramescaperScapeFallbackAssetsV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
	assets: readonly CanonicalAsset[],
): void {
	const manifest = validateFramescaperProjectFeatureRequirementsV18(profile, project);
	const bySourceId = new Map(assets.map((asset) => [asset.sourceId, asset]));
	for (const requirement of manifest.requirements) {
		if (requirement.disposition !== 'rendered-fallback' || !requirement.fallback) continue;
		const fallback = requirement.fallback;
		const asset = bySourceId.get(fallback.sourceId);
		if (!asset) throw new Error(`The V18 Scape archive is missing fallback source ${fallback.sourceId}.`);
		if (asset.kind !== fallback.kind) {
			throw new Error(`V18 Scape fallback source ${fallback.sourceId} has the wrong kind.`);
		}
		if (asset.sha256 !== fallback.sha256) {
			throw new Error(`V18 Scape fallback source ${fallback.sourceId} failed descriptor binding.`);
		}
	}
}
