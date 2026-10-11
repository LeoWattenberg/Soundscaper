/* SPDX-License-Identifier: AGPL-3.0-only */

import { renameVideoMaskMatteGraphV2 } from '../video-mask-matte-name-v2.ts';
import { manageImageDevelopMasksV1, type ImageDevelopMaskManagementCommandV1 } from './image-develop-mask-management-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from './image-develop-state-v2.ts';
import { field, id, record } from './image-develop-value.ts';

export type ImageDevelopMaskManagementCommandV2 = ImageDevelopMaskManagementCommandV1
	| Readonly<{ type: 'rename'; maskId: string; name: string }>;

/** Rename changes graph metadata only. Legacy commands retain their owning rules. */
export function manageImageDevelopMasksV2(developValue: unknown,
	commandValue: unknown): ReturnType<typeof normalizeImageDevelopStateV1OrV2> {
	const develop = normalizeImageDevelopStateV1OrV2(developValue);
	const command = record(commandValue, 'mask management command2', ['type', 'maskId', 'name', 'duplicateId', 'effectIds'], ['type', 'maskId']);
	if (field(command, 'type') !== 'rename') return manageImageDevelopMasksV1(develop, command);
	const rename = record(command, 'mask rename command', ['type', 'maskId', 'name']);
	const maskId = id(field(rename, 'maskId'), 'mask rename graph ID'), selected = develop.masks.find(mask => mask.id === maskId);
	if (!selected) throw new ReferenceError('Mask rename references a missing graph.');
	const graph = renameVideoMaskMatteGraphV2(selected, field(rename, 'name'));
	return normalizeImageDevelopStateV1OrV2({ ...develop, processVersion: graph.schemaVersion === 2 ? 2 : develop.processVersion,
		masks: develop.masks.map(mask => mask.id === maskId ? graph : mask) });
}
