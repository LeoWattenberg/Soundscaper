/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyAudioEditorEffectPreset,
	createAudioEditorEffectPresets,
	deleteAudioEditorEffectPreset,
	exportAudioEditorEffectPreset,
	importAudioEditorEffectPresets,
	listAudioEditorEffectPresets,
	saveAudioEditorEffectPreset,
} from '../effect-presets.js';
import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	audioSelectionEffectDefaults,
	normalizeAudioSelectionEffectParams,
} from '../effects.js';

export type EffectControlParameters = Readonly<Record<string, unknown>>;

export interface EffectPreset {
	readonly id: string;
	readonly effectType: string;
	readonly name: string;
	readonly params: EffectControlParameters;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface EffectPresetCollection {
	readonly schemaVersion: 1;
	readonly presets: readonly EffectPreset[];
}

export interface EffectControlPreviewSource {
	onended: (() => void) | null;
	onerror: (() => void) | null;
	configure?(params: EffectControlParameters): unknown;
	stop(): void;
	disconnect?(): void;
}

export interface LastSelectionEffect {
	readonly type: string;
	readonly params: EffectControlParameters;
	readonly controlTrackId: string | null;
}

export interface EffectControlsState {
	audacityEffectType: string;
	audacityEffectParams: Record<string, EffectControlParameters>;
	audacityEffectTouchedParams: Map<string, Set<string>>;
	audacityPreviewSource: EffectControlPreviewSource | null;
	audacityPreviewAuditionBandId: string | number | null;
	audacityPreviewGeneration: number;
	audacityControlTrackId: string | null;
	effectPresets: EffectPresetCollection;
	lastAudacityEffect: LastSelectionEffect | null;
}

export interface EffectControlRackEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
}

interface EffectControlTrack {
	readonly id: string;
	readonly type: string;
	readonly effects?: readonly EffectControlRackEffect[];
}

interface EffectControlProject {
	readonly id: string;
	readonly tracks: readonly EffectControlTrack[];
	readonly master: Readonly<{ readonly effects?: readonly EffectControlRackEffect[] }>;
}

interface EffectControlsCopy {
	readonly audacityPreviewCancelled?: string;
	readonly audacitySelectionHint: string;
	readonly controlTrackNotFound: string;
	readonly noRepeatableEffect?: string;
	readonly rackEffectNotFound: string;
	readonly ready: string;
	readonly selectionEffectUnsupported: string;
}

export interface EffectPresetSaveOptions extends Readonly<Record<string, unknown>> {
	readonly id?: string;
	readonly name?: string;
	readonly effectType?: string;
	readonly params?: EffectControlParameters;
	readonly now?: string | number | Date;
}

export interface ApplyEffectRequest {
	readonly type?: string;
	readonly params?: EffectControlParameters;
	readonly controlTrackId?: string | null;
}

export interface EffectControlsServiceRuntime {
	readonly state: EffectControlsState;
	readonly copy: EffectControlsCopy;
	readonly createId: (prefix: string) => string;
	readonly getProject: () => EffectControlProject;
	readonly persistSetting: (
		key: string,
		value: EffectPresetCollection,
		options: Readonly<{ policy: 'required' }>,
	) => Promise<unknown>;
	readonly publishDocumentSnapshot: () => void;
	readonly setStatus: (message: string, status?: string) => void;
	readonly applySelectedAudacityEffect: () => Promise<unknown>;
	readonly captureRackNoiseProfile: (
		effect: EffectControlRackEffect,
		scope: 'master' | 'track',
		trackId: string | null,
	) => Promise<unknown> | unknown;
}

