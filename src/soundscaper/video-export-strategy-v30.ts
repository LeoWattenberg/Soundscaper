/* SPDX-License-Identifier: AGPL-3.0-only */

/** V30 retains the selected V29 keyed video delivery implementation. */
export {
	createSoundscaperDesktopVideoExportStrategyV29 as createSoundscaperDesktopVideoExportStrategyV30,
	createSoundscaperVideoExportStrategyV29 as createSoundscaperVideoExportStrategyV30,
} from './video-export-strategy-v29.ts';

export type {
	SoundscaperVideoExportStrategyV29Dependencies as SoundscaperVideoExportStrategyV30Dependencies,
} from './video-export-strategy-v29.ts';
