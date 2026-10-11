/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeLayer, MotionAeProperty, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import { convertMotionAeTextDocument, exportMotionAeTextDocument, type MotionAeTextImportOptions, type MotionAeTextExportOptions } from './motion-ae-text-conversion.ts';
import type { MotionAeFontBinding } from './motion-ae-text-fonts.ts';
import type { MotionLayer, MotionTextDocument } from './motion-composition.ts';
import { motionPropertyOfKind, type MotionVector3Property, type MotionVector2, type MotionPath } from './motion-property.ts';

export interface MotionAeProjectTextImport { readonly fonts?: readonly MotionAeFontBinding[]; readonly text?: MotionAeTextImportOptions }
export interface MotionAeProjectTextExport { readonly fonts?: readonly MotionAeFontBinding[]; readonly text?: MotionAeTextExportOptions }
export function convertMotionAeTextLayer(layer: MotionAeLayer, options: MotionAeProjectTextImport, report: MotionAeReportEntry[]) {
	const issue = (message: string, code = 'text-mapping', propertyPath = '') => { report.push({ scopeId: layer.id, propertyPath, status: 'unsupported', code, message }); };
	if (!options.text) { issue('Editable text requires explicit retained-font binding and destination layout review. Original text remains in custody.'); return null; }
	const groups = layer.properties.filter(property => property.matchName === 'ADBE Text Properties');
	const group = groups[0];
	if (groups.length !== 1 || group?.kind !== 'group') { issue('Exactly one captured Text group is required for editable text.'); return null; }
	const properties = group.children.filter(property => property.matchName === 'ADBE Text Document'), property = properties[0];
	if (properties.length !== 1 || property?.kind !== 'text') { issue('Exactly one captured Source Text property is required for editable text.'); return null; }
	let refusal = false;
	for (const child of group.children) {
		if (child === property || (child.kind === 'group' && child.children.length === 0)) continue;
		if (child.matchName === 'ADBE Text Animators' || child.matchName === 'ADBE Text Path Options') refusal = true;
		issue('This text-layer control has no editable mapping. Original controls remain in custody; compare the AE reference before using the partial text draft.', 'text-layer-control', child.matchName);
	}
	if (refusal) return null;
	const converted = convertMotionAeTextDocument(property, options.fonts ?? [], options.text);
	for (const entry of converted.messages) report.push({ scopeId: layer.id, propertyPath: 'ADBE Text Properties/ADBE Text Document', ...entry });
	return converted.document && converted.localOffset ? { document: converted.document, offset: converted.localOffset } : null;
}
export function exportMotionAeTextLayer(document: MotionTextDocument, scopeId: string, options: MotionAeProjectTextExport, report: MotionAeReportEntry[]): MotionAeProperty | null {
	if (!options.text) { report.push({ scopeId, propertyPath: '', status: 'unsupported', code: 'text-mapping', message: 'Editable text requires explicit PostScript-name binding and AE leading review. Original text and font bytes remain in original.mscape.' }); return null; }
	const converted = exportMotionAeTextDocument(document, options.fonts ?? [], options.text);
	for (const entry of converted.messages) report.push({ scopeId, propertyPath: 'ADBE Text Properties/ADBE Text Document', ...entry });
	return converted.property ? { kind: 'group', matchName: 'ADBE Text Properties', name: 'Text', children: [converted.property] } : null;
}
/** T(P) R S (x + boxOrigin - A) = T(P) R S (x - (A - boxOrigin)). */
export function offsetMotionAeTextAnchor(anchor: MotionVector3Property, offset: MotionVector2): MotionVector3Property {
	return motionPropertyOfKind({ ...anchor, value: [anchor.value[0] - offset[0], anchor.value[1] - offset[1], anchor.value[2]],
		curves: anchor.curves.map((curve, axis) => {
			const shift = offset[axis] ?? 0;
			return curve === null ? null : { anchors: curve.anchors.map(value => ({ ...value, value: value.value - shift })),
				segments: curve.segments.map(segment => segment.kind !== 'bezier' ? segment : { ...segment,
					control1: { ...segment.control1, value: segment.control1.value - shift }, control2: { ...segment.control2, value: segment.control2.value - shift } }) };
		}),
	}, 'vector3');
}
/** Masks share the old layer-local coordinates and must move with the text origin. */
export function rebaseMotionAeTextLayer(layer: MotionLayer, offset: MotionVector2, scopeId: string, report: MotionAeReportEntry[]): MotionLayer {
	if (offset.every(value => value === 0)) return layer;
	const path = (value: MotionPath): MotionPath => ({ ...value, vertices: value.vertices.map(vertex => ({ ...vertex, point: [vertex.point[0] - offset[0], vertex.point[1] - offset[1]] })) });
	report.push({ scopeId, propertyPath: '', status: 'editable', code: 'text-box-origin', message: 'The captured paragraph box origin rebases the local anchor and mask geometry. Layout, baseline and wrapping still require the declared reflow review.' });
	return { ...layer, transform: { ...layer.transform, anchor: offsetMotionAeTextAnchor(layer.transform.anchor, offset) },
		masks: layer.masks.map(mask => ({ ...mask, path: { ...mask.path, value: path(mask.path.value), keyframes: mask.path.keyframes.map(key => ({ ...key, value: path(key.value) })) } })) };
}
