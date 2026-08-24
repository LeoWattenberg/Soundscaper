/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fail-closed recognition of files an OpenFX child could map as native code. */

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

const MACH_O_MAGICS = new Set([
	'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'cafebabf',
]);

export async function isExecutableMappableOpenFxFile(path: string): Promise<boolean> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const bytes = Buffer.alloc(4);
		const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
		return bytesRead === 4 && (bytes.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
			|| MACH_O_MAGICS.has(bytes.toString('hex')))
			|| bytesRead >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
	} finally { await handle.close(); }
}
