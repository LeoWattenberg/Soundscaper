/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const TRACK_MIXER_LABEL_COMMAND_TYPES = [
	'track/add',
	'track/remove',
	'track/update',
	'track/reorder',
	'label/add',
	'label/update',
	'label/remove',
	'master/update',
	'mixer/bus-add',
	'mixer/bus-update',
	'mixer/bus-remove',
	'mixer/route-update',
] as const satisfies readonly AudioEditorCommandType[];

export type TrackMixerLabelCommandType = typeof TRACK_MIXER_LABEL_COMMAND_TYPES[number];
export type TrackMixerLabelCommand = Extract<AudioEditorCommand, { readonly type: TrackMixerLabelCommandType }>;
export type TrackMixerLabelCommandHandlers = DomainCommandHandlerRegistry<typeof TRACK_MIXER_LABEL_COMMAND_TYPES>;

export function defineTrackMixerLabelCommandHandlers(
	handlers: TrackMixerLabelCommandHandlers,
): Readonly<TrackMixerLabelCommandHandlers> {
	return defineDomainCommandHandlerRegistry('track/mixer/label', TRACK_MIXER_LABEL_COMMAND_TYPES, handlers);
}
