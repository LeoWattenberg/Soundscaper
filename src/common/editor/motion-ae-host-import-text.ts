/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeText } from './motion-ae-exchange-types.ts';
export type MotionAeImportText = MotionAeText & { readonly layout: { readonly kind: 'box'; readonly orientation: 'horizontal'; readonly size: readonly [number, number]; readonly position: readonly [number, number] } };
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Object.prototype.toString.call(value) === '[object Array]') throw new Error('AE text expected an object.'); return value as Record<string, unknown>; }
function array(value: unknown, maximum: number): readonly unknown[] { if (Object.prototype.toString.call(value) !== '[object Array]' || (value as unknown[]).length > maximum) throw new Error('AE text array budget exceeded.'); return value as unknown[]; }
function number(value: unknown, minimum: number, maximum: number): number { if (typeof value !== 'number' || !isFinite(value) || value < minimum || value > maximum) throw new Error('AE text numeric range is invalid.'); return value; }
function text(value: unknown, maximum: number): string { if (typeof value !== 'string' || value.length > maximum) throw new Error('AE text string budget exceeded.'); return value; }
function pair(value: unknown, minimum: number): readonly [number, number] { const values = array(value, 2); if (values.length !== 2) throw new Error('AE text box dimensions differ.'); return [number(values[0], minimum, 32768), number(values[1], minimum, 32768)]; }
/** A bounded host-operation whitelist; no exchange expression is activated. */
export function readMotionAeImportText(input: unknown, warnings: string[], budget: { properties: number; keys: number }): MotionAeImportText | null {
	const roots = array(input, 65_536); let result: MotionAeImportText | null = null, found = false;
	for (let root = 0; root < roots.length; root++) {
		const group = record(roots[root]); if (group.matchName !== 'ADBE Text Properties') continue;
		if (found || group.kind !== 'group') throw new Error('AE text requires one captured Text group.'); found = true;
		const children = array(group.children, 65_536);
		for (let index = 0; index < children.length; index++) {
			if (++budget.properties > 65_536) throw new Error('AE text property budget exceeded.');
			const property = record(children[index]);
			if (property.matchName !== 'ADBE Text Document') {
				if (property.kind === 'group' && array(property.children, 65_536).length === 0) continue;
				throw new Error('AE editable text has unmapped layer controls. Use a reviewed Motion text export or rendered fallback.');
			}
			if (result || property.kind !== 'text' || array(property.keys, 4096).length !== 0 || (property.expression !== null && record(property.expression).enabled !== false)) throw new Error('AE text must have one static Source Text without an enabled expression.');
			const value = record(property.value), layout = record(value.layout);
			if (value.styleScope !== 'uniform' || value.styleSupport !== 'basic' || value.applyFill !== true || value.applyStroke !== false || layout.kind !== 'box' || layout.orientation !== 'horizontal') throw new Error('AE editable text requires reviewed uniform basic fill-only horizontal paragraph text.');
			if (value.justification !== 'left' && value.justification !== 'center' && value.justification !== 'right') throw new Error('AE paragraph justification is unsupported.');
			if (typeof value.autoLeading !== 'boolean') throw new Error('AE text leading flag is invalid.');
			const color = array(value.fillColor, 3); if (color.length !== 3) throw new Error('AE text color dimensions differ.');
			const font = text(value.font, 512); if (!font.length) throw new Error('AE text PostScript font name is empty.');
			result = { text: text(value.text, 65_536), font, fontSize: number(value.fontSize, 1, 1296), applyFill: true, applyStroke: false,
				fillColor: [number(color[0], 0, 1), number(color[1], 0, 1), number(color[2], 0, 1)], strokeColor: [0, 0, 0], strokeWidth: 0,
				tracking: number(value.tracking, -1e6, 1e6), leading: number(value.leading, 0, 1e6), autoLeading: value.autoLeading,
				justification: value.justification, styleScope: 'uniform', styleSupport: 'basic', layout: { kind: 'box', orientation: 'horizontal', size: pair(layout.size, 1), position: pair(layout.position, -32768) } };
		}
	}
	if (found && !result) throw new Error('AE text layer lacks Source Text.');
	if (result) warnings.push('Text uses explicitly reviewed paragraph reflow and an exact installed PostScript face. Baselines, kerning, wrapping and shaping remain unqualified; compare the original reference.');
	return result;
}
