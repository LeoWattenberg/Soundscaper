/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	validateSoundscaperDesktopCurrentProjectV21,
} from './soundscaper-project-library-v10-current-project.ts';
import {
	freezeRelativeFileForSoundscaperDesktopLibraryBinding,
} from './soundscaper-project-library-v10-media-binding.ts';
import {
	validateSoundscaperDesktopLibraryV10Metadata,
	type SoundscaperDesktopLibraryV10Metadata,
} from './soundscaper-project-library-v10-metadata.ts';
import {
	validateSoundscaperDesktopProjectLibraryV10LeaseToken,
	type SoundscaperDesktopProjectLibraryV10Lease,
} from './soundscaper-project-library-v10-persistence-codecs.ts';
import {
	validateSoundscaperDesktopProjectLibraryV10TransferBody,
	validateSoundscaperDesktopProjectLibraryV10TransferBundle,
	type SoundscaperDesktopProjectLibraryV10TransferBody,
	type SoundscaperDesktopProjectLibraryV10TransferBundle,
} from './soundscaper-project-library-v10-transfer-contract.ts';

export type SoundscaperDesktopProjectLibraryV10PublicationCheckpoint =
	| 'prepared'
	| 'materialized'
	| 'committed'
	| 'complete';

export interface SoundscaperDesktopProjectLibraryV10PublicationBodyInput {
	readonly descriptor: Readonly<SoundscaperDesktopProjectLibraryV10TransferBody>;
	readonly chunks: AsyncIterable<Uint8Array>;
}

