/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTakeCompProjectSchema } from '../project-schema-version.ts';

export interface TakeCompApplicationMenuInput {
	readonly productId: string;
	readonly capability: boolean;
	readonly project: Readonly<{ readonly schemaVersion?: unknown }> | null;
	readonly copy: Readonly<Record<string, string>>;
	open(): unknown;
}

/** Menu-only entry point; take/comp never adds default workspace chrome. */
export function createTakeCompApplicationMenuItems(input: TakeCompApplicationMenuInput) {
	if (input.productId !== 'soundscaper' || !input.capability) return Object.freeze([]);
	return Object.freeze([Object.freeze({
		id: 'take-comp-editor',
		label: input.copy.takeCompMenu,
		disabled: !isTakeCompProjectSchema(input.project?.schemaVersion),
		onClick: input.open,
	})]);
}
