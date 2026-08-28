/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioWarpClipAuthority,
	type AudioWarpAuthorityProject,
	type AudioWarpClipAuthority,
} from '../audio-warp-clip-authority.ts';
import {
	MAXIMUM_AUDIO_WARP_TRANSIENTS,
	normalizeAudioWarpMap,
	quantizeAudioWarpTransients,
	type AudioWarpMap,
	type AudioWarpQuantizeOptions,
} from '../audio-warp-domain.ts';
import {
	normalizeAudioGrooveTemplate,
	normalizeAudioWarpGrid,
	normalizeAudioWarpRational,
	normalizeAudioWarpStrength,
	type AudioGrooveTemplate,
	type AudioGrooveTemplateInput,
	type AudioWarpGridInput,
} from '../audio-groove-template.ts';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';
import type {
	AudioEditorCommand,
	CommandObject,
} from '../commands/protocol.ts';
import {
	validateAudioEditorProjectV17,
} from '../project-v17-validation.ts';
import type { ProjectHierarchyDocument } from '../project-hierarchy-document-validation.ts';
import { isAudioWarpProjectSchema } from '../project-schema-version.ts';
import type { RationalInput } from '../timeline-time.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

export type AudioWarpAuthoringProject = ProjectHierarchyDocument & (
	| Readonly<{ readonly schemaVersion: 17; readonly schemaFamily?: never }>
	| Readonly<{ readonly schemaFamily: 'soundscaper' | 'framescaper'; readonly schemaVersion: 1 }>
);

export interface PreparedAudioWarpClipEdit {
	readonly clipId: string;
	readonly expectedClipAuthority: Readonly<AudioWarpClipAuthority>;
	readonly warpMap: Readonly<AudioWarpMap> | null;
}

export interface AudioWarpGrooveApplicationOptions {
	readonly grid: AudioWarpGridInput;
	readonly strength: RationalInput;
	readonly template: AudioGrooveTemplateInput;
	readonly grooveStrength?: RationalInput;
}

export interface AudioWarpAuthoringServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	getProject(): AudioWarpAuthoringProject;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
}

export interface AudioWarpAuthoringService {
	prepareClipEdit(clipId: string): PreparedAudioWarpClipEdit;
	setWarpMap(preparation: PreparedAudioWarpClipEdit, warpMap: unknown): unknown;
	clearWarpMap(preparation: PreparedAudioWarpClipEdit): unknown;
	quantizeTransients(
		preparation: PreparedAudioWarpClipEdit,
		transientSources: readonly RationalInput[],
		options: AudioWarpQuantizeOptions,
	): unknown;
	createGrooveTemplate(value: AudioGrooveTemplateInput): Readonly<AudioGrooveTemplate>;
	applyGrooveTemplate(
		preparation: PreparedAudioWarpClipEdit,
		transientSources: readonly RationalInput[],
		options: AudioWarpGrooveApplicationOptions,
	): unknown;
}

