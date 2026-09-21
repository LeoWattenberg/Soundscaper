/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeCycleCapturePassIdentities } from './take-cycle-capture-validation.ts';
import { takeCycleStableId } from '../../take-cycle-value-validation.ts';

export type TakeCycleIdentityKind = 'envelope' | 'group' | 'lane' | 'take' | 'media' | 'journal';
export type TakeCycleCreatedIdentityKind = Exclude<TakeCycleIdentityKind, 'group'>;
export type TakeCycleIdentityFactory = (kind: TakeCycleCreatedIdentityKind) => string;

export function registerFreshTakeCycleIdentity(
	value: string,
	kind: TakeCycleIdentityKind,
	identities: Set<string>,
): string {
	const id = takeCycleStableId(value, `take cycle ${kind} ID`);
	if (identities.has(id)) throw new RangeError(`Take cycle ${kind} ID ${id} is not globally fresh.`);
	identities.add(id);
	return id;
}

export function createTakeCyclePassIdentityAllocator(
	createId: TakeCycleIdentityFactory,
	identities: Set<string>,
): (passIndex: number, firstLaneId: string) => TakeCycleCapturePassIdentities {
	return (passIndex, firstLaneId) => Object.freeze({
		laneId: passIndex === 0
			? firstLaneId
			: registerFreshTakeCycleIdentity(createId('lane'), 'lane', identities),
		takeId: registerFreshTakeCycleIdentity(createId('take'), 'take', identities),
		mediaId: registerFreshTakeCycleIdentity(createId('media'), 'media', identities),
		journalId: registerFreshTakeCycleIdentity(createId('journal'), 'journal', identities),
	});
}
