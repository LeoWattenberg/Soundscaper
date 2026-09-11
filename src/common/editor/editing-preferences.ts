/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The Audio editing preference vocabulary in Audacity 4.0.0, plus the editing
 * controls Soundscaper already persisted before those preferences were ported.
 */

import { AUDIO_EDITOR_MINUTES_PRESET_PIXELS_PER_SECOND } from './timeline-zoom-limits.ts';

export const AUDIO_EDITOR_RIPPLE_MODES = Object.freeze([
	'off',
	'per-track',
	'all-tracks',
] as const);
export const AUDIO_EDITOR_DELETE_BEHAVIORS = Object.freeze([
	'not-set',
	'leave-gap',
	'close-gap',
] as const);
export const AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS = Object.freeze([
	'clip',
	'track',
	'all-tracks',
] as const);
export const AUDIO_EDITOR_PASTE_BEHAVIORS = Object.freeze([
	'overlap',
	'insert',
] as const);
export const AUDIO_EDITOR_PASTE_INSERT_BEHAVIORS = Object.freeze([
	'track',
	'all-tracks',
] as const);
export const AUDIO_EDITOR_ASYMMETRIC_STEREO_HEIGHTS = Object.freeze([
	'always',
	'workspace-dependent',
	'never',
] as const);
export const AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS = Object.freeze([
	'fit-to-width',
	'zoom-to-selection',
	'zoom-default',
	'minutes',
	'seconds',
	'5ths-of-seconds',
	'10ths-of-seconds',
	'20ths-of-seconds',
	'50ths-of-seconds',
	'100ths-of-seconds',
	'500ths-of-seconds',
	'milliseconds',
	'samples',
	'four-pixels-per-sample',
	'max-zoom',
] as const);

export type AudioEditorRippleMode = typeof AUDIO_EDITOR_RIPPLE_MODES[number];
export type AudioEditorDeleteBehavior = typeof AUDIO_EDITOR_DELETE_BEHAVIORS[number];
export type AudioEditorCloseGapBehavior = typeof AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS[number];
export type AudioEditorPasteBehavior = typeof AUDIO_EDITOR_PASTE_BEHAVIORS[number];
export type AudioEditorPasteInsertBehavior = typeof AUDIO_EDITOR_PASTE_INSERT_BEHAVIORS[number];
export type AudioEditorAsymmetricStereoHeights = typeof AUDIO_EDITOR_ASYMMETRIC_STEREO_HEIGHTS[number];
export type AudioEditorZoomTogglePreset = typeof AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS[number];

export const AUDIO_EDITOR_DEFAULT_ZOOM_PRECISION = 6;
export const AUDIO_EDITOR_MINIMUM_ZOOM_PRECISION = 1;
export const AUDIO_EDITOR_MAXIMUM_ZOOM_PRECISION = 16;

export interface AudioEditorEditingPreferences {
	readonly rippleMode: AudioEditorRippleMode;
	readonly collisionBehavior: 'audacity';
	readonly snapToZeroCrossings: boolean;
	readonly zoomPrecision: number;
	readonly applyEffectsToAllAudio: boolean;
	readonly deleteBehavior: AudioEditorDeleteBehavior;
	readonly closeGapBehavior: AudioEditorCloseGapBehavior;
	readonly pasteBehavior: AudioEditorPasteBehavior;
	readonly pasteInsertBehavior: AudioEditorPasteInsertBehavior;
	readonly alwaysPasteAsNewClip: boolean;
	readonly asymmetricStereoHeights: AudioEditorAsymmetricStereoHeights;
	readonly asymmetricStereoHeightWorkspaces: string[];
	readonly alwaysConvertToMono: boolean;
	readonly zoomTogglePreset1: AudioEditorZoomTogglePreset;
	readonly zoomTogglePreset2: AudioEditorZoomTogglePreset;
}

