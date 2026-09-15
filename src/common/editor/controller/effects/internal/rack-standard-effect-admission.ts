/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeEffect, updateEffect } from '../../../effects.js';
import { isStandardEffect } from '../../../first-party-effects/standard/definition.ts';
import { standardEffectStateBytes } from '../../../first-party-effects/standard/selection-contract.ts';
import { isMixerGraphV21Surface } from '../../../mixer-graph-surface-v21.ts';
import { hasProductionMixerProjectAuthority } from '../../../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../../../terminal-channel-widths.ts';
import type { CommandObject } from '../../../commands/protocol.ts';
import type { ControllerRackEffect, RackEffectProject, RackEffectScope } from './rack-effect-service-types.ts';

function supportedWidth(value: number | undefined): number {
	return Math.min(32, Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : 2);
}

/** Match the graph's processor geometry before history or autosave can adopt a configuration. */
export function assertStandardRackEffectConfiguration(project: RackEffectProject, scope: RackEffectScope,
	targetId: string | null, effect: ControllerRackEffect, engineSampleRate?: number): void {
	if (!isStandardEffect(effect.type)) return;
	const normalized = normalizeEffect(effect) as ControllerRackEffect;
	const production = hasProductionMixerProjectAuthority(project)
		|| (isMixerGraphV21Surface(project.mixer) && Array.isArray(project.automationLanes));
	const masterWidth = supportedWidth(project.masterChannels);
	const widths = resolveTerminalChannelWidths(project, production ? masterWidth : 2);
	let channels: number;
	if (scope === 'track') channels = widths.tracks.get(String(targetId)) ?? (production ? masterWidth : 2);
	else if (production) {
		const buses = scope === 'group' ? project.mixer?.groups : project.mixer?.sends;
		channels = scope === 'master' ? masterWidth : supportedWidth(buses?.find((bus) => String(bus.id) === String(targetId))?.channelCount);
	} else channels = Math.min(32, Math.max(2, masterWidth, ...widths.tracks.values()));
	standardEffectStateBytes(effect.type, normalized.params, project.sampleRate ?? engineSampleRate ?? 48000, channels);
}

/** Type replacement and partial parameters follow the same normalization as the rack command. */
export function assertStandardRackEffectUpdate(project: RackEffectProject, scope: RackEffectScope,
	targetId: string | null, effect: ControllerRackEffect, changes: CommandObject, engineSampleRate?: number): void {
	if (!isStandardEffect(String(changes.type || effect.type))) return;
	assertStandardRackEffectConfiguration(project, scope, targetId,
		updateEffect(effect, changes) as ControllerRackEffect, engineSampleRate);
}
