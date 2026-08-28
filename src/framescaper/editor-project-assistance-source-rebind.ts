/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { rebindFramescaperSourceIdentitiesTimelineImage } from './editor-project-timeline-image-source-rebind.ts';

/** Follow one Scape collision through inherited visuals and assistance transcripts. */
export function rebindFramescaperSourceIdentitiesAssistance(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	rebindFramescaperSourceIdentitiesTimelineImage(project, sourceIdMap);
	const assets = normalizeAssistanceAssetReferencesV1(project.assistanceAssets);
	project.assistanceAssets = normalizeAssistanceAssetReferencesV1(assets.map((asset) => ({
		...asset,
		sourceId: sourceIdMap.get(asset.sourceId) ?? asset.sourceId,
	})));
}
