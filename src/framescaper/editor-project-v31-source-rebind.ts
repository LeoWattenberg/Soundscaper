/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { rebindFramescaperSourceIdentitiesV30 } from './editor-project-v30-source-rebind.ts';

/** Follow one `.scape` collision through inherited visuals and F31 transcripts. */
export function rebindFramescaperSourceIdentitiesV31(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	rebindFramescaperSourceIdentitiesV30(project, sourceIdMap);
	const assets = normalizeAssistanceAssetReferencesV1(project.assistanceAssets);
	project.assistanceAssets = normalizeAssistanceAssetReferencesV1(assets.map((asset) => ({
		...asset,
		sourceId: sourceIdMap.get(asset.sourceId) ?? asset.sourceId,
	})));
}
