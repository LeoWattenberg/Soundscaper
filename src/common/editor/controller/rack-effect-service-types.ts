/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { EngineEffectScope } from '../engine/public-api.ts';
import type { EditorProjectToken } from './lifecycle.ts';
import type { ParameterGestureSession } from './parameter-gesture-adapter.ts';

export type RackEffectScope = EngineEffectScope;
export type EffectParameters = Readonly<Record<string, unknown>>;
export interface ControllerRackEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly enabled: boolean;
	readonly params: EffectParameters;
	readonly context?: Readonly<Record<string, unknown>> | null;
	readonly state?: Readonly<Record<string, unknown>> | null;
	readonly bypassed?: boolean;
	readonly missing?: Readonly<Record<string, unknown>>;
	readonly opaqueAudacityNode?: unknown;
}

/** What materialising accepts: a stored effect, a clipboard entry, or a macro step naming its type. */
export interface RackEffectDraft extends Readonly<Record<string, unknown>> {
	readonly type: string;
	readonly id?: string;
	readonly enabled?: boolean;
	readonly params?: EffectParameters;
	readonly context?: Readonly<Record<string, unknown>> | null;
	readonly state?: Readonly<Record<string, unknown>> | null;
}

export interface RackEffectOwner {
	readonly id: string;
	readonly effects?: readonly ControllerRackEffect[];
}
export interface RackEffectTrack extends RackEffectOwner {
	readonly type: string;
}
export interface RackEffectProject {
	readonly id: string;
	readonly tracks: readonly RackEffectTrack[];
	readonly master?: Readonly<{ readonly effects?: readonly ControllerRackEffect[] }>;
	readonly mixer?: Readonly<{
		readonly groups?: readonly RackEffectOwner[];
		readonly sends?: readonly RackEffectOwner[];
	}>;
}

export interface AudacityNoiseProfile extends Record<string, unknown> {
	readonly meanPowers?: ArrayLike<number> | Iterable<number>;
}

export type RackEffectGestureSession = ParameterGestureSession<EffectParameters, number>;

export interface RackEffectControllerState {
	selectedTrackId: string | null;
	readOnly: boolean;
	writeAuthorityGeneration: number;
	effectClipboard: ControllerRackEffect[] | null;
	readonly rackEffectGestures: Map<string, RackEffectGestureSession>;
	readonly parametricEqGestures: Map<string, RackEffectGestureSession>;
	audacityControlTrackId: string | null;
	audacityNoiseProfile: AudacityNoiseProfile | null;
}

export interface RackEffectCopy {
	readonly effectTypeRequired: string;
	readonly selectTrackFirst: string;
	readonly audioTrackRequired: string;
	readonly effectUnsupported: string;
	readonly autoDuckOtherControlTrack: string;
	readonly noiseReductionAddedDisabled: string;
	readonly rackEffectNotFound: string;
	readonly missingEffectReadOnly: string;
	readonly projectReadOnly: string;
	readonly audioTrackNotFound: string;
	readonly pasteEffects?: string;
	readonly paste: string;
	readonly noiseProfileMissing: string;
}

export interface RackEffectPreviewEngine {
	configureRackEffect?(
		scope: RackEffectScope,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): number | false;
	configureParametricEq?(
		scope: RackEffectScope,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
		options?: Readonly<{ transitionFrames?: number }>,
	): number | false;
}

export interface RackEffectCommitOptions {
	readonly skipPlaybackEngine?: boolean;
}

export interface RackEffectServiceRuntime {
	readonly state: RackEffectControllerState;
	readonly copy: RackEffectCopy;
	readonly engine: RackEffectPreviewEngine;
	readonly getProject: () => RackEffectProject | null;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly editingBlocked: () => boolean;
	readonly commit: (
		command: AudioEditorCommand,
		selection?: Readonly<Record<string, never>>,
		options?: RackEffectCommitOptions,
	) => RackEffectProject;
	readonly handleError: (error: Error) => null;
	readonly publishDocumentSnapshot: () => void;
	readonly setStatus: (message: string, status?: string) => void;
}

export interface AddRackEffectRequest {
	readonly type?: string;
	readonly scope?: string;
	readonly trackId?: string | null;
	readonly busId?: string | null;
	readonly options?: Readonly<{
		readonly id?: string;
		readonly enabled?: boolean;
		readonly params?: EffectParameters;
		readonly context?: Readonly<Record<string, unknown>> | null;
		readonly state?: Readonly<Record<string, unknown>> | null;
	}>;
}

export interface MaterializeRackEffectOptions {
	readonly forceEnabled?: boolean;
	readonly requireNoiseProfile?: boolean;
}

