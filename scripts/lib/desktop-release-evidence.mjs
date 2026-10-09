/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, lstat, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/** Retain CI receipts separately before checksumming every public download. */
export async function finalizeDesktopReleaseAssets({ assetRoot, evidenceRoot, evidenceNames }) {
	const assets = resolve(assetRoot);
	const evidence = resolve(evidenceRoot);
	if (evidence === assets || evidence.startsWith(`${assets}${sep}`)) {
		throw new Error('CI evidence must stay outside the public release asset directory.');
	}
	await mkdir(evidence, { recursive: true });
	for (const name of evidenceNames) {
		if (!/^(?:runtime-manifest-(?:soundscaper|framescaper)-(?:linux|mac|win)-(?:x64|arm64)|(?:Soundscaper|Framescaper)-professional-native-compliance)\.json$/u.test(name)) {
			throw new Error('The release CI evidence filename is invalid.');
		}
		const path = resolve(assets, name);
		const metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Release CI evidence is not a regular file.');
		await link(path, resolve(evidence, name));
		await unlink(path);
	}
	const entries = await readdir(assets, { withFileTypes: true });
	if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()
		|| /\.json$|\.sha256$|-professional-native-source-/u.test(entry.name))) {
		throw new Error('Public release assets contain unexpected metadata or individual source downloads.');
	}
	const checksums = [];
	for (const name of entries.map((entry) => entry.name).sort()) {
		const hash = createHash('sha256');
		for await (const chunk of createReadStream(resolve(assets, name))) hash.update(chunk);
		checksums.push(`${hash.digest('hex')}  ${name}\n`);
	}
	await writeFile(resolve(assets, 'SHA256SUMS'), checksums.join(''), { flag: 'wx' });
}
