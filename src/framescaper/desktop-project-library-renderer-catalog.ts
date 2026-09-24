/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	exactRecord, instant, nonNegative, projectIdValue_, text,
} from './desktop-project-library-renderer-validation.ts';
import type { FramescaperDesktopProjectLibraryProjectSummary } from './desktop-project-library-renderer.ts';

const CATALOG_FIELDS = ['metadataRevision', 'projects'] as const;
const SUMMARY_FIELDS = ['id', 'title', 'revision', 'updatedAt'] as const;

export function framescaperDesktopProjectCatalog(value: unknown): Readonly<{
	metadataRevision: number;
	projects: readonly Readonly<FramescaperDesktopProjectLibraryProjectSummary>[];
}> {
	const raw = exactRecord(value, CATALOG_FIELDS, 'Framescaper desktop catalog');
	if (!Array.isArray(raw.projects) || raw.projects.length > 10_000) {
		throw new TypeError('The Framescaper desktop catalog is invalid.');
	}
	return Object.freeze({
		metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'),
		projects: Object.freeze(raw.projects.map((entry) => {
			const summary = exactRecord(entry, SUMMARY_FIELDS, 'Framescaper desktop project summary');
			return Object.freeze({
				id: projectIdValue_(summary.id),
				title: text(summary.title, 'project title'),
				revision: nonNegative(summary.revision, 'project revision'),
				updatedAt: instant(summary.updatedAt),
			});
		})),
	});
}
