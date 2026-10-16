/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAdmProjectMetadata } from '../../../adm-project-metadata.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { ControllerProject } from '../track-domain-types.ts';

interface TrackChannelRelocation {
	readonly trackId: string;
	readonly sourceChannel: number;
	readonly targetTrackId: string;
	readonly targetChannel: number;
}

/** Move authored delivery references with the existing channels a transform relocates. */
export function admChannelTransformCommands(
	project: ControllerProject,
	relocations: readonly TrackChannelRelocation[],
): readonly AudioEditorCommand[] {
	const metadata = project.metadata as Readonly<{ adm?: unknown }> | null | undefined;
	const value = metadata?.adm as Readonly<Record<string, unknown>> | null | undefined;
	if (value?.mode !== 'authored') return [];
	const adm = normalizeAdmProjectMetadata({ ...value, mode: 'authored' });
	if (adm.mode !== 'authored') return [];
	let changed = false;
	const relocate = <Reference extends Readonly<{ stripKind: string; stripId: string; sourceChannel: number }>>(
		reference: Reference,
	): Reference => {
		const relocation = reference.stripKind === 'track' ? relocations.find(candidate =>
			candidate.trackId === reference.stripId && candidate.sourceChannel === reference.sourceChannel) : undefined;
		if (!relocation) return reference;
		changed = true;
		return { ...reference, stripId: relocation.targetTrackId, sourceChannel: relocation.targetChannel };
	};
	const assignments = adm.bed.assignments.map(relocate);
	const objects = adm.objects?.map(relocate);
	return changed ? [{ type: 'metadata/update', changes: { adm: normalizeAdmProjectMetadata({
		...adm, bed: { ...adm.bed, assignments }, ...(objects ? { objects } : {}),
	}) } }] : [];
}
