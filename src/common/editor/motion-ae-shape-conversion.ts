/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionLayer, MotionShape } from './motion-composition.ts';
import type { MotionAeLayer, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import { normalizeMotionAeProperties } from './motion-ae-property-custody.ts';
import { convertMotionAePath, exportMotionAePath } from './motion-ae-path-conversion.ts';
import { assertNormalAeVector, convertAeShapePaint, exportAeShapePaint } from './motion-ae-shape-paint.ts';
import { convertAeShapeTransform, identityAeShapeTransform, shapeFields, shapeGroup, shapeGroupRecord, UnsupportedAeShape, type ShapeGroup } from './motion-ae-shape-transform.ts';
import { normalizeMotionLayerContent } from './motion-layer-content.ts';
import { freezeMotionValue } from './motion-values.ts';
import { normalizeRational, type Rational } from './timeline-time.ts';
type Shapes = Extract<MotionLayer, { kind: 'shapes' }>;
type Content = Readonly<{ kind: 'shapes'; shapes: readonly MotionShape[] }>;
const rootName = 'ADBE Root Vectors Group', vectorName = 'ADBE Vector Group', pathName = 'ADBE Vector Shape - Group';
const paints = ['ADBE Vector Graphic - Fill', 'ADBE Vector Graphic - Stroke'];
function reportEntry(scopeId: string, status: MotionAeReportEntry['status'], code: string, message: string): MotionAeReportEntry {
	return { scopeId, propertyPath: rootName, status, code, message };
}
function rateNumber(rate: Rational): number {
	const value = normalizeRational(rate), result = value.num / value.den;
	if (result <= 0 || result > 1000) throw new RangeError('AE shape frame rate is outside its bound.'); return result;
}
/** AE shape groups render bottom first. A single path/paint in each group avoids ambiguous compound-path/composite-order semantics.
 * https://helpx.adobe.com/after-effects/desktop/drawing-painting-and-paths/vector-graphics-and-raster-images/overview-shape-layers-paths-vector.html
 */
export function convertMotionAeShapes(layer: MotionAeLayer, rate: Rational, allocateId: () => string, report: MotionAeReportEntry[]): Content | null {
	rateNumber(rate); const properties = normalizeMotionAeProperties(layer.properties, { properties: 0, keys: 0 });
	const collected: MotionAeReportEntry[] = [], draft: Omit<MotionShape, 'id'>[] = [];
	const note = (code: string, message: string) => collected.push(reportEntry(layer.id, 'editable', code, message));
	try {
		if (layer.kind !== 'shape') throw new UnsupportedAeShape('Only an AE shape layer can become editable Motion shapes.');
		const roots = properties.filter(property => property.matchName === rootName);
		if (roots.length !== 1) throw new UnsupportedAeShape('Exactly one captured Root Vectors Group is required.');
		const root = shapeGroup(roots[0], rootName);
		if (root.children.length > 1024) throw new UnsupportedAeShape('The editable shape group budget is 1024.');
		for (const raw of [...root.children].reverse()) {
			if (raw.kind !== 'group' || raw.matchName !== vectorName) throw new UnsupportedAeShape('Only isolated vector groups are editable; root operators and ungrouped compound paths require rendered fallback.');
			if (raw.enabled === false) { note('shape-disabled', 'Disabled vector group remains in original custody and contributes no paint.'); continue; }
			if (raw.enabled !== true) throw new UnsupportedAeShape('Captured vector enable switches are required; missing visibility is not inferred.');
			assertNormalAeVector(raw);
			const fields = shapeFields(raw, ['ADBE Vectors Group', 'ADBE Vector Transform Group', 'ADBE Vector Blend Mode']);
			const transform = convertAeShapeTransform(shapeGroup(fields.get('ADBE Vector Transform Group'), 'ADBE Vector Transform Group'));
			const content = shapeGroup(fields.get('ADBE Vectors Group'), 'ADBE Vectors Group');
			const active = content.children.filter(child => {
				if (child.kind !== 'group' || child.enabled === undefined) throw new UnsupportedAeShape('Every vector path/paint/operator needs a captured enable switch.');
				if (!child.enabled) note('shape-disabled', 'Disabled vector content remains in original custody and contributes no paint.'); return child.enabled;
			});
			if (!active.length || (active.length === 1 && [pathName, ...paints].includes(active[0]!.matchName))) continue;
			if (active.length !== 2 || active[0]!.matchName !== pathName || !paints.includes(active[1]!.matchName)) throw new UnsupportedAeShape('Each editable group requires one path followed by one solid fill or stroke. Multiple paints, compound paths and operators need explicit group semantics.');
			const pathGroup = shapeGroup(active[0], pathName), pathFields = shapeFields(pathGroup, ['ADBE Vector Shape', 'ADBE Vector Shape Direction']);
			if (pathFields.has('ADBE Vector Shape Direction')) throw new UnsupportedAeShape('Path direction overrides require an explicit winding mapping.');
			const path = pathFields.get('ADBE Vector Shape'); if (path?.kind !== 'shape') throw new UnsupportedAeShape('Captured Bézier geometry is required; parametric shapes need an explicit path bake.');
			const converted = convertMotionAePath(path, rate); if (!converted.property) throw new UnsupportedAeShape(converted.message);
			const paint = convertAeShapePaint(shapeGroup(active[1], active[1]!.matchName), rate, transform.scale);
			draft.push({ path: transform.path(converted.property), fill: paint.fill, stroke: paint.stroke });
			if (converted.quantizedClock || paint.quantizedClock) collected.push(reportEntry(layer.id, 'sampled', 'clock-quantization', 'AE path/paint times were rounded to one millionth of a Motion frame; original times remain in custody.'));
			if (transform.changed) note('shape-group-transform', 'Static positive uniform group scale, rotation and translation are baked into editable path vertices/handles and stroke width. Original group controls remain in custody.');
		}
		if (!draft.length) throw new UnsupportedAeShape('This source has no active editable paint groups; retain or render the original layer.');
		const content = normalizeMotionLayerContent({ kind: 'shapes', shapes: draft.map(shape => ({ id: allocateId(), ...shape })) });
		if (content.kind !== 'shapes') throw new TypeError('Expected shapes.');
		note('shape-mapping', 'Ordered editable Bézier paths and explicit solid paints are mapped structurally. Installed AE reference-frame, edge, blend and color qualification remains pending.');
		report.push(...collected); return freezeMotionValue({ kind: 'shapes', shapes: content.shapes });
	} catch (error) {
		if (!(error instanceof UnsupportedAeShape)) throw error;
		report.push(reportEntry(layer.id, 'unsupported', 'shape-mapping', error.message)); return null;
	}
}
function exportPaintGroup(layer: Shapes, shape: MotionShape, paint: ShapeGroup, rate: number): ShapeGroup {
	const converted = exportMotionAePath(shape.path, { matchName: 'ADBE Vector Shape', name: 'Path', rate, startFrame: layer.startFrame });
	if (converted.unsupported) throw new UnsupportedAeShape(converted.unsupported);
	return { ...shapeGroupRecord(vectorName, [shapeGroupRecord('ADBE Vectors Group', [shapeGroupRecord(pathName, [converted.property], true), paint]), identityAeShapeTransform()], true),
		name: shape.id, vectorStyle: { blendMode: 'normal' } };
}
export function exportMotionAeShapes(layer: MotionLayer, rate: Rational, report: MotionAeReportEntry[]): ShapeGroup | null {
	const frequency = rateNumber(rate);
	try {
		if (layer.kind !== 'shapes') throw new UnsupportedAeShape('Only a Motion shape layer can produce editable AE vector groups.');
		const content = normalizeMotionLayerContent({ kind: 'shapes', shapes: layer.shapes, ...(layer.operators === undefined ? {} : { operators: layer.operators }) });
		if (content.kind !== 'shapes') throw new TypeError('Expected shapes.');
		if (content.operators?.some(operator => operator.enabled)) throw new UnsupportedAeShape('Active shape operators require their own ordered AE mapping; none are silently omitted.');
		const groups: ShapeGroup[] = [];
		for (const shape of content.shapes) {
			if (!shape.fill && !shape.stroke) throw new UnsupportedAeShape('Unpainted editable paths require a separate no-paint group mapping; their authored geometry remains in original.mscape.');
			if (shape.fill) {
				if (shape.fill.kind !== 'color') throw new UnsupportedAeShape('Gradient fills require an explicit AE gradient mapping or rendered fallback.');
				groups.push(exportPaintGroup(layer, shape, exportAeShapePaint(shape.fill, null, frequency, layer.startFrame), frequency));
			}
			if (shape.stroke) groups.push(exportPaintGroup(layer, shape, exportAeShapePaint(shape.stroke.color, shape.stroke, frequency, layer.startFrame), frequency));
		}
		if (!groups.length || groups.length > 1024) throw new UnsupportedAeShape('Editable AE transfer requires between one and 1024 isolated paint groups.');
		const root = shapeGroupRecord(rootName, groups.reverse());
		const normalized = normalizeMotionAeProperties([root], { properties: 0, keys: 0 })[0]; if (normalized?.kind !== 'group') throw new TypeError('Expected AE vector root.');
		report.push(reportEntry(layer.id, 'editable', 'shape-mapping', 'Each solid fill/stroke becomes its own ordered group with an editable copy of the path. Shared path edits become independent; original structure remains in original.mscape. Installed AE reference-frame and color qualification remains pending.'));
		return freezeMotionValue(normalized);
	} catch (error) {
		if (!(error instanceof UnsupportedAeShape)) throw error;
		report.push(reportEntry(layer.id, 'unsupported', 'shape-mapping', error.message)); return null;
	}
}
