/* SPDX-License-Identifier: AGPL-3.0-only */

interface CrossProductHandoffMenuInput {
	readonly productId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly handoffBlocked: boolean;
	readonly available: boolean;
	readonly actions: Readonly<Record<string, unknown>>;
}

/** Keeps editable-copy ownership in File while resolving cancellation at menu-open time. */
export function createCrossProductHandoffMenuItems(input: CrossProductHandoffMenuInput) {
	const targetLabel = input.productId === 'framescaper'
		? input.copy.editInSoundscaper : input.copy.editInFramescaper;
	const switchItem = Object.freeze({
		id: 'switch-product',
		label: targetLabel,
		disabled: input.handoffBlocked || !input.available,
		disabledReason: input.available
			? undefined
			: input.copy.crossProductHandoffUnavailable,
		onClick: input.actions.switchProduct,
	});
	if (typeof input.actions.cancelCrossProductCopy !== 'function') return [switchItem];
	return [switchItem, Object.freeze({
		id: 'cancel-switch-product',
		label: `${input.copy.cancel}: ${targetLabel}`,
		resolve: () => ({
			disabled: typeof input.actions.crossProductCopyActive !== 'function'
				|| input.actions.crossProductCopyActive() !== true,
		}),
		onClick: input.actions.cancelCrossProductCopy,
	})];
}