export interface SoundscaperDesktopProjectLibraryV10ExpectedProject {
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export interface SoundscaperDesktopProjectLibraryV10PublicationRequest {
	readonly lease: SoundscaperDesktopProjectLibraryV10Lease;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: SoundscaperDesktopProjectLibraryV10ExpectedProject | null;
	readonly project: unknown;
	readonly bodies: readonly SoundscaperDesktopProjectLibraryV10PublicationBodyInput[];
}

export interface SoundscaperDesktopProjectLibraryV10PlannedBody {
	readonly bodyId: string;
	readonly mediaRelativeFile: string;
	readonly descriptor: Readonly<SoundscaperDesktopProjectLibraryV10TransferBody>;
	readonly chunks: AsyncIterable<Uint8Array>;
}

export interface SoundscaperDesktopProjectLibraryV10PublicationPlan {
	readonly lease: SoundscaperDesktopProjectLibraryV10Lease;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<SoundscaperDesktopProjectLibraryV10ExpectedProject> | null;
	readonly document: string;
	readonly entryId: string;
	readonly projectRelativeFile: string;
	readonly previousMetadata: Readonly<SoundscaperDesktopLibraryV10Metadata>;
	readonly nextMetadata: Readonly<SoundscaperDesktopLibraryV10Metadata>;
	readonly bundle: Readonly<SoundscaperDesktopProjectLibraryV10TransferBundle>;
	readonly bodies: readonly Readonly<SoundscaperDesktopProjectLibraryV10PlannedBody>[];
}

const REQUEST_FIELDS = [
	'lease', 'expectedMetadataRevision', 'expectedProject', 'project', 'bodies',
] as const;
const EXPECTED_FIELDS = ['projectRevision', 'projectSha256'] as const;
const BODY_INPUT_FIELDS = ['descriptor', 'chunks'] as const;
const MAXIMUM_BODIES = 4_094;
const DIGEST = /^[a-f0-9]{64}$/u;

export function planSoundscaperDesktopProjectLibraryV10Publication(
	value: unknown,
	currentMetadataValue: unknown,
	newEntryId: string,
	now: number,
): Readonly<SoundscaperDesktopProjectLibraryV10PublicationPlan> {
	const request = snapshotClosedRecord(value, REQUEST_FIELDS, 'Soundscaper V10 publication');
	const lease = validateSoundscaperDesktopProjectLibraryV10LeaseToken(
		request.lease as SoundscaperDesktopProjectLibraryV10Lease,
	);
	const expectedMetadataRevision = nonNegativeInteger(
		request.expectedMetadataRevision,
		'expected metadata revision',
	);
	const expectedProject = normalizeExpectedProject(request.expectedProject);
	validateSoundscaperDesktopCurrentProjectV21(request.project);
	const document = JSON.stringify(request.project);
	if (typeof document !== 'string' || document.length === 0) {
		throw new TypeError('Soundscaper V10 publication project is not JSON serializable');
	}
	const project = validateSoundscaperDesktopCurrentProjectV21(JSON.parse(document) as unknown);
	const bodyInputs = denseArray(request.bodies, 'Soundscaper V10 publication bodies', MAXIMUM_BODIES)
		.map(normalizeBodyInput);
	const currentMetadata = validateSoundscaperDesktopLibraryV10Metadata(currentMetadataValue);
	if (currentMetadata.revision !== expectedMetadataRevision) {
		throw new Error('Soundscaper V10 metadata revision failed compare-and-swap');
	}
	const projectId = String(project.id);
	const current = currentMetadata.projects.filter((candidate) => candidate.projectId === projectId);
	if (current.length > 1) throw new Error('Soundscaper V10 metadata has duplicate project identity');
	if (expectedProject === null) {
		if (current.length !== 0) throw new Error('Soundscaper V10 expected an absent project');
	} else {
		if (current.length !== 1 || current[0]!.projectRevision !== expectedProject.projectRevision
			|| current[0]!.sha256 !== expectedProject.projectSha256) {
			throw new Error('Soundscaper V10 expected project failed compare-and-swap');
		}
		if (!isStrictlyHigherProjectRevision(project.revision, expectedProject.projectRevision)) {
			throw new Error('Soundscaper V10 publication requires a strictly higher project revision');
		}
	}
	const projectBytes = new TextEncoder().encode(document);
	const projectSha256 = createHash('sha256').update(projectBytes).digest('hex');
	const entryId = current[0]?.id ?? newEntryId;
	const projectRelativeFile = `${entryId}/${String(project.revision)}-${projectSha256}.json`;
	const projectRow = {
		id: entryId,
		projectId,
		name: String(project.title),
		metadataFile: projectRelativeFile,
		preferredProduct: 'soundscaper' as const,
		updatedAtMs: nonNegativeInteger(now, 'publication time'),
		projectSchemaVersion: 21 as const,
		projectRevision: Number(project.revision),
		byteLength: projectBytes.byteLength,
		sha256: projectSha256,
	};
	const bodies = Object.freeze(bodyInputs.map(({ descriptor, chunks }) => Object.freeze({
		bodyId: descriptor.bindingId,
		mediaRelativeFile: freezeRelativeFileForSoundscaperDesktopLibraryBinding(descriptor.bindingId),
		descriptor,
		chunks,
	})));
	const media = [...currentMetadata.media];
	for (const { descriptor } of bodies) {
		const candidate = {
			id: descriptor.bindingId,
			relativeFile: freezeRelativeFileForSoundscaperDesktopLibraryBinding(descriptor.bindingId),
			category: 'audio-freeze' as const,
			byteLength: descriptor.byteLength,
			sha256: descriptor.sha256,
		};
		const prior = media.find((row) => row.id === candidate.id);
		if (prior) {
			if (JSON.stringify(prior) !== JSON.stringify(candidate)) {
				throw new Error('Soundscaper V10 freeze metadata binding conflicts with existing inventory');
			}
		} else media.push(candidate);
	}
	const nextMetadata = validateSoundscaperDesktopLibraryV10Metadata({
		schemaVersion: 10,
		revision: increment(expectedMetadataRevision, 'metadata revision'),
		projects: [...currentMetadata.projects.filter((candidate) => candidate.projectId !== projectId), projectRow],
		media,
	});
	const bundle = validateSoundscaperDesktopProjectLibraryV10TransferBundle({
		metadataRevision: nextMetadata.revision,
		project: projectRow,
		document,
		bodies: bodies.map(({ descriptor }) => descriptor),
	}, projectId);
	return Object.freeze({
		lease,
		expectedMetadataRevision,
		expectedProject,
		document,
		entryId,
		projectRelativeFile,
		previousMetadata: currentMetadata,
		nextMetadata,
		bundle,
		bodies,
	});
}

function normalizeExpectedProject(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryV10ExpectedProject> | null {
	if (value === null) return null;
	const record = snapshotClosedRecord(value, EXPECTED_FIELDS, 'Soundscaper V10 expected project');
	return Object.freeze({
		projectRevision: nonNegativeInteger(record.projectRevision, 'expected project revision'),
		projectSha256: digest(record.projectSha256, 'expected project'),
	});
}

function normalizeBodyInput(value: unknown): SoundscaperDesktopProjectLibraryV10PublicationBodyInput {
	const record = snapshotClosedRecord(value, BODY_INPUT_FIELDS, 'Soundscaper V10 publication body');
	const descriptor = validateSoundscaperDesktopProjectLibraryV10TransferBody(record.descriptor);
	const chunks = record.chunks;
	if (!chunks || (typeof chunks !== 'object' && typeof chunks !== 'function')
		|| typeof (chunks as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function') {
		throw new TypeError('Soundscaper V10 publication body requires an async byte stream');
	}
	return Object.freeze({ descriptor, chunks: chunks as AsyncIterable<Uint8Array> });
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const snapshot = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		snapshot[field] = descriptor.value;
	}
	return snapshot;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > maximum) throw new TypeError(`${name} must be a bounded dense array`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') {
		throw new TypeError(`${name} must be a bounded dense array`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		if (keys[index] !== String(index)) throw new TypeError(`${name} must be a bounded dense array`);
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain data elements`);
		}
		result.push(descriptor.value);
	}
	return result;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) {
		throw new TypeError(`Soundscaper V10 ${label} digest is invalid`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Soundscaper V10 ${label} must be a non-negative safe integer`);
	}
	return value;
}

function isStrictlyHigherProjectRevision(nextValue: unknown, currentValue: unknown): boolean {
	return typeof nextValue === 'number' && Number.isSafeInteger(nextValue)
		&& typeof currentValue === 'number' && Number.isSafeInteger(currentValue)
		&& nextValue > currentValue;
}

function increment(value: number, label: string): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError(`Soundscaper V10 ${label} cannot advance`);
	return value + 1;
}
