/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';

export type FramescaperClipCommandPlacement =
	| Readonly<{ readonly scope: 'timeline'; readonly trackId: string }>
	| Readonly<{ readonly scope: 'project-bin' }>;

interface PlacementAdmission {
	readonly placement: string;
	readonly projectBin: string;
	readonly timeline: string;
	readonly unsupported: string;
	readonly trackIdName: string;
	readonly field: (record: Readonly<Record<string, unknown>>, name: string) => unknown;
	readonly stableId: (value: unknown, name: string) => string;
}

/** One closed, nullable Project Bin/timeline placement admission for image and visual commands. */
export function snapshotOptionalClipPlacement(
	value: unknown,
	labels: PlacementAdmission,
): FramescaperClipCommandPlacement | null {
	if (value === null) return null;
	const discriminant = readClosedDomainRecord(value, labels.placement, ['scope', 'trackId'], ['scope']);
	const scope = labels.field(discriminant, 'scope');
	if (scope === 'project-bin') {
		readClosedDomainRecord(value, labels.projectBin, ['scope']);
		return Object.freeze({ scope });
	}
	if (scope === 'timeline') {
		const placement = readClosedDomainRecord(value, labels.timeline, ['scope', 'trackId']);
		return Object.freeze({
			scope, trackId: labels.stableId(labels.field(placement, 'trackId'), labels.trackIdName),
		});
	}
	throw new RangeError(labels.unsupported);
}
