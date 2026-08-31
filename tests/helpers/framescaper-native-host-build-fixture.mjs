/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function sourcePins(root, inputs) {
	return inputs.map((path) => {
		const bytes = readFileSync(join(root, path));
		return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
	});
}

export function listRelativeFiles(root, prefix = '') {
	const files = [];
	for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
		const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) files.push(...listRelativeFiles(root, path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

export function closureIdentity(closure) {
	return {
		algorithm: closure.algorithm,
		...(closure.roots ? { roots: [...closure.roots] } : {}),
		fileCount: closure.fileCount,
		sha256: closure.sha256,
	};
}

export function json(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
