/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join } from 'node:path';

const PRODUCTS = Object.freeze({
	soundscaper: Object.freeze({ executable: 'Soundscaper', linuxExecutable: 'soundscaper' }),
	framescaper: Object.freeze({ executable: 'Framescaper', linuxExecutable: 'framescaper' }),
});

/** Resolve one staged product executable without loading the nightly metrics graph. */
export function resolvePackagedProductExecutable({ productRoot, productId, platform, arch }) {
	if (typeof productRoot !== 'string' || !productRoot || !isAbsolute(productRoot)) {
		throw new TypeError('Packaged product root must be absolute.');
	}
	const product = PRODUCTS[productId];
	if (!product) throw new TypeError('Packaged product ID is invalid.');
	if (!['x64', 'arm64'].includes(arch)) throw new TypeError('Packaged product architecture is invalid.');
	const root = join(productRoot, productId);
	if (platform === 'win32') {
		return join(root, `win${arch === 'x64' ? '' : `-${arch}`}-unpacked`, `${product.executable}.exe`);
	}
	if (platform === 'darwin') {
		return join(root, `mac${arch === 'x64' ? '' : `-${arch}`}`, `${product.executable}.app`, 'Contents', 'MacOS', product.executable);
	}
	if (platform === 'linux') {
		return join(root, `linux${arch === 'x64' ? '' : `-${arch}`}-unpacked`, product.linuxExecutable);
	}
	throw new TypeError('Packaged product platform is invalid.');
}
