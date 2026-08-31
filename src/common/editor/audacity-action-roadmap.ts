/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDACITY_ACTION_ROADMAP_DISPOSITION = Object.freeze({
	IMPLEMENTED: 'implemented',
	PLANNED: 'planned',
	BLOCKED: 'blocked',
	JUSTIFIED_EXCLUDED: 'justified-excluded',
} as const);

export type AudacityActionRoadmapDisposition = (
	typeof AUDACITY_ACTION_ROADMAP_DISPOSITION
)[keyof typeof AUDACITY_ACTION_ROADMAP_DISPOSITION];

export interface AudacityActionRoadmapContract {
	readonly roadmapDisposition: AudacityActionRoadmapDisposition;
	readonly roadmapMilestone?: string;
	readonly blockedThroughMilestone?: number;
}

interface AudacityActionDefinitionInput {
	readonly id: string;
	readonly label: string;
	readonly locations: string | readonly string[];
	readonly handler: string | null;
	readonly enableWhen: string;
	readonly shortcut: string | null;
	readonly status: 'implemented' | 'disabled-upstream' | 'excluded';
	readonly upstreamAction: string;
	readonly upstreamSource: string | null;
	readonly origin: 'upstream' | 'local';
	readonly reason?: Readonly<{ en: string; de: string; catalogKey: string }>;
	readonly menuVisible?: boolean;
}

const midiActionIds = Object.freeze(['export-midi', 'midi-device-info', 'local://midi-track']);

export const AUDACITY_MIDI_FENCE = Object.freeze({
	actionIds: midiActionIds,
	disposition: AUDACITY_ACTION_ROADMAP_DISPOSITION.PLANNED,
	roadmapMilestone: '8B',
});

const midiActionIdSet = new Set<string>(midiActionIds);

const plannedActionMilestones: Readonly<Record<string, string>> = Object.freeze({
	insert: '3',
	'project-properties': '3',
	'select-previous-clip-boundary-to-cursor': '3',
	'select-cursor-to-next-clip-boundary': '3',
	'select-previous-clip': '3',
	'select-next-clip': '3',
	'menu-selection-spectral': '3',
	'toggle-spectral-selection': '3',
	'skip-to-selection-start': '3',
	'skip-to-selection-end': '3',
	'toggle-sound-activated-recording': '3',
	'set-sound-activation-level': '3',
	'menu-align': '3',
	'align-end-to-end': '3',
	'align-together': '3',
	'align-start-to-zero': '3',
	'align-start-to-playhead': '3',
	'align-start-to-selection-end': '3',
	'align-end-to-playhead': '3',
	'align-end-to-selection-end': '3',
	'menu-sort': '3',
	'sort-by-time': '3',
	'sort-by-name': '3',
	'spectral-brush': '3',
	'raw-data-import': '3',
	'local://select-no-tracks': '3',
	'local://mute-all': '3',
	'local://unmute-all': '3',
	'local://repeat-generator': '3',
	'local://repeat-analyzer': '3',
	'local://silence-finder': '7',
	'local://sound-finder': '7',
	'regular-interval-labels': '3',
	'device-info': '5',
	'action://playback/change-api': '5',
	'action://playback/change-playback-device': '5',
	'action://playback/change-recording-device': '5',
	'action://playback/change-input-channels': '5',
	'action://effects/toggle_vendor_ui': '5',
	'plugin-manager': '5',
	'audio-setup': '5',
	'audio-settings': '5',
	'rescan-devices': '5',
	log: '9',
	'crash-report': '9',
	'frame-statistics': '9',
	'menu-diagnostics': '9',
	'diagnostic-show-actions': '9',
	'diagnostic-show-paths': '9',
	'diagnostic-show-graphicsinfo': '9',
	'diagnostic-save-diagnostic-files': '9',
});

const justifiedDisabledActionIds = new Set([
	'apply-macros-palette',
	'macro-fade-ends',
	'macro-mp3-conversion',
	'menu-macros',
	'reset-configuration',
]);

export function audacityActionRoadmapContract(
	id: string,
	runtimeStatus: 'implemented' | 'disabled-upstream' | 'excluded',
): AudacityActionRoadmapContract {
	if (runtimeStatus === 'implemented') {
		return { roadmapDisposition: AUDACITY_ACTION_ROADMAP_DISPOSITION.IMPLEMENTED };
	}
	if (midiActionIdSet.has(id)) {
		return {
			roadmapDisposition: AUDACITY_MIDI_FENCE.disposition,
			roadmapMilestone: AUDACITY_MIDI_FENCE.roadmapMilestone,
		};
	}
	const roadmapMilestone = plannedActionMilestones[id];
	if (roadmapMilestone) {
		return {
			roadmapDisposition: AUDACITY_ACTION_ROADMAP_DISPOSITION.PLANNED,
			roadmapMilestone,
		};
	}
	if (runtimeStatus === 'excluded' || justifiedDisabledActionIds.has(id)) {
		return { roadmapDisposition: AUDACITY_ACTION_ROADMAP_DISPOSITION.JUSTIFIED_EXCLUDED };
	}
	throw new Error(`Disabled Audacity action ${id} has no roadmap disposition.`);
}

export function createAudacityActionDefinition({
	id,
	label,
	locations,
	handler,
	enableWhen,
	shortcut,
	status,
	upstreamAction,
	upstreamSource,
	origin,
	reason,
	menuVisible,
}: AudacityActionDefinitionInput) {
	return {
		id,
		label,
		locations: Array.isArray(locations) ? locations : [locations],
		shortcut,
		handler,
		enableWhen,
		status,
		upstreamAction,
		upstreamSource,
		origin,
		...(reason ? { reason } : {}),
		...(menuVisible === false ? { menuVisible: false } : {}),
		...audacityActionRoadmapContract(id, status),
	};
}
