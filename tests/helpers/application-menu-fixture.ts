/* SPDX-License-Identifier: AGPL-3.0-only */

/** Command defaults must not manufacture optional structured runtime ports. */
export function createMenuActionFixture(
	overrides: Readonly<Record<string, unknown>> = {},
	call: (name: string) => unknown = () => undefined,
): Readonly<Record<PropertyKey, unknown>> {
	const actions: Record<PropertyKey, unknown> = {
		parallelStackProcessing: null,
		soundscaperWorkflow: null,
		framescaperNativeServices: null,
		framescaperCandidateAuthoring: null,
		soundscaperNativeServices: null,
		araClipEditing: null,
		...overrides,
	};
	return new Proxy(actions, {
		get(target, property) {
			if (Object.hasOwn(target, property)) return target[property];
			return typeof property === 'string' ? () => call(property) : undefined;
		},
	});
}

interface MenuFixtureNode<Item> {
	readonly id?: unknown;
	readonly items?: readonly Item[];
}

export function findMenuItem<Item extends MenuFixtureNode<Item>>(
	values: readonly Item[],
	id: string,
): Item | null {
	for (const value of values) {
		if (value.id === id) return value;
		const nested = value.items ? findMenuItem(value.items, id) : null;
		if (nested) return nested;
	}
	return null;
}
