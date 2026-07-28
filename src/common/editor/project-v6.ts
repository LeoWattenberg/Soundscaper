import {
	AUDIO_EDITOR_MEDIA_KINDS as V5_MEDIA_KINDS,
	AUDIO_EDITOR_TRACK_TYPES as V5_TRACK_TYPES,
	createAudioClipV5,
	createAudioEditorProjectV5,
	createAudioSourceV5,
	createAudioTrackV5,
	createLabelTrackV5,
	createMediaClipV5,
	createMediaSourceV5,
	createMediaTrackV5,
	createProjectBinV5,
	createVideoClipV5,
	createVideoSourceV5,
	createVideoTrackV5,
	validateAudioEditorProjectV5,
} from './project-v5.js';
import {
	normalizeProjectBextMetadata,
	validateProjectBextMetadata,
	type ProjectBextMetadata,
	type ProjectBextMetadataInput,
} from './project-bext-metadata.ts';
import { normalizeIxmlMetadata, type IxmlMetadata, type IxmlMetadataInput } from './ixml.ts';
import { normalizeCartMetadata, type CartMetadata, type CartMetadataInput } from './cart-metadata.ts';

export {
	normalizeProjectBextMetadata,
	type ProjectBextMetadata,
	type ProjectBextMetadataInput,
} from './project-bext-metadata.ts';

export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = 6;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;
export const AUDIO_EDITOR_MEDIA_KINDS = V5_MEDIA_KINDS;
export const AUDIO_EDITOR_TRACK_TYPES = V5_TRACK_TYPES;

export interface AudioEditorProjectMetadataV6 {
	readonly title: string;
	readonly artist: string;
	readonly album: string;
	readonly trackNumber: string;
	readonly year: string;
	readonly comments: string;
	readonly tags: Readonly<Record<string, string>>;
	readonly bext: ProjectBextMetadata | null;
	readonly ixml?: IxmlMetadata | null;
	readonly cart?: CartMetadata | null;
}

export interface AudioEditorProjectV6 {
	readonly schemaVersion: 6;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly metadata: AudioEditorProjectMetadataV6;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin: Readonly<Record<string, unknown>> & {
		readonly clips: readonly Readonly<Record<string, unknown>>[];
	};
	readonly [extension: string]: unknown;
}

export interface AudioEditorProjectV6Options {
	readonly metadata?: Readonly<Record<string, unknown>> & {
		readonly bext?: ProjectBextMetadataInput | null;
		readonly ixml?: IxmlMetadataInput | null;
		readonly cart?: CartMetadataInput | null;
	};
	readonly [option: string]: unknown;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export const createAudioSourceV6 = createAudioSourceV5;
export const createVideoSourceV6 = createVideoSourceV5;
export const createMediaSourceV6 = createMediaSourceV5;
export const createAudioClipV6 = createAudioClipV5;
export const createVideoClipV6 = createVideoClipV5;
export const createMediaClipV6 = createMediaClipV5;
export const createAudioTrackV6 = createAudioTrackV5;
export const createVideoTrackV6 = createVideoTrackV5;
export const createLabelTrackV6 = createLabelTrackV5;
export const createMediaTrackV6 = createMediaTrackV5;
export const createProjectBinV6 = createProjectBinV5;

export function createAudioEditorProjectV6(options: AudioEditorProjectV6Options = {}): AudioEditorProjectV6 {
	const project = createAudioEditorProjectV5(options);
	const metadata = objectValue(project.metadata, 'project.metadata');
	const inputBext = options.metadata?.bext;
	const inputIxml = options.metadata?.ixml;
	const inputCart = options.metadata?.cart;
	const bext = inputBext == null ? null : normalizeProjectBextMetadata(inputBext);
	return {
		...project,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		metadata: {
			title: String(metadata.title),
			artist: String(metadata.artist),
			album: String(metadata.album),
			trackNumber: String(metadata.trackNumber),
			year: String(metadata.year),
			comments: String(metadata.comments),
			tags: objectValue(metadata.tags, 'project.metadata.tags') as Record<string, string>,
			bext,
			...(inputIxml == null ? {} : { ixml: normalizeIxmlMetadata(inputIxml) }),
			...(inputCart == null ? {} : { cart: normalizeCartMetadata(inputCart) }),
		},
	} as unknown as AudioEditorProjectV6;
}

export function cloneAudioEditorProjectV6(project: AudioEditorProjectV6): AudioEditorProjectV6 {
	return clone(project);
}

export function validateAudioEditorProjectV6(project: unknown): project is AudioEditorProjectV6 {
	const candidate = objectValue(project, 'project');
	if (candidate.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${String(candidate.schemaVersion)}.`);
	}
	validateProjectBextMetadata(candidate.metadata);
	const metadata = objectValue(candidate.metadata, 'project.metadata');
	if (metadata.ixml != null) normalizeIxmlMetadata(metadata.ixml as IxmlMetadataInput);
	if (metadata.cart != null) normalizeCartMetadata(metadata.cart as CartMetadataInput);
	validateAudioEditorProjectV5(
		{ ...candidate, schemaVersion: 5 } as unknown as Parameters<typeof validateAudioEditorProjectV5>[0],
	);
	return true;
}

export function loadAudioEditorProjectV6(value: unknown): {
	project: AudioEditorProjectV6 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = objectValue(value, 'saved project');
	const schemaVersion = Number(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV6(candidate);
	const project = createAudioEditorProjectV6({
		...candidate,
		now: candidate.createdAt,
	});
	validateAudioEditorProjectV6(project);
	return {
		project,
		readOnly: false,
		reason: null,
	};
}