export function createEffectControlsService(runtime: EffectControlsServiceRuntime) {
	let presetMutationTail: Promise<void> = Promise.resolve();

	function enqueuePresetMutation<Result>(operation: () => Promise<Result>): Promise<Result> {
		const result = presetMutationTail.then(operation);
		presetMutationTail = result.then(() => undefined, () => undefined);
		return result;
	}

	function currentAudacityEffectParams(type = runtime.state.audacityEffectType): EffectControlParameters {
		if (!runtime.state.audacityEffectParams[type]) {
			runtime.state.audacityEffectParams[type] = audioSelectionEffectDefaults(type) as EffectControlParameters;
		}
		return runtime.state.audacityEffectParams[type]!;
	}

	function setAudacityEffectParams(
		changes: EffectControlParameters,
		options: Readonly<{ markTouched?: boolean }> = {},
	): EffectControlParameters {
		const type = runtime.state.audacityEffectType;
		const normalized = normalizeAudioSelectionEffectParams(type, {
			...currentAudacityEffectParams(),
			...changes,
		}) as EffectControlParameters;
		runtime.state.audacityEffectParams[type] = normalized;
		if (type === 'eq') runtime.state.audacityPreviewSource?.configure?.(normalized);
		if (options.markTouched !== false) {
			let touched = runtime.state.audacityEffectTouchedParams.get(type);
			if (!touched) {
				touched = new Set();
				runtime.state.audacityEffectTouchedParams.set(type, touched);
			}
			for (const name of Object.keys(changes)) touched.add(name);
		}
		return normalized;
	}

	function setAudacityEffectType(type: string): EffectControlParameters {
		if (!AUDIO_SELECTION_EFFECT_DEFINITIONS[type]) throw new Error(runtime.copy.selectionEffectUnsupported);
		if (type !== runtime.state.audacityEffectType) runtime.state.audacityPreviewAuditionBandId = null;
		runtime.state.audacityEffectType = type;
		runtime.publishDocumentSnapshot();
		return currentAudacityEffectParams(type);
	}

	function setAudacityEffectParamsFromController(
		changes: EffectControlParameters,
		options?: Readonly<{ markTouched?: boolean }>,
	): EffectControlParameters {
		const result = setAudacityEffectParams(changes, options);
		runtime.publishDocumentSnapshot();
		return result;
	}

	function setAudacityControlTrack(trackId: string | null): string | null {
		if (trackId != null && !findTrack(runtime.getProject(), trackId)) {
			throw new Error(runtime.copy.controlTrackNotFound);
		}
		runtime.state.audacityControlTrackId = trackId || null;
		runtime.publishDocumentSnapshot();
		return runtime.state.audacityControlTrackId;
	}

	function resolveInteractiveAudacityParams(
		type: string,
		params: EffectControlParameters,
		channels: readonly Float32Array[],
	): EffectControlParameters {
		if (type !== 'audacity-amplify'
			|| runtime.state.audacityEffectTouchedParams.get(type)?.has('gainDb')) return params;
		let peak = 0;
		for (const channel of channels) {
			for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
		}
		const gainDb = peak > 0
			? Math.max(-50, Math.min(50, 20 * Math.log10(1 / peak)))
			: 0;
		const resolved = normalizeAudioSelectionEffectParams(type, { ...params, gainDb }) as EffectControlParameters;
		runtime.state.audacityEffectParams[type] = resolved;
		return resolved;
	}

	async function commitEffectPresets(next: unknown): Promise<EffectPresetCollection> {
		const normalized = (createAudioEditorEffectPresets as (value: unknown) => unknown)(next) as EffectPresetCollection;
		await runtime.persistSetting('audio-editor-effect-presets-v1', normalized, { policy: 'required' });
		runtime.state.effectPresets = normalized;
		runtime.publishDocumentSnapshot();
		return normalized;
	}

	function persistEffectPresets(next: unknown): Promise<EffectPresetCollection> {
		return enqueuePresetMutation(() => commitEffectPresets(next));
	}

	function applyEffectPreset(presetId: string): EffectPreset {
		const preset = applyAudioEditorEffectPreset(runtime.state.effectPresets, presetId) as EffectPreset;
		runtime.state.audacityEffectType = preset.effectType;
		runtime.state.audacityEffectParams[preset.effectType] = structuredClone(preset.params);
		runtime.state.audacityEffectTouchedParams.set(preset.effectType, new Set(Object.keys(preset.params)));
		runtime.publishDocumentSnapshot();
		return preset;
	}

	function saveEffectPreset(options: string | EffectPresetSaveOptions = {}): Promise<EffectPreset> {
		const request: EffectPresetSaveOptions = typeof options === 'string' ? { name: options } : options;
		const effectType = request.effectType || runtime.state.audacityEffectType;
		const params = request.params || currentAudacityEffectParams(effectType);
		return enqueuePresetMutation(async () => {
			const result = saveAudioEditorEffectPreset(runtime.state.effectPresets, {
				...request,
				effectType,
				params,
				idFactory: () => runtime.createId('preset'),
			}) as Readonly<{ state: EffectPresetCollection; preset: EffectPreset }>;
			await commitEffectPresets(result.state);
			return result.preset;
		});
	}

	function deleteEffectPreset(presetId: string): Promise<true> {
		return enqueuePresetMutation(async () => {
			await commitEffectPresets(deleteAudioEditorEffectPreset(runtime.state.effectPresets, presetId));
			return true as const;
		});
	}

	function importEffectPresets(input: unknown): Promise<readonly EffectPreset[]> {
		return enqueuePresetMutation(async () => {
			const next = importAudioEditorEffectPresets(runtime.state.effectPresets, input, {
				idFactory: () => runtime.createId('preset'),
			});
			await commitEffectPresets(next);
			return (listAudioEditorEffectPresets as (
				state: EffectPresetCollection,
				effectType: string | null,
			) => unknown)(
				runtime.state.effectPresets,
				runtime.state.audacityEffectType,
			) as readonly EffectPreset[];
		});
	}

	function exportEffectPreset(presetId: string): string {
		return exportAudioEditorEffectPreset(runtime.state.effectPresets, presetId) as string;
	}

	function cancelAudacityEffectPreview(options: Readonly<{ publish?: boolean }> = {}): boolean {
		runtime.state.audacityPreviewGeneration += 1;
		const source = runtime.state.audacityPreviewSource;
		runtime.state.audacityPreviewSource = null;
		runtime.state.audacityPreviewAuditionBandId = null;
		if (source) {
			try {
				source.onended = null;
				source.onerror = null;
				source.stop();
			} catch { /* The preview may already have ended. */ }
			try { source.disconnect?.(); } catch { /* The preview may already be disconnected. */ }
		}
		if (options.publish !== false) {
			runtime.setStatus(runtime.copy.audacityPreviewCancelled || runtime.copy.ready);
			runtime.publishDocumentSnapshot();
		}
		return Boolean(source);
	}

	async function applyAudacityEffectFromController(request: ApplyEffectRequest = {}): Promise<unknown> {
		cancelAudacityEffectPreview({ publish: false });
		if (request.type) setAudacityEffectType(request.type);
		if (request.params) setAudacityEffectParamsFromController(request.params);
		if ('controlTrackId' in request) setAudacityControlTrack(request.controlTrackId ?? null);
		return runtime.applySelectedAudacityEffect();
	}

	async function repeatLastAudacityEffect(): Promise<unknown> {
		const previous = runtime.state.lastAudacityEffect;
		if (!previous) throw new Error(runtime.copy.noRepeatableEffect || runtime.copy.audacitySelectionHint);
		setAudacityEffectType(previous.type);
		setAudacityEffectParamsFromController(structuredClone(previous.params), { markTouched: false });
		if (previous.controlTrackId && findTrack(runtime.getProject(), previous.controlTrackId)) {
			setAudacityControlTrack(previous.controlTrackId);
		}
		return runtime.applySelectedAudacityEffect();
	}

	function captureRackNoiseProfileFromController(
		scope: string,
		trackId: string | null,
		effectId: string,
	): Promise<unknown> | unknown {
		const normalizedScope = scope === 'master' ? 'master' : 'track';
		const project = runtime.getProject();
		const rack = normalizedScope === 'master'
			? project.master.effects
			: findTrack(project, trackId)?.effects;
		const effect = rack?.find((candidate) => candidate.id === effectId);
		if (!effect) throw new Error(runtime.copy.rackEffectNotFound);
		return runtime.captureRackNoiseProfile(effect, normalizedScope, trackId || null);
	}

	return Object.freeze({
		applyAudacityEffectFromController,
		applyEffectPreset,
		cancelAudacityEffectPreview,
		captureRackNoiseProfileFromController,
		currentAudacityEffectParams,
		deleteEffectPreset,
		exportEffectPreset,
		importEffectPresets,
		persistEffectPresets,
		resolveInteractiveAudacityParams,
		repeatLastAudacityEffect,
		saveEffectPreset,
		setAudacityControlTrack,
		setAudacityEffectParams,
		setAudacityEffectParamsFromController,
		setAudacityEffectType,
	});
}

function findTrack(project: EffectControlProject, trackId: string | null): EffectControlTrack | null {
	return project.tracks.find((track) => track.id === trackId) ?? null;
}
