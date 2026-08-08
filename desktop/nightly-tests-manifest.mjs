/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const MANIFEST_KIND = 'soundscaper-desktop-nightly-tests';
const SOURCE_REVISION_PATTERN = /^[a-f\d]{40}$/u;

export async function readDesktopNightlyTestsSourceRevision({
	payloadRoot,
	applicationVersion,
} = {}) {
	if (typeof payloadRoot !== 'string' || !isAbsolute(payloadRoot)) {
		throw new TypeError('Desktop nightly tests payload root must be absolute.');
	}
	if (typeof applicationVersion !== 'string' || !applicationVersion) {
		throw new TypeError('Desktop nightly tests application version is required.');
	}
	const path = join(payloadRoot, 'stage-manifest.json');
	let source;
	try {
		source = await readFile(path, 'utf8');
	} catch (error) {
		throw new Error(`Desktop nightly tests stage manifest is unavailable: ${message(error)}`, { cause: error });
	}
	let manifest;
	try {
		manifest = JSON.parse(source);
	} catch (error) {
		throw new Error(`Desktop nightly tests stage manifest is not valid JSON: ${message(error)}`, { cause: error });
	}
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		throw new Error('Desktop nightly tests stage manifest must be an object.');
	}
	if (manifest.schemaVersion !== 1) {
		throw new Error('Desktop nightly tests stage manifest has an unsupported schema version.');
	}
	if (manifest.kind !== MANIFEST_KIND) {
		throw new Error('Desktop nightly tests stage manifest has an unexpected kind.');
	}
	if (manifest.applicationVersion !== applicationVersion) {
		throw new Error('Desktop nightly tests stage manifest application version does not match the executable.');
	}
	if (manifest.sourceRevision !== null
		&& (typeof manifest.sourceRevision !== 'string'
			|| !SOURCE_REVISION_PATTERN.test(manifest.sourceRevision))) {
		throw new Error('Desktop nightly tests stage manifest source revision is invalid.');
	}
	return manifest.sourceRevision;
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}
