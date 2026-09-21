/* SPDX-License-Identifier: AGPL-3.0-only */

/** True when every UTF-16 surrogate belongs to one complete Unicode scalar. */
export function hasOnlyUnicodeScalars(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
	}
	return true;
}
