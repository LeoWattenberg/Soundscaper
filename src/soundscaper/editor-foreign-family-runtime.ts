/* SPDX-License-Identifier: AGPL-3.0-only */

import type * as Handoff from '../common/editor/controller/cross-product-handoff-action-facade.ts';
import type * as Transfer from '../common/transfer/transfer-page-entry.ts';

export const createCrossProductHandoffActionFacade: typeof Handoff.createCrossProductHandoffActionFacade = () => {
	return Object.freeze({
		saveCrossProductCopy: async (): Promise<never> => {
			throw new Error('Live peer-product transfer is unavailable in Soundscaper desktop.');
		},
		cancelCrossProductCopy: (): boolean => false,
		crossProductCopyActive: (): boolean => false,
	});
};

export const mountTransferPageFromLocation: typeof Transfer.mountTransferPageFromLocation = async () => {
	throw new Error('Live peer-product transfer is unavailable in Soundscaper desktop.');
};
