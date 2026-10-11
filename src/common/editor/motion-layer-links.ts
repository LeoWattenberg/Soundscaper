/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionLayer } from './motion-composition.ts';
import { motionLayerProperties } from './motion-project-graph.ts';
import { normalizeMotionLayer } from './motion-layer-validation.ts';
import { normalizeMotionProperty, type MotionProperty } from './motion-property.ts';

export function motionLayerDependencyIds(layer: MotionLayer): readonly string[] {
	return [...new Set([layer.parentId, layer.matte?.layerId, ...(layer.kind === 'adjustment' ? layer.targetLayerIds : []),
		...motionLayerProperties(layer).flatMap(({ property }) => property.expression?.references.map(({ layerId }) => layerId) ?? [])].filter((id): id is string => typeof id === 'string'))];
}

/** Address only an existing normalized property; arbitrary object paths never become writable authority. */
export function replaceMotionLayerProperty(layer: MotionLayer, propertyPath: string, property: MotionProperty): MotionLayer {
	const previous = motionLayerProperties(layer).find(({ path }) => path === propertyPath);
	if (!previous) throw new ReferenceError(`Motion property ${propertyPath} is missing.`);
	const normalized = normalizeMotionProperty(property); if (normalized.kind !== previous.property.kind) throw new TypeError('A motion property edit cannot change its value kind.');
	const parts = propertyPath.split('.');
	const replace = (value: unknown, depth: number): unknown => {
		if (depth === parts.length) return normalized;
		const key = parts[depth]!;
		if (Array.isArray(value)) return value.map((item: unknown, index) => String(index) === key ? replace(item, depth + 1) : item);
		return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, name === key ? replace(item, depth + 1) : item]));
	};
	return normalizeMotionLayer(replace(layer, 0));
}

/** References inside a duplicate set follow the corresponding new identity; outside links remain explicit. */
export function remapMotionLayerLinks(layer: MotionLayer, identities: ReadonlyMap<string, string>): MotionLayer {
	const map = (id: string) => identities.get(id) ?? id;
	let result = normalizeMotionLayer({ ...layer, parentId: layer.parentId === null ? null : map(layer.parentId),
		matte: layer.matte === null ? null : { ...layer.matte, layerId: map(layer.matte.layerId) },
		...(layer.kind === 'adjustment' ? { targetLayerIds: layer.targetLayerIds.map(map) } : {}) });
	for (const { path, property } of motionLayerProperties(result)) if (property.expression !== null) result = replaceMotionLayerProperty(result, path, {
		...property, expression: { ...property.expression, references: property.expression.references.map((reference) => ({ ...reference, layerId: map(reference.layerId) })) },
	});
	return result;
}
