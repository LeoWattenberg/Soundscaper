/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectFileName } from '../../../project-file-extensions.ts';

// The workspace routes single files and dropped batches through the same
// classifier, so both reach it from this one module.
export { isProjectFileName };

const LEGACY_AUDACITY_PROJECT_PATTERN = /\.(?:aup3|aup4)$/iu;
const LABEL_PATTERN = /\.(?:srt|txt|vtt)$/iu;

export function partitionWorkspaceFiles(files) {
	const projects = [];
	const media = [];
	const labels = [];
	for (const file of files || []) {
		const name = file?.name || '';
		if (isProjectFileName(name) || LEGACY_AUDACITY_PROJECT_PATTERN.test(name)) projects.push(file);
		else if (LABEL_PATTERN.test(name)) labels.push(file);
		else media.push(file);
	}
	return { projects, media, labels };
}
