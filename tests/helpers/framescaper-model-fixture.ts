/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	framescaperModelOptions,
	opacityKeyframes,
} from './framescaper-model-fixture-common.ts';

export { opacityKeyframes };

export const FRAMESCAPER_V20_FIXTURE_NOW = '2026-08-13T12:00:00.000Z';

export function framescaperV20Options(): Record<string, unknown> {
	return framescaperModelOptions({
		id: 'framescaper-v20',
		title: 'Framescaper V20',
		now: FRAMESCAPER_V20_FIXTURE_NOW,
	});
}
