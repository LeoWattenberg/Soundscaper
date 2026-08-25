/* SPDX-License-Identifier: AGPL-3.0-only */

export type FramescaperBootstrapGeneration = 28 | 30;

/** Keep native-only V28 authority while selecting timeline-image V30 on the web. */
export function selectFramescaperBootstrapGeneration(
	routeValue: unknown,
	scopeValue: unknown = globalThis,
): FramescaperBootstrapGeneration {
	const route = record(routeValue);
	if (data(route, 'desktop') === true) return 28;
	const scope = record(scopeValue);
	const windowScope = record(data(scope, 'window'));
	return hasFramescaperDesktopBridge(scope) || hasFramescaperDesktopBridge(windowScope) ? 28 : 30;
}

function hasFramescaperDesktopBridge(scope: Readonly<Record<PropertyKey, unknown>> | null): boolean {
	const desktop = record(data(scope, 'framescaperDesktop'));
	return record(data(desktop, 'v1')) !== null;
}

function data(
	value: Readonly<Record<PropertyKey, unknown>> | null,
	key: PropertyKey,
): unknown {
	if (!value) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function record(value: unknown): Readonly<Record<PropertyKey, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<PropertyKey, unknown>> : null;
}