export const DEFAULT_AUDIO_EDITOR_EDITING_PREFERENCES = Object.freeze({
	rippleMode: 'off',
	collisionBehavior: 'audacity',
	snapToZeroCrossings: false,
	zoomPrecision: AUDIO_EDITOR_DEFAULT_ZOOM_PRECISION,
	applyEffectsToAllAudio: true,
	deleteBehavior: 'not-set',
	closeGapBehavior: 'clip',
	pasteBehavior: 'overlap',
	pasteInsertBehavior: 'track',
	alwaysPasteAsNewClip: true,
	asymmetricStereoHeights: 'never',
	asymmetricStereoHeightWorkspaces: ['modern'],
	alwaysConvertToMono: false,
	zoomTogglePreset1: 'zoom-default',
	zoomTogglePreset2: 'four-pixels-per-sample',
} satisfies AudioEditorEditingPreferences);
Object.freeze(DEFAULT_AUDIO_EDITOR_EDITING_PREFERENCES.asymmetricStereoHeightWorkspaces);

function preferenceRecord(value: unknown): Record<string, unknown> {
	if (value === undefined) return {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('preferences.editing must be an object.');
	}
	return value as Record<string, unknown>;
}

function enumPreference<const Values extends readonly string[]>(
	value: unknown,
	fallback: Values[number],
	values: Values,
	name: string,
): Values[number] {
	if (value === undefined) return fallback;
	if (!values.includes(value as Values[number])) {
		throw new RangeError(`${name} has an unsupported value: ${String(value)}.`);
	}
	return value as Values[number];
}

function booleanPreference(value: unknown, fallback: boolean, name: string): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
	return value;
}

function zoomPrecisionPreference(value: unknown): number {
	if (value === undefined) return AUDIO_EDITOR_DEFAULT_ZOOM_PRECISION;
	if (typeof value !== 'number') {
		throw new TypeError('editing.zoomPrecision must be a number.');
	}
	const number = value;
	if (!Number.isSafeInteger(number)
		|| number < AUDIO_EDITOR_MINIMUM_ZOOM_PRECISION) {
		throw new RangeError(
			`editing.zoomPrecision must be a safe integer greater than or equal to ${AUDIO_EDITOR_MINIMUM_ZOOM_PRECISION}.`,
		);
	}
	if (number > AUDIO_EDITOR_MAXIMUM_ZOOM_PRECISION) {
		throw new RangeError(`editing.zoomPrecision must be at most ${AUDIO_EDITOR_MAXIMUM_ZOOM_PRECISION}.`);
	}
	return number;
}

function workspaceIdentities(value: unknown): string[] {
	if (value === undefined) {
		return [...DEFAULT_AUDIO_EDITOR_EDITING_PREFERENCES.asymmetricStereoHeightWorkspaces];
	}
	if (!Array.isArray(value)) {
		throw new TypeError('editing.asymmetricStereoHeightWorkspaces must be an array.');
	}
	const workspaces = value.map((workspace, index) => {
		if (typeof workspace !== 'string' || !workspace.trim()) {
			throw new TypeError(`editing.asymmetricStereoHeightWorkspaces[${index}] must be a non-empty string.`);
		}
		return workspace;
	});
	if (new Set(workspaces).size !== workspaces.length) {
		throw new RangeError('editing.asymmetricStereoHeightWorkspaces cannot contain duplicate workspace IDs.');
	}
	return workspaces;
}

