/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductVideoExportStrategy } from
	'../common/editor/controller/product-video-export-strategy.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';
import type { FramescaperVideoExportStrategyFinishingDependencies } from './video-export-strategy-finishing.ts';
import type { FramescaperVideoExportAssetStoreTimelineImage } from './video-export-strategy-timeline-image.ts';
import { createFramescaperVideoExportStrategyAssistance } from './video-export-strategy-assistance.ts';

export function createFramescaperVideoExportStrategy(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyFinishingDependencies,
	assetStore?: FramescaperVideoExportAssetStoreTimelineImage,
	openFxExecute?: FramescaperSelectedOpenFxExecutionNativeMedia['execute'],
): ProductVideoExportStrategy {
	return createFramescaperVideoExportStrategyAssistance(
		profile,
		dependencies,
		assetStore,
		openFxExecute,
	);
}
