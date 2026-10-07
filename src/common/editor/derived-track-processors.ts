/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyDerivedTrackEffectAutomation } from './derived-track-effect-automation.ts';

/** Split into new track copies the source processor chain without sharing identities. */
export function copyDerivedTrackProcessors<Effect extends Readonly<{ id: string }>>(
	project: object,
	sourceTrack: Readonly<{ id: string; effects?: readonly Effect[] }>,
	targetTrackId: string,
	createId: (prefix: string) => string,
) {
	const effects = (sourceTrack.effects ?? []).map(effect => ({ ...structuredClone(effect), id: createId('effect') }));
	const effectIds = new Map((sourceTrack.effects ?? []).map((effect, index) => [effect.id, effects[index]!.id]));
	return { effects, commands: copyDerivedTrackEffectAutomation(project, sourceTrack.id, targetTrackId, effectIds, createId) };
}