/** Normalize both complete and legacy V1 editing sections into the current shape. */
export function normalizeAudioEditorEditingPreferences(value?: unknown): AudioEditorEditingPreferences {
	const editing = preferenceRecord(value);
	return {
		rippleMode: enumPreference(editing.rippleMode, 'off', AUDIO_EDITOR_RIPPLE_MODES, 'editing.rippleMode'),
		collisionBehavior: enumPreference(editing.collisionBehavior, 'audacity', ['audacity'] as const, 'editing.collisionBehavior'),
		snapToZeroCrossings: booleanPreference(editing.snapToZeroCrossings, false, 'editing.snapToZeroCrossings'),
		zoomPrecision: zoomPrecisionPreference(editing.zoomPrecision),
		applyEffectsToAllAudio: booleanPreference(editing.applyEffectsToAllAudio, true, 'editing.applyEffectsToAllAudio'),
		deleteBehavior: enumPreference(editing.deleteBehavior, 'not-set', AUDIO_EDITOR_DELETE_BEHAVIORS, 'editing.deleteBehavior'),
		closeGapBehavior: enumPreference(editing.closeGapBehavior, 'clip', AUDIO_EDITOR_CLOSE_GAP_BEHAVIORS, 'editing.closeGapBehavior'),
		pasteBehavior: enumPreference(editing.pasteBehavior, 'overlap', AUDIO_EDITOR_PASTE_BEHAVIORS, 'editing.pasteBehavior'),
		pasteInsertBehavior: enumPreference(editing.pasteInsertBehavior, 'track', AUDIO_EDITOR_PASTE_INSERT_BEHAVIORS, 'editing.pasteInsertBehavior'),
		alwaysPasteAsNewClip: booleanPreference(editing.alwaysPasteAsNewClip, true, 'editing.alwaysPasteAsNewClip'),
		asymmetricStereoHeights: enumPreference(
			editing.asymmetricStereoHeights,
			'never',
			AUDIO_EDITOR_ASYMMETRIC_STEREO_HEIGHTS,
			'editing.asymmetricStereoHeights',
		),
		asymmetricStereoHeightWorkspaces: workspaceIdentities(editing.asymmetricStereoHeightWorkspaces),
		alwaysConvertToMono: booleanPreference(editing.alwaysConvertToMono, false, 'editing.alwaysConvertToMono'),
		zoomTogglePreset1: enumPreference(
			editing.zoomTogglePreset1,
			'zoom-default',
			AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS,
			'editing.zoomTogglePreset1',
		),
		zoomTogglePreset2: enumPreference(
			editing.zoomTogglePreset2,
			'four-pixels-per-sample',
			AUDIO_EDITOR_ZOOM_TOGGLE_PRESETS,
			'editing.zoomTogglePreset2',
		),
	};
}

/** Validate present fields while permitting fields absent from legacy V1 data. */
export function validateAudioEditorEditingPreferences(value: unknown): true {
	normalizeAudioEditorEditingPreferences(value);
	return true;
}

export interface AudioEditorDefaultDeleteRoute {
	readonly rippleMode: 'none' | 'clip' | 'track';
	readonly allTracks: boolean;
}

export function resolveAudioEditorDefaultDelete(
	editing?: Partial<AudioEditorEditingPreferences>,
): AudioEditorDefaultDeleteRoute {
	const normalized = normalizeAudioEditorEditingPreferences(editing);
	if (normalized.deleteBehavior === 'not-set') {
		throw new Error('The default delete behavior has not been chosen.');
	}
	if (normalized.deleteBehavior === 'leave-gap') return { rippleMode: 'none', allTracks: false };
	switch (normalized.closeGapBehavior) {
	case 'clip': return { rippleMode: 'clip', allTracks: false };
	case 'track': return { rippleMode: 'track', allTracks: false };
	case 'all-tracks': return { rippleMode: 'track', allTracks: true };
	}
}

export type AudioEditorDefaultPasteMode = 'overlap' | 'insert-track' | 'insert-all';

export function resolveAudioEditorDefaultPaste(
	editing?: Partial<AudioEditorEditingPreferences>,
): AudioEditorDefaultPasteMode {
	const normalized = normalizeAudioEditorEditingPreferences(editing);
	if (normalized.pasteBehavior === 'overlap') return 'overlap';
	if (normalized.pasteInsertBehavior === 'track') return 'insert-track';
	return 'insert-all';
}

export interface AudioEditorZoomSelection {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface AudioEditorZoomToggleContext {
	readonly currentPixelsPerSecond: number;
	readonly sampleRate: number;
	readonly projectDurationFrames: number;
	readonly selection?: AudioEditorZoomSelection | null;
	readonly viewportWidth: number;
	readonly defaultPixelsPerSecond: number;
	readonly maximumPixelsPerSecond: number;
}

export interface AudioEditorZoomToggleResolution {
	readonly preset: AudioEditorZoomTogglePreset;
	readonly pixelsPerSecond: number;
}

function positiveFinite(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number.`);
	return value;
}

function nonNegativeFinite(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number.`);
	return value;
}

