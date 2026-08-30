/* SPDX-License-Identifier: AGPL-3.0-only */

export function createCrossProductHandoffActionFacade() {
	return Object.freeze({
		saveCrossProductCopy: async (): Promise<never> => {
			throw new Error('Live peer-product transfer is unavailable in Soundscaper desktop.');
		},
		cancelCrossProductCopy: (): boolean => false,
		crossProductCopyActive: (): boolean => false,
	});
}

export async function mountTransferPageFromLocation(): Promise<never> {
	throw new Error('Live peer-product transfer is unavailable in Soundscaper desktop.');
}
