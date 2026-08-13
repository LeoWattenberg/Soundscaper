/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17ValidationOptions,
} from '../common/editor/project-v17-validation.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	framescaperProjectFeatureRequirementsForV17Foundation,
	validateFramescaperProjectFeatureRequirementsV18,
} from './editor-project-feature-requirements-v18.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	validateFramescaperSubsequencesV18,
	type FramescaperSubsequenceV18,
} from './editor-project-v18-subsequence.ts';

export const FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION = 18 as const;

export interface FramescaperProjectV18 extends Record<string, unknown> {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly schemaVersion: 18;
	readonly sampleRate: number;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly FramescaperProjectSourceV18[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly sequences: readonly (Readonly<Record<string, unknown>> & {
		readonly id: string;
		readonly rate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly trackIds: readonly string[];
	})[];
	readonly primarySequenceId: string;
	readonly subsequences: readonly FramescaperSubsequenceV18[];
}

export type FramescaperProjectSourceV18 = Readonly<Record<string, unknown>> & (
	| { readonly kind: 'video'; readonly proxyAttachment: Readonly<VideoProxyAttachmentV18> | null }
	| { readonly kind: 'audio' }
);

export type FramescaperProjectV18ValidationOptions = AudioEditorProjectV17ValidationOptions;

/** Validate exact Framescaper V18 while reusing the unchanged exact-V17 foundation. */
export function validateFramescaperProjectV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
	options: FramescaperProjectV18ValidationOptions = {},
): project is FramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	const candidate = dataRecord(project, 'Framescaper project');
	const schemaVersion = dataProperty(candidate, 'schemaVersion', 'Framescaper project');
	if (schemaVersion !== FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(schemaVersion)}.`);
	}
	const sources = dataArrayProperty(candidate, 'sources', 'Framescaper project.sources');
	const normalizedAttachments = new Map<string, Readonly<VideoProxyAttachmentV18>>();
	const v17Sources = sources.map((value, index) => {
		const source = dataRecord(value, `Framescaper project.sources[${String(index)}]`);
		const kind = dataProperty(source, 'kind', `Framescaper project.sources[${String(index)}]`);
		const v17Source = copyDataRecord(source, `Framescaper project.sources[${String(index)}]`);
		if (kind === 'video') {
			const attachment = dataProperty(
				source,
				'proxyAttachment',
				`Framescaper video source ${String(source.id)}`,
			);
			delete v17Source.proxyAttachment;
			if (attachment !== null) {
				normalizedAttachments.set(
					String(dataProperty(source, 'id', 'Framescaper video source')),
					normalizeVideoProxyAttachmentV18(attachment),
				);
			}
		} else if (kind === 'audio' && Object.hasOwn(source, 'proxyAttachment')) {
			throw new TypeError(`Framescaper audio source ${String(source.id)} must not carry proxyAttachment.`);
		}
		return v17Source;
	});
	const v17Project = copyDataRecord(candidate, 'Framescaper project');
	v17Project.schemaVersion = 17;
	v17Project.sources = v17Sources;
	v17Project.featureRequirements = framescaperProjectFeatureRequirementsForV17Foundation(
		profile,
		candidate,
	);
	validateAttachmentRelationships(candidate, sources, normalizedAttachments);
	validateAudioEditorProjectV17(v17Project, options);
	validateFramescaperSubsequencesV18(profile, candidate);
	validateFramescaperProjectFeatureRequirementsV18(profile, candidate);
	return true;
}

export function framescaperProjectV18HasProxyAttachment(project: FramescaperProjectV18): boolean {
	return project.sources.some((source) => source.kind === 'video' && source.proxyAttachment !== null);
}

function validateAttachmentRelationships(
	project: Record<string, unknown>,
	sources: readonly unknown[],
	attachments: ReadonlyMap<string, Readonly<VideoProxyAttachmentV18>>,
): void {
	if (attachments.size === 0) return;
	const sourceRecords = sources.map((value, index) => dataRecord(value, `project.sources[${String(index)}]`));
	const sourceIdentity = new Set(sourceRecords.flatMap((source) => [String(source.id), String(source.storageKey)]));
	const clips = [
		...dataArrayProperty(project, 'clips', 'project.clips'),
		...dataArrayProperty(
			dataRecord(dataProperty(project, 'projectBin', 'project'), 'project.projectBin'),
			'clips',
			'project.projectBin.clips',
		),
	].map((value, index) => dataRecord(value, `project occurrence ${String(index)}`));
	const proxyIdentity = new Map<string, string>();
	const timingIdentity = new Map<string, string>();
	for (const source of sourceRecords) {
		const sourceId = String(source.id);
		const attachment = attachments.get(sourceId);
		if (!attachment) continue;
		if (attachment.originalSha256 !== dataProperty(source, 'contentSha256', `video source ${sourceId}`)) {
			throw new RangeError(`Video source ${sourceId} proxy original digest does not match its content digest.`);
		}
		if (attachment.frameCount !== dataProperty(source, 'sourceFrameCount', `video source ${sourceId}`)) {
			throw new RangeError(`Video source ${sourceId} proxy frame count does not match its source frame count.`);
		}
		if (sourceIdentity.has(attachment.storageKey) || sourceIdentity.has(attachment.timingAsset.storageKey)) {
			throw new RangeError(`Video source ${sourceId} proxy storage collides with canonical source identity.`);
		}
		assertSharedIdentity(proxyIdentity, attachment.storageKey, [
			attachment.sha256, attachment.byteLength, attachment.mimeType,
		], 'proxy body');
		assertSharedIdentity(timingIdentity, attachment.timingAsset.storageKey, [
			attachment.timingAsset.encoding, attachment.timingAsset.sha256,
			attachment.timingAsset.byteLength, attachment.timingAsset.frameCount,
			attachment.timingAsset.timescale, attachment.timingAsset.finalFrameDurationTicks,
		], 'proxy timing body');
		const occurrences = clips.filter((clip) => clip.sourceId === sourceId);
		if (occurrences.length === 0) {
			throw new RangeError(`Video source ${sourceId} proxy attachment requires an occurrence.`);
		}
		for (const clip of occurrences) {
			if (dataProperty(clip, 'retimeMap', `video source ${sourceId} occurrence`) !== null) {
				throw new RangeError(`Video source ${sourceId} occurrence retimeMap must be null while attached.`);
			}
		}
	}
}

function assertSharedIdentity(
	identities: Map<string, string>,
	storageKey: string,
	fields: readonly unknown[],
	name: string,
): void {
	const fingerprint = JSON.stringify(fields);
	const prior = identities.get(storageKey);
	if (prior !== undefined && prior !== fingerprint) {
		throw new RangeError(`Shared ${name} ${storageKey} has conflicting identity.`);
	}
	identities.set(storageKey, fingerprint);
}

function copyDataRecord(value: Record<string, unknown>, name: string): Record<string, unknown> {
	const copy: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} cannot contain symbol properties.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		copy[key] = descriptor.value;
	}
	return copy;
}

function dataArrayProperty(value: Record<string, unknown>, key: string, name: string): readonly unknown[] {
	const candidate = dataProperty(value, key, name);
	if (!Array.isArray(candidate)) throw new TypeError(`${name} must be an array.`);
	return candidate;
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