function validatedZoomContext(context: AudioEditorZoomToggleContext): AudioEditorZoomToggleContext {
	positiveFinite(context.currentPixelsPerSecond, 'currentPixelsPerSecond');
	positiveFinite(context.sampleRate, 'sampleRate');
	nonNegativeFinite(context.projectDurationFrames, 'projectDurationFrames');
	positiveFinite(context.viewportWidth, 'viewportWidth');
	positiveFinite(context.defaultPixelsPerSecond, 'defaultPixelsPerSecond');
	positiveFinite(context.maximumPixelsPerSecond, 'maximumPixelsPerSecond');
	if (context.selection) {
		nonNegativeFinite(context.selection.startFrame, 'selection.startFrame');
		nonNegativeFinite(context.selection.endFrame, 'selection.endFrame');
		if (context.selection.endFrame < context.selection.startFrame) {
			throw new RangeError('selection.endFrame must not precede selection.startFrame.');
		}
	}
	return context;
}

function pixelsPerProjectSpan(frameCount: number, context: AudioEditorZoomToggleContext): number {
	return frameCount > 0
		? context.viewportWidth * context.sampleRate / frameCount
		: context.currentPixelsPerSecond;
}

/** Resolve one Audacity zoom-preset identity to horizontal pixels per second. */
export function audioEditorZoomPresetPixelsPerSecond(
	preset: AudioEditorZoomTogglePreset,
	requestedContext: AudioEditorZoomToggleContext,
): number {
	const context = validatedZoomContext(requestedContext);
	switch (preset) {
	case 'fit-to-width': return pixelsPerProjectSpan(context.projectDurationFrames, context);
	case 'zoom-to-selection': return pixelsPerProjectSpan(
		context.selection ? context.selection.endFrame - context.selection.startFrame : 0,
		context,
	);
	case 'zoom-default': return context.defaultPixelsPerSecond;
	case 'minutes': return AUDIO_EDITOR_MINUTES_PRESET_PIXELS_PER_SECOND;
	case 'seconds': return 5;
	case '5ths-of-seconds': return 5 * 5;
	case '10ths-of-seconds': return 5 * 10;
	case '20ths-of-seconds': return 5 * 20;
	case '50ths-of-seconds': return 5 * 50;
	case '100ths-of-seconds': return 5 * 100;
	case '500ths-of-seconds': return 5 * 500;
	case 'milliseconds': return 5 * 1_000;
	case 'samples': return 44_100;
	case 'four-pixels-per-sample': return 176_400;
	case 'max-zoom': return context.maximumPixelsPerSecond;
	default: throw new RangeError(`Unsupported zoom-toggle preset: ${String(preset)}.`);
	}
}

/** Match Audacity's toggle: choose the configured scale furthest away in log space. */
export function resolveAudioEditorZoomToggle(
	editing: Partial<AudioEditorEditingPreferences> | undefined,
	context: AudioEditorZoomToggleContext,
): AudioEditorZoomToggleResolution {
	const normalized = normalizeAudioEditorEditingPreferences(editing);
	const target1 = audioEditorZoomPresetPixelsPerSecond(normalized.zoomTogglePreset1, context);
	const target2 = audioEditorZoomPresetPixelsPerSecond(normalized.zoomTogglePreset2, context);
	const current = positiveFinite(context.currentPixelsPerSecond, 'currentPixelsPerSecond');
	const distance1 = Math.abs(Math.log(target1) - Math.log(current));
	const distance2 = Math.abs(Math.log(target2) - Math.log(current));
	return distance1 > distance2
		? { preset: normalized.zoomTogglePreset1, pixelsPerSecond: target1 }
		: { preset: normalized.zoomTogglePreset2, pixelsPerSecond: target2 };
}

export function resolveAudioEditorZoomToggleTarget(
	editing: Partial<AudioEditorEditingPreferences> | undefined,
	context: AudioEditorZoomToggleContext,
): number {
	return resolveAudioEditorZoomToggle(editing, context).pixelsPerSecond;
}
