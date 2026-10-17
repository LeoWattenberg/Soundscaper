/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeText, MotionAeTextLayout } from './motion-ae-exchange-types.ts';
import type { MotionAeImportText } from './motion-ae-host-import-text.ts';
export interface MotionAeTextEnums {
	readonly horizontal: unknown; readonly verticalRight: unknown; readonly verticalLeft: unknown; readonly left: unknown; readonly center: unknown; readonly right: unknown;
	readonly metricKern: unknown; readonly baseline: unknown; readonly normalCaps: unknown; readonly normalBaseline: unknown; readonly leftToRight: unknown; readonly defaultDigits: unknown;
	readonly romanLeading: unknown; readonly boxNone: unknown; readonly boxTop: unknown; readonly boxAscent: unknown;
}
export interface MotionAeHostFont { readonly postScriptName: string; readonly isSubstitute: boolean; readonly hasDesignAxes: boolean }
function neutral(enums: MotionAeTextEnums): readonly (readonly [string, unknown])[] {
	return [['fauxBold', false], ['fauxItalic', false], ['baselineShift', 0], ['horizontalScale', 100], ['verticalScale', 100], ['tsume', 0],
		['firstLineIndent', 0], ['startIndent', 0], ['endIndent', 0], ['spaceBefore', 0], ['spaceAfter', 0], ['autoHyphenate', false], ['noBreak', false], ['hangingRoman', false],
		['autoKernType', enums.metricKern], ['baselineDirection', enums.baseline], ['fontCapsOption', enums.normalCaps], ['fontBaselineOption', enums.normalBaseline], ['direction', enums.leftToRight], ['digitSet', enums.defaultDigits], ['leadingType', enums.romanLeading], ['ligature', true]];
}
function boxNeutral(enums: MotionAeTextEnums): readonly (readonly [string, unknown])[] {
	return [['boxAutoFitPolicy', enums.boxNone], ['boxVerticalAlignment', enums.boxTop], ['boxFirstBaselineAlignment', enums.boxAscent], ['boxFirstBaselineAlignmentMinimum', 0], ['boxInsetSpacing', 0]];
}
/** CharacterRange(0,-1) was added in AE24.3; box policy accessors require AE24.6. Missing APIs never prove uniform/basic style.
 * https://ae-scripting.docsforadobe.dev/text/characterrange/
 * https://ae-scripting.docsforadobe.dev/text/textdocument/
 */
export function captureMotionAeTextStyle(value: Readonly<Record<string, unknown>>, enums: MotionAeTextEnums): Pick<MotionAeText, 'styleScope' | 'styleSupport' | 'layout'> {
	let styleScope: MotionAeText['styleScope'] = 'unavailable', styleSupport: MotionAeText['styleSupport'] = 'unavailable', layout: MotionAeTextLayout | undefined;
	try {
		const orientation = value.lineOrientation === enums.horizontal ? 'horizontal' : value.lineOrientation === enums.verticalRight ? 'vertical-right-to-left' : value.lineOrientation === enums.verticalLeft ? 'vertical-left-to-right' : undefined;
		if (orientation && value.boxText === true) { const size = value.boxTextSize as readonly number[], position = value.boxTextPos as readonly number[]; layout = { kind: 'box', orientation, size: [size[0]!, size[1]!], position: [position[0]!, position[1]!] }; }
		else if (orientation && value.pointText === true) layout = { kind: 'point', orientation };
		if (typeof value.characterRange !== 'function') return { styleScope, styleSupport, ...(layout ? { layout } : {}) };
		const range = (value.characterRange as (first: number, last: number) => Readonly<Record<string, unknown>>).call(value, 0, -1);
		const fields = ['font', 'fontSize', 'applyFill', 'applyStroke', 'tracking', 'leading', 'autoLeading', 'justification'];
		if (range.applyFill === true) fields.push('fillColor'); if (range.applyStroke === true) fields.push('strokeColor', 'strokeWidth');
		styleScope = 'uniform';
		for (let index = 0; index < fields.length; index++) if (range[fields[index]!] === undefined) styleScope = 'mixed';
		const checks = neutral(enums); styleSupport = 'basic';
		const font = range.fontObject as MotionAeHostFont | undefined;
		if (!font || font.isSubstitute === undefined || font.hasDesignAxes === undefined) styleSupport = 'unavailable';
		else if (font.isSubstitute || font.hasDesignAxes) styleSupport = 'unsupported';
		for (let index = 0; index < checks.length; index++) {
			const check = checks[index]!;
			if (range[check[0]] === undefined || check[1] === undefined) { styleSupport = 'unavailable'; break; }
			if (range[check[0]] !== check[1] && styleSupport !== 'unavailable') styleSupport = 'unsupported';
		}
		const boxes = boxNeutral(enums);
		if (value.boxText === true) for (let index = 0; index < boxes.length; index++) {
			const check = boxes[index]!;
			if (value[check[0]] === undefined || check[1] === undefined) { styleSupport = 'unavailable'; break; }
			if (value[check[0]] !== check[1] && styleSupport !== 'unavailable') styleSupport = 'unsupported';
		}
	} catch { styleScope = 'unavailable'; styleSupport = 'unavailable'; }
	return { styleScope, styleSupport, ...(layout ? { layout } : {}) };
}
/** FontsObject can return several faces with the same PostScript name; never choose an arbitrary substitute.
 * https://ae-scripting.docsforadobe.dev/text/fontsobject/#fontsobjectgetfontsbypostscriptname
 */
export function verifyMotionAeHostFont(name: string, find: (name: string) => readonly MotionAeHostFont[]): MotionAeHostFont {
	const fonts = find(name);
	if (!fonts || fonts.length !== 1 || fonts[0]!.postScriptName !== name || fonts[0]!.isSubstitute !== false || fonts[0]!.hasDesignAxes !== false) throw new Error('Install one unambiguous real non-variable font face with PostScript name ' + name + ' before importing editable text.');
	return fonts[0]!;
}
export function applyMotionAeHostText(target: Record<string, unknown>, value: MotionAeImportText, enums: MotionAeTextEnums, font: MotionAeHostFont): void {
	if (typeof target.resetCharStyle !== 'function' || typeof target.resetParagraphStyle !== 'function') throw new Error('AE text style reset capability is unavailable.');
	(target.resetCharStyle as () => void).call(target); (target.resetParagraphStyle as () => void).call(target);
	target.text = value.text; target.fontObject = font; target.fontSize = value.fontSize; target.fillColor = value.fillColor;
	target.applyFill = true; target.applyStroke = false; target.tracking = value.tracking;
	// AE setters can change autoLeading. Set the explicit switch after leading.
	target.leading = value.leading; target.autoLeading = value.autoLeading;
	target.justification = value.justification === 'center' ? enums.center : value.justification === 'right' ? enums.right : enums.left;
	target.lineOrientation = enums.horizontal; target.boxTextSize = value.layout.size; target.boxTextPos = value.layout.position;
	const fields = neutral(enums), boxes = boxNeutral(enums);
	for (let index = 0; index < fields.length; index++) target[fields[index]![0]] = fields[index]![1];
	for (let index = 0; index < boxes.length; index++) target[boxes[index]![0]] = boxes[index]![1];
}
