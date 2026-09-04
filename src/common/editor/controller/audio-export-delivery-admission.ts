/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectTrackFolderMediaStateV12 } from '../track-folder-media-runtime.ts';
import {
	assertAudioRenderedFallbackExportSettings,
	projectForAudioRenderedFallbackExport,
} from './audio-rendered-fallback-export.ts';

/** The runtime an audio export admission reads. */
export interface AudioExportAdmissionRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = AudioExportAdmissionRuntime[string];

export interface AudioExportAdmission {
	readonly canonicalProject: RuntimeValue;
	readonly delivery: RuntimeValue;
	readonly settings: RuntimeValue;
	readonly deliveredProject: RuntimeValue;
	/** Whether the delivered project has any material to render. */
	readonly hasMaterial: boolean;
	/** Whether the render needs local sources the project cannot currently reach. */
	readonly localSourcesMissing: boolean;
}

/**
 * Resolve which project an audio export actually delivers, and whether it can be rendered.
 *
 * Starting an export and deriving a persistent delivery plan ask the same five questions in
 * the same order, and answered them separately until they shared this. They still differ in
 * what they do with a "no" — one returns quietly where the other throws — so the two refusal
 * conditions are reported rather than raised here.
 */
export function admitAudioExportDelivery(
	runtime: AudioExportAdmissionRuntime,
	requestedSettings: RuntimeValue,
): AudioExportAdmission {
	const { getProject, hasMissingTimelineSources, normalizeExportSettings, playbackProjects } = runtime;
	const canonicalProject = getProject();
	const delivery = projectForAudioRenderedFallbackExport(canonicalProject, playbackProjects);
	const settings = normalizeExportSettings(requestedSettings || {});
	assertAudioRenderedFallbackExportSettings(delivery, settings);
	const deliveredProject = projectTrackFolderMediaStateV12(delivery.project);
	return Object.freeze({
		canonicalProject,
		delivery,
		settings,
		deliveredProject,
		hasMaterial: Boolean(deliveredProject.clips.length),
		// The whole-mix role renders from its verified provider alone; the track role still
		// mixes native lanes, so their sources must be present.
		localSourcesMissing: delivery.audioRenderedFallback?.role !== 'project-audio-mix-v1'
			&& Boolean(hasMissingTimelineSources()),
	});
}
