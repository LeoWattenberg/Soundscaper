/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	framescaperModelOptions,
	opacityKeyframes,
} from './framescaper-model-fixture-common.ts';

export { opacityKeyframes };

export const FRAMESCAPER_BASELINE_FIXTURE_NOW = '2026-08-13T12:00:00.000Z';

export function framescaperBaselineOptions(): Record<string, unknown> {
	return framescaperModelOptions({
		id: 'framescaper-baseline',
		title: 'Framescaper baseline',
		now: FRAMESCAPER_BASELINE_FIXTURE_NOW,
	});
}
