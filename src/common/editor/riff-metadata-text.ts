/* SPDX-License-Identifier: AGPL-3.0-only */

const DOS437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';
const DOS850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0';

/** CSET declares the encoding of RIFF text, even when it follows the INFO list. */
export function riffMetadataCodePage(payload: Uint8Array, littleEndian = true): number {
	if (payload.byteLength < 8) throw new RangeError('The RIFF CSET chunk must contain its four 16-bit fields.');
	return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(0, littleEndian);
}

/** Retain modern undeclared UTF-8 and the RIFF default ISO-8859-1 fallback. */
export function decodeRiffMetadataText(payload: Uint8Array, codePage = 0): string {
	const nul = payload.indexOf(0);
	const bytes = nul < 0 ? payload : payload.subarray(0, nul);
	if (codePage === 0) {
		try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
		catch { return singleByteText(bytes); }
	}
	if (codePage === 28591) return singleByteText(bytes);
	if (codePage === 437 || codePage === 850 || codePage === 858) {
		const table = codePage === 437 ? DOS437 : DOS850;
		return Array.from(bytes, byte => byte < 128 ? String.fromCharCode(byte)
			: codePage === 858 && byte === 213 ? '€' : table[byte - 128]!).join('');
	}
	const encoding = codePage === 65001 ? 'utf-8' : codePage === 1252 ? 'windows-1252'
		: codePage === 28592 ? 'iso-8859-2' : null;
	if (encoding === null) throw new RangeError(`The RIFF CSET code page ${String(codePage)} is unsupported.`);
	return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

function singleByteText(bytes: Uint8Array): string {
	return Array.from(bytes, byte => String.fromCharCode(byte)).join('');
}
