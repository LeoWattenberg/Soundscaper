/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeExchange, MotionAeProperty } from './motion-ae-exchange-types.ts';
/** Call after closed exchange normalization; traversal inherits its property/depth budgets. */
export function motionAeTextFontNames(exchange: MotionAeExchange): readonly string[] {
	const names = new Set<string>();
	const properties = (values: readonly MotionAeProperty[]) => {
		for (const property of values) {
			if (property.kind === 'group') properties(property.children);
			else if (property.kind === 'text') { names.add(property.value.font); for (const key of property.keys) names.add(key.value.font); }
		}
	};
	for (const composition of exchange.compositions) for (const layer of composition.layers) properties(layer.properties);
	return [...names];
}
