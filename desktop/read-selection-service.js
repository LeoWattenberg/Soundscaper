/* SPDX-License-Identifier: AGPL-3.0-only */

import { extname } from 'node:path';

import {
	READ_PROFILE_MATERIALIZED_V1,
	READ_PROFILE_SCAPE_RANGE_V1,
	SCAPE_PROJECT_MIME_TYPE,
} from './constants.js';
import { acceptsFile, mimeTypeForPath } from './validation.js';

export function readProfileForSelectedPath(purpose, filePath) {
	return purpose === 'project'
		&& extname(String(filePath || '')).toLowerCase() === '.scape'
		&& mimeTypeForPath(filePath) === SCAPE_PROJECT_MIME_TYPE
		? READ_PROFILE_SCAPE_RANGE_V1
		: READ_PROFILE_MATERIALIZED_V1;
}

export function registerSelectedReadCapability(store, filePath, { owner, purpose } = {}) {
	if (!store || typeof store !== 'object') throw new TypeError('A desktop read capability store is required');
	if (!acceptsFile(purpose, filePath)) throw new TypeError('The selected file type is not allowed');
	const profile = readProfileForSelectedPath(purpose, filePath);
	return profile === READ_PROFILE_SCAPE_RANGE_V1
		? store.registerScapeRangePath(filePath, { owner })
		: store.registerMaterializedPath(filePath, { owner });
}
