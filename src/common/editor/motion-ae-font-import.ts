/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeExchange } from './motion-ae-exchange-types.ts';
import type { prepareMotionFont } from './motion-font-import.ts';
import { motionAeTextFontNames } from './motion-ae-text-font-references.ts';
import { motionString } from './motion-values.ts';
import { throwIfScapeAborted } from './scape-abort.ts';
export interface MotionAeSelectedFont { readonly postScriptName: string; readonly file: Blob; readonly name: string; readonly style: string }
export type MotionAeFontDecoder = (file: Blob, options: Readonly<{ id: string; name: string; style: string }>, signal?: AbortSignal) => ReturnType<typeof prepareMotionFont>;
/** Admission precedes any decoding; caller adds these bytes to the shared transfer budget. */
export function admitMotionAeSelectedFonts(fonts: readonly MotionAeSelectedFont[], exchange: MotionAeExchange): number {
	if (fonts.length > 4096) throw new RangeError('AE font selection count exceeds its budget.');
	const referenced = new Set(motionAeTextFontNames(exchange)), names = new Set<string>(); let bytes = 0;
	for (const font of fonts) {
		const name = motionString(font.postScriptName, 'AE PostScript font name', 512);
		if (!referenced.has(name) || names.has(name)) throw new Error('AE font selection must bind a unique captured PostScript name.'); names.add(name);
		motionString(font.name, 'AE selected font file name', 512); motionString(font.style, 'AE selected font style', 512);
		if (!(font.file instanceof Blob) || font.file.size < 1 || font.file.size > 16 * 1024 * 1024) throw new RangeError('AE selected font must fit the 16 MiB font decoder limit.');
		bytes += font.file.size;
	}
	return bytes;
}
export const prepareMotionAeSelectedFont: MotionAeFontDecoder = async (file, options, signal) => {
	throwIfScapeAborted(signal);
	const [{ prepareMotionFont }, { loadMotionRasterRuntime }] = await Promise.all([import('./motion-font-import.ts'), import('./controller/composition/motion-raster-runtime.ts')]);
	const runtime = await loadMotionRasterRuntime(signal); throwIfScapeAborted(signal);
	return prepareMotionFont(file, options, runtime.kit, signal);
};