/** Serializable, stale-safe authoring boundary over exact audio warp maps. */
export function createAudioWarpAuthoringService(
	dependencies: AudioWarpAuthoringServiceDependencies,
): Readonly<AudioWarpAuthoringService> {
	const preparations = new WeakSet<object>();
	return Object.freeze({
		prepareClipEdit,
		setWarpMap,
		clearWarpMap,
		quantizeTransients,
		createGrooveTemplate: normalizeAudioGrooveTemplate,
		applyGrooveTemplate,
	});

	function prepareClipEdit(clipId: string): PreparedAudioWarpClipEdit {
		const project = writableProject();
		const authority = createAudioWarpClipAuthority(authorityProject(project), clipId);
		assertTrackWritable(project, authority.trackId);
		const preparation = Object.freeze({
			clipId: authority.clipId,
			expectedClipAuthority: authority,
			warpMap: authority.warpMap,
		});
		preparations.add(preparation);
		return preparation;
	}

	function setWarpMap(preparationValue: PreparedAudioWarpClipEdit, warpMapValue: unknown): unknown {
		const preparation = prepared(preparationValue);
		const project = writableProject();
		assertCurrentTrackWritable(project, preparation.clipId);
		const warpMap = normalizeAudioWarpMap(warpMapValue);
		return dependencies.commit({
			type: 'audio-warp/set',
			clipId: preparation.clipId,
			expectedClipAuthority: commandObject(preparation.expectedClipAuthority),
			warpMap: commandObject(warpMap),
		});
	}

	function clearWarpMap(preparationValue: PreparedAudioWarpClipEdit): unknown {
		const preparation = prepared(preparationValue);
		if (preparation.warpMap === null) {
			throw new RangeError(`Audio clip ${preparation.clipId} has no prepared warp map.`);
		}
		const project = writableProject();
		assertCurrentTrackWritable(project, preparation.clipId);
		return dependencies.commit({
			type: 'audio-warp/clear',
			clipId: preparation.clipId,
			expectedClipAuthority: commandObject(preparation.expectedClipAuthority),
		});
	}

	function quantizeTransients(
		preparationValue: PreparedAudioWarpClipEdit,
		transientSourceValues: readonly RationalInput[],
		optionsValue: AudioWarpQuantizeOptions,
	): unknown {
		return commitQuantization(preparationValue, transientSourceValues, optionsValue);
	}

	function applyGrooveTemplate(
		preparationValue: PreparedAudioWarpClipEdit,
		transientSourceValues: readonly RationalInput[],
		optionsValue: AudioWarpGrooveApplicationOptions,
	): unknown {
		const record = readClosedDomainRecord(
			optionsValue,
			'audio warp groove application',
			['grid', 'strength', 'template', 'grooveStrength'],
			['grid', 'strength', 'template'],
		);
		return commitQuantization(preparationValue, transientSourceValues, {
			grid: readClosedDomainField(record, 'grid', 'audio warp groove application') as AudioWarpGridInput,
			strength: readClosedDomainField(record, 'strength', 'audio warp groove application') as RationalInput,
			groove: readClosedDomainField(record, 'template', 'audio warp groove application') as AudioGrooveTemplateInput,
			...(Object.hasOwn(record, 'grooveStrength') ? {
				grooveStrength: readClosedDomainField(
					record, 'grooveStrength', 'audio warp groove application',
				) as RationalInput,
			} : {}),
		});
	}

	function commitQuantization(
		preparationValue: PreparedAudioWarpClipEdit,
		transientSourceValues: readonly RationalInput[],
		optionsValue: AudioWarpQuantizeOptions,
	): unknown {
		const preparation = prepared(preparationValue);
		if (preparation.warpMap === null) {
			throw new RangeError(`Audio clip ${preparation.clipId} has no prepared warp map.`);
		}
		const transientValues = readClosedDomainArray(
			transientSourceValues,
			'audio warp transient sources',
			0,
			MAXIMUM_AUDIO_WARP_TRANSIENTS,
		);
		const transients = Object.freeze(transientValues.map((value, index) => (
			normalizeAudioWarpRational(value, `audio warp transient source ${String(index)}`)
		)));
		const options = canonicalQuantizeOptions(optionsValue);
		quantizeAudioWarpTransients(preparation.warpMap, transients, options);
		const project = writableProject();
		assertCurrentTrackWritable(project, preparation.clipId);
		return dependencies.commit({
			type: 'audio-warp/quantize',
			clipId: preparation.clipId,
			expectedClipAuthority: commandObject(preparation.expectedClipAuthority),
			transientSources: transients,
			options: commandObject(options),
		});
	}

	function prepared(value: PreparedAudioWarpClipEdit): PreparedAudioWarpClipEdit {
		if (!value || typeof value !== 'object' || !preparations.has(value)) {
			throw new TypeError('An audio warp edit must be prepared by this service.');
		}
		return value;
	}

	function writableProject(): AudioWarpAuthoringProject {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
		const project = dependencies.getProject();
		if (!isAudioWarpProjectSchema(project)) {
			throw new RangeError('Audio warp authoring requires an exact audio-warp project schema.');
		}
		// Product v1 is admitted and validated by its selected runtime before
		// this common controller is composed and again at its atomic commit boundary.
		if (project.schemaVersion === 17) validateAudioEditorProjectV17(project);
		return project;
	}
}

function canonicalQuantizeOptions(value: AudioWarpQuantizeOptions): Readonly<AudioWarpQuantizeOptions> {
	const name = 'audio warp quantize options';
	const record = readClosedDomainRecord(
		value,
		name,
		['grid', 'strength', 'groove', 'grooveStrength'],
		['grid', 'strength'],
	);
	const grooveValue = Object.hasOwn(record, 'groove')
		? readClosedDomainField(record, 'groove', name)
		: null;
	if (grooveValue == null && Object.hasOwn(record, 'grooveStrength')) {
		throw new RangeError('Audio warp groove strength requires a groove template.');
	}
	return Object.freeze({
		grid: normalizeAudioWarpGrid(readClosedDomainField(record, 'grid', name)),
		strength: normalizeAudioWarpStrength(readClosedDomainField(record, 'strength', name)),
		...(grooveValue == null ? {} : {
			groove: normalizeAudioGrooveTemplate(grooveValue),
			grooveStrength: normalizeAudioWarpStrength(Object.hasOwn(record, 'grooveStrength')
				? readClosedDomainField(record, 'grooveStrength', name)
				: 1, 'audio groove strength'),
		}),
	});
}

function assertCurrentTrackWritable(project: AudioWarpAuthoringProject, clipId: string): void {
	const owners = project.tracks.filter((track) => (
		Array.isArray(track.clipIds) && track.clipIds.includes(clipId)
	));
	if (owners.length !== 1) throw new RangeError(`Audio warp clip ${clipId} requires one owning track.`);
	assertTrackWritable(project, String(owners[0]!.id));
}

function assertTrackWritable(project: AudioWarpAuthoringProject, trackId: string): void {
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	if (!track) throw new ReferenceError(`Unknown audio warp track: ${trackId}.`);
	if (track.locked === true) throw new RangeError(`Track ${trackId} is locked.`);
}

function authorityProject(project: AudioWarpAuthoringProject): AudioWarpAuthorityProject {
	return project as unknown as AudioWarpAuthorityProject;
}

function commandObject(value: object): CommandObject {
	return value as CommandObject;
}
