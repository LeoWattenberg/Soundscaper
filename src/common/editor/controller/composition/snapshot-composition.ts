/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioEffectLabel, audioEffectTypes, audioSelectionEffectLabel, audioSelectionEffectTypes, AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../../effects.js';
import { listAudioEditorEffectPresets } from '../../effect-presets.js';
import { VIDEO_EFFECT_DEFINITIONS } from '../../video-effects.js';
import { RECORDING_DEFAULT_DEVICE_ID, RECORDING_DISPLAY_SOURCE_KEY } from '../../recording-routing.js';
import { createEditorDocumentSnapshot, createSelectionEffectTypeSnapshot, type EditorDocumentSnapshotRuntime, type SnapshotProject } from '../document/document-snapshot.ts';
import { applyVideoEffectGesturePreviews, createAudioDeviceSnapshot, createEditorTelemetrySnapshot } from './internal/snapshot-model.ts';
import { createSnapshotChannel } from './internal/snapshot-channel.ts';

type GestureProject = NonNullable<Parameters<typeof applyVideoEffectGesturePreviews>[0]>;
type BuiltSnapshotPort = 'getRackEffectTypes' | 'getVideoEffectTypes' | 'getSelectionEffectTypes'
	| 'getSelectionEffectDefinition' | 'getEffectPresets' | 'getAudioDevicesSnapshot';

export interface SnapshotCompositionDependencies<Project extends SnapshotProject & GestureProject> {
	readonly document: Omit<EditorDocumentSnapshotRuntime<Project>, BuiltSnapshotPort>;
	readonly telemetry: Parameters<typeof createEditorTelemetrySnapshot>[0];
	readonly audioDevices: Parameters<typeof createAudioDeviceSnapshot>[0];
	readonly engine: Parameters<typeof createEditorTelemetrySnapshot>[1] & Parameters<typeof createAudioDeviceSnapshot>[1];
	readonly mediaDevices: Parameters<typeof createAudioDeviceSnapshot>[2];
	readonly copy: Readonly<Record<string, string>>;
	readonly videoEffectGestures: Parameters<typeof applyVideoEffectGesturePreviews>[1];
	readonly videoEffectGestureKey: Parameters<typeof applyVideoEffectGesturePreviews>[2];
}

/** Own document and realtime channels, keeping gesture previews out of saved history. */
export function createSnapshotComposition<Project extends SnapshotProject & GestureProject>(d: SnapshotCompositionDependencies<Project>) {
	const runtime: EditorDocumentSnapshotRuntime<Project> = {
		...d.document,
		getCurrentProject: () => applyVideoEffectGesturePreviews(d.document.getCurrentProject(), d.videoEffectGestures, d.videoEffectGestureKey),
		getAudioDevicesSnapshot: () => createAudioDeviceSnapshot(d.audioDevices, d.engine, d.mediaDevices, RECORDING_DEFAULT_DEVICE_ID, RECORDING_DISPLAY_SOURCE_KEY),
		getRackEffectTypes: () => audioEffectTypes().map((type) => Object.freeze({ type, label: audioEffectLabel(type, d.copy) })),
		getVideoEffectTypes: () => Object.values(VIDEO_EFFECT_DEFINITIONS),
		getSelectionEffectTypes: () => audioSelectionEffectTypes().map(type => createSelectionEffectTypeSnapshot(type, audioSelectionEffectLabel(type, d.copy), AUDIO_SELECTION_EFFECT_DEFINITIONS[type])),
		getSelectionEffectDefinition: () => AUDIO_SELECTION_EFFECT_DEFINITIONS[d.document.state.audacityEffectType] || null,
		getEffectPresets: () => listAudioEditorEffectPresets(d.document.state.effectPresets, d.document.state.audacityEffectType),
	};
	const document = createSnapshotChannel({ build: () => createEditorDocumentSnapshot(runtime), canPublish: () => !d.document.state.disposed });
	const telemetry = createSnapshotChannel({ build: () => createEditorTelemetrySnapshot(d.telemetry, d.engine), canPublish: () => !d.document.state.disposed });
	return Object.freeze({ document, telemetry });
}
