/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDevelopWorkspaceV1OrV2 } from './photo-develop-workspace-v2.ts';
import { normalizePhotoDevelopWorkspaceV3, type PhotoDevelopWorkspaceV3 } from './photo-develop-workspace-v3.ts';
import type { PhotoDevelopWorkspaceV1 } from './photo-develop-workspace-v1.ts';
import type { PhotoDevelopWorkspaceV2 } from './photo-develop-workspace-v2.ts';
import { field } from './value-validation.ts';

export type PhotoDevelopWorkspaceThroughV3 = PhotoDevelopWorkspaceV1 | PhotoDevelopWorkspaceV2 | PhotoDevelopWorkspaceV3;
/** Permanent callers never inherit a future Current workspace policy. */
export function normalizePhotoDevelopWorkspaceThroughV3(value: unknown): PhotoDevelopWorkspaceThroughV3 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Photo workspace requires an own schema version.');
	const version = field(value as Readonly<Record<string, unknown>>, 'schemaVersion');
	if (version === 1 || version === 2) return normalizePhotoDevelopWorkspaceV1OrV2(value);
	if (version === 3) return normalizePhotoDevelopWorkspaceV3(value);
	throw new RangeError('Unsupported photo workspace version through3.');
}
