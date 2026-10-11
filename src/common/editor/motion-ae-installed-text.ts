/* SPDX-License-Identifier: AGPL-3.0-only */
import { captureMotionAeTextStyle, applyMotionAeHostText, verifyMotionAeHostFont, type MotionAeHostFont, type MotionAeTextEnums } from './motion-ae-host-text.ts';
import type { MotionAeText } from './motion-ae-exchange-types.ts';
import type { MotionAeImportText } from './motion-ae-host-import-text.ts';
declare const app: { readonly version: string; readonly fonts: { getFontsByPostScriptName(name: string): readonly MotionAeHostFont[] } };
declare const ParagraphJustification: { LEFT_JUSTIFY: unknown; CENTER_JUSTIFY: unknown; RIGHT_JUSTIFY: unknown };
declare const LineOrientation: { HORIZONTAL: unknown; VERTICAL_RIGHT_TO_LEFT: unknown; VERTICAL_LEFT_TO_RIGHT: unknown };
declare const AutoKernType: { METRIC_KERN: unknown }; declare const BaselineDirection: { BASELINE_WITH_STREAM: unknown };
declare const FontCapsOption: { FONT_NORMAL_CAPS: unknown }; declare const FontBaselineOption: { FONT_NORMAL_BASELINE: unknown };
declare const ParagraphDirection: { DIRECTION_LEFT_TO_RIGHT: unknown }; declare const DigitSet: { DEFAULT_DIGITS: unknown };
declare const LeadingType: { ROMAN_LEADING_TYPE: unknown };
declare const BoxAutoFitPolicy: { NONE: unknown }; declare const BoxVerticalAlignment: { TOP: unknown }; declare const BoxFirstBaselineAlignment: { ASCENT: unknown };
function enums(): MotionAeTextEnums {
	return { horizontal: LineOrientation.HORIZONTAL, verticalRight: LineOrientation.VERTICAL_RIGHT_TO_LEFT, verticalLeft: LineOrientation.VERTICAL_LEFT_TO_RIGHT,
		left: ParagraphJustification.LEFT_JUSTIFY, center: ParagraphJustification.CENTER_JUSTIFY, right: ParagraphJustification.RIGHT_JUSTIFY,
		metricKern: AutoKernType.METRIC_KERN, baseline: BaselineDirection.BASELINE_WITH_STREAM, normalCaps: FontCapsOption.FONT_NORMAL_CAPS, normalBaseline: FontBaselineOption.FONT_NORMAL_BASELINE,
		leftToRight: ParagraphDirection.DIRECTION_LEFT_TO_RIGHT, defaultDigits: DigitSet.DEFAULT_DIGITS, romanLeading: LeadingType.ROMAN_LEADING_TYPE,
		boxNone: BoxAutoFitPolicy.NONE, boxTop: BoxVerticalAlignment.TOP, boxAscent: BoxFirstBaselineAlignment.ASCENT };
}
/** First-character values remain custody, never proof that the full range is uniform. */
export function readMotionAeInstalledText(input: unknown): MotionAeText {
	const text = input as MotionAeText & Readonly<Record<string, unknown>>;
	if (text.justification !== ParagraphJustification.LEFT_JUSTIFY && text.justification !== ParagraphJustification.CENTER_JUSTIFY && text.justification !== ParagraphJustification.RIGHT_JUSTIFY) throw new Error('This paragraph alignment needs an explicit text mapping.');
	let metadata: Pick<MotionAeText, 'styleScope' | 'styleSupport' | 'layout'> = { styleScope: 'unavailable', styleSupport: 'unavailable' };
	if (parseFloat(app.version) >= 24.6) metadata = captureMotionAeTextStyle(text, enums());
	return { text: text.text, font: text.font, fontSize: text.fontSize, fillColor: text.applyFill ? [text.fillColor[0], text.fillColor[1], text.fillColor[2]] : [0, 0, 0], applyFill: text.applyFill,
		applyStroke: text.applyStroke, strokeColor: text.applyStroke ? [text.strokeColor[0], text.strokeColor[1], text.strokeColor[2]] : [0, 0, 0], strokeWidth: text.strokeWidth, tracking: text.tracking,
		leading: text.leading, autoLeading: text.autoLeading, justification: text.justification === ParagraphJustification.CENTER_JUSTIFY ? 'center' : text.justification === ParagraphJustification.RIGHT_JUSTIFY ? 'right' : 'left', ...metadata };
}
export function verifyMotionAeInstalledTextFont(name: string): MotionAeHostFont {
	if (!(parseFloat(app.version) >= 24.6) || !app.fonts || typeof app.fonts.getFontsByPostScriptName !== 'function') throw new Error('Editable paragraph text requires After Effects 24.6 or newer and its font registry.');
	return verifyMotionAeHostFont(name, value => app.fonts.getFontsByPostScriptName(value));
}
export function applyMotionAeInstalledText(property: Readonly<{ value: unknown; setValue(value: unknown): void }>, text: MotionAeImportText): void {
	const font = verifyMotionAeInstalledTextFont(text.font), document = property.value as Record<string, unknown>;
	applyMotionAeHostText(document, text, enums(), font); property.setValue(document);
	const applied = property.value as Record<string, unknown>, actual = applied.fontObject as MotionAeHostFont;
	if (!actual || actual.postScriptName !== text.font || actual.isSubstitute !== false || actual.hasDesignAxes !== false) throw new Error('AE substituted the requested text font. Import was rolled back.');
}
