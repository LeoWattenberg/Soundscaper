/* SPDX-License-Identifier: AGPL-3.0-only */

import { extname } from 'node:path';

import {
	ACCEPTED_PROJECT_FILE_EXTENSIONS,
	READ_PROFILE_MATERIALIZED_V1,
	READ_PROFILE_SCAPE_RANGE_V1,
	READ_PROFILE_SELECTED_RANGE_V1,
	SCAPE_PROJECT_MIME_TYPE,
} from './constants.js';
import { acceptsFile, mimeTypeForPath } from './validation.js';

const PROJECT_EXTENSION_SET = new Set(ACCEPTED_PROJECT_FILE_EXTENSIONS);

// Native Scape projects use their archive reader; every other accepted file
// uses a selected range so opening it does not copy the original into memory.
export function readProfileForSelectedPath(purpose, filePath) {
	if (purpose === 'project'
		&& PROJECT_EXTENSION_SET.has(extname(String(filePath || '')).toLowerCase())
		&& mimeTypeForPath(filePath) === SCAPE_PROJECT_MIME_TYPE) return READ_PROFILE_SCAPE_RANGE_V1;
	return acceptsFile(purpose, filePath) ? READ_PROFILE_SELECTED_RANGE_V1 : READ_PROFILE_MATERIALIZED_V1;
}

export function registerSelectedReadCapability(store, filePath, { owner, purpose, originalFiles } = {}) {
	if (!store || typeof store !== 'object') throw new TypeError('A desktop read capability store is required');
	if (!acceptsFile(purpose, filePath)) throw new TypeError('The selected file type is not allowed');
	const profile = readProfileForSelectedPath(purpose, filePath);
	const registered = profile === READ_PROFILE_SELECTED_RANGE_V1 ? store.registerSelectedRangePath(filePath, { owner }) : profile === READ_PROFILE_SCAPE_RANGE_V1
		? store.registerScapeRangePath(filePath, { owner })
		: store.registerMaterializedPath(filePath, { owner });
	return originalFiles ? Promise.resolve(registered).then(async (descriptor) => {
		const originalFile = await originalFiles.registerRead(descriptor.id, { owner });
		return originalFile ? Object.freeze({ ...descriptor, originalFile }) : descriptor;
	}) : registered;
}
