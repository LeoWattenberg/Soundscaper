import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import { cacheKey, canonicalJson } from './provenance.mjs';

export async function readCache(cacheDirectory, identity) {
	const filePath = join(cacheDirectory, `${cacheKey(identity)}.json`);
	let raw;
	try {
		raw = await readFile(filePath, 'utf8');
	} catch (error) {
		if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
		throw error;
	}
	let entry;
	try {
		entry = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Docs AI cache entry is invalid JSON: ${filePath}`, { cause: error });
	}
	if (canonicalJson(entry.identity) !== canonicalJson(identity) || !entry.value || typeof entry.value !== 'object') {
		throw new Error(`Docs AI cache identity does not match its filename: ${filePath}`);
	}
	return entry.value;
}

export async function writeCache(cacheDirectory, identity, value) {
	const filePath = join(cacheDirectory, `${cacheKey(identity)}.json`);
	await mkdir(dirname(filePath), { recursive: true });
	const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, `${canonicalJson({ identity, value })}\n`, { flag: 'wx' });
	await rename(temporaryPath, filePath);
	return filePath;
}
