/* SPDX-License-Identifier: AGPL-3.0-only */

import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { mergeProcessCovs } from '@bcoe/v8-coverage';

// Every `node --test` child writes its own raw V8 profile, and each one carries a
// full copy of the source-map cache for the TypeScript it loaded. A sharded run
// therefore leaves gigabytes behind, almost all of it duplicated. Compaction
// merges the range data the way `c8 report` would and keeps one copy of each
// source map, which is what makes a shard's coverage small enough to hand to the
// job that checks the thresholds over the union.
const MERGE_BATCH_SIZE = 32;

export function compactV8Coverage(temporaryDirectory, repositoryRoot) {
	const keep = coverageUrlFilter(repositoryRoot);
	const sourceMapCache = Object.create(null);
	let merged = { result: [] };
	let batch = [];
	for (const name of readdirSync(temporaryDirectory).sort()) {
		if (!name.endsWith('.json')) continue;
		const profile = readProfile(resolve(temporaryDirectory, name));
		if (profile === null) continue;
		batch.push({ result: (profile.result ?? []).filter((entry) => keep(entry.url)) });
		for (const [url, entry] of Object.entries(profile['source-map-cache'] ?? {})) {
			if (keep(url) && !(url in sourceMapCache)) sourceMapCache[url] = entry;
		}
		if (batch.length >= MERGE_BATCH_SIZE) {
			merged = mergeProcessCovs([merged, ...batch]);
			batch = [];
		}
	}
	if (batch.length > 0) merged = mergeProcessCovs([merged, ...batch]);
	return { result: merged.result, 'source-map-cache': sourceMapCache };
}

// Only the checkout's own sources can be reported on, so node internals, the
// dependency tree and any stray absolute path are dropped before merging.
export function coverageUrlFilter(repositoryRoot) {
	const rootUrl = `${pathToFileURL(resolve(repositoryRoot)).href.replace(/\/$/u, '')}/`;
	return (url) => typeof url === 'string' && url.startsWith(rootUrl) && !url.includes('/node_modules/');
}

function readProfile(file) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		// A profile that was still being written when the shard was interrupted is
		// not coverage evidence; failing the whole compaction over it would only
		// turn a partial run into an unreadable one.
		return null;
	}
}
