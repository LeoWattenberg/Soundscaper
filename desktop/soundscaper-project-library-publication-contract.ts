/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { isStrictlyHigherProjectRevision } from '../src/common/editor/project-revision-cas.ts';
import {
	SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY,
	SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
} from './soundscaper-project-library-contract.ts';
import {
	validateSoundscaperDesktopCurrentProject,
} from './soundscaper-project-library-current-project.ts';
import {
	freezeRelativeFileForSoundscaperDesktopLibraryBinding,
} from './soundscaper-project-library-media-binding.ts';
import {
	validateSoundscaperDesktopLibraryMetadata,
	type SoundscaperDesktopLibraryMetadata,
} from './soundscaper-project-library-metadata.ts';
import {
	validateSoundscaperDesktopProjectLibraryLeaseToken,
	type SoundscaperDesktopProjectLibraryLease,
} from './soundscaper-project-library-persistence-codecs.ts';
import {
	validateSoundscaperDesktopProjectLibraryTransferBody,
	validateSoundscaperDesktopProjectLibraryTransferBundle,
	type SoundscaperDesktopProjectLibraryTransferBody,
	type SoundscaperDesktopProjectLibraryTransferBundle,
} from './soundscaper-project-library-transfer-contract.ts';

export type SoundscaperDesktopProjectLibraryPublicationCheckpoint =
	| 'prepared'
	| 'materialized'
	| 'committed'
	| 'complete';

export type SoundscaperDesktopProjectLibraryPublicationRefusalCode =
	| 'compare-and-swap'
	| 'destination-presence'
	| 'revision-order';

export interface SoundscaperDesktopProjectLibraryPublicationBodyInput {
	readonly descriptor: Readonly<SoundscaperDesktopProjectLibraryTransferBody>;
	readonly chunks: AsyncIterable<Uint8Array>;
}

export interface SoundscaperDesktopProjectLibraryExpectedProject {
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export interface SoundscaperDesktopProjectLibraryPublicationRequest {
	readonly lease: SoundscaperDesktopProjectLibraryLease;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: SoundscaperDesktopProjectLibraryExpectedProject | null;
	readonly project: unknown;
	readonly bodies: readonly SoundscaperDesktopProjectLibraryPublicationBodyInput[];
}

export interface SoundscaperDesktopProjectLibraryPlannedBody {
	readonly bodyId: string;
	readonly mediaRelativeFile: string;
	readonly descriptor: Readonly<SoundscaperDesktopProjectLibraryTransferBody>;
	readonly chunks: AsyncIterable<Uint8Array>;
}

export interface SoundscaperDesktopProjectLibraryPublicationPlan {
	readonly lease: SoundscaperDesktopProjectLibraryLease;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<SoundscaperDesktopProjectLibraryExpectedProject> | null;
	readonly document: string;
	readonly entryId: string;
	readonly projectRelativeFile: string;
	readonly previousMetadata: Readonly<SoundscaperDesktopLibraryMetadata>;
	readonly nextMetadata: Readonly<SoundscaperDesktopLibraryMetadata>;
	readonly bundle: Readonly<SoundscaperDesktopProjectLibraryTransferBundle>;
	readonly bodies: readonly Readonly<SoundscaperDesktopProjectLibraryPlannedBody>[];
}

const REQUEST_FIELDS = [
	'lease', 'expectedMetadataRevision', 'expectedProject', 'project', 'bodies',
] as const;
const EXPECTED_FIELDS = ['projectRevision', 'projectSha256'] as const;
const BODY_INPUT_FIELDS = ['descriptor', 'chunks'] as const;
const MAXIMUM_BODIES = 4_094;
const DIGEST = /^[a-f0-9]{64}$/u;
const REFUSAL_CODES = ['compare-and-swap', 'destination-presence', 'revision-order'] as const;
const REFUSAL_MARKER_PREFIX = '[soundscaper-v1-project-library-publication-refusal:';
const REFUSAL_MARKER = /\[soundscaper-v1-project-library-publication-refusal:([a-z-]+)\]/u;

/**
 * An outcome main arbitrates between contending writers rather than a defect.
 * The code is carried both as a typed property and as a marker inside the
 * message, because a renderer receives only the message text of a refusal main
 * raised across IPC.
 */
export class SoundscaperDesktopProjectLibraryPublicationRefusal extends Error {
	readonly code: SoundscaperDesktopProjectLibraryPublicationRefusalCode;

	constructor(code: SoundscaperDesktopProjectLibraryPublicationRefusalCode, message: string) {
		super(`${message} ${REFUSAL_MARKER_PREFIX}${code}]`);
		this.name = 'SoundscaperDesktopProjectLibraryPublicationRefusal';
		this.code = code;
	}
}

export function soundscaperDesktopProjectLibraryPublicationRefusalCode(
	error: unknown,
): SoundscaperDesktopProjectLibraryPublicationRefusalCode | null {
	if (error instanceof SoundscaperDesktopProjectLibraryPublicationRefusal) return error.code;
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	const code = REFUSAL_MARKER.exec(message)?.[1];
	return REFUSAL_CODES.some((candidate) => candidate === code)
		? code as SoundscaperDesktopProjectLibraryPublicationRefusalCode
		: null;
}

export function planSoundscaperDesktopProjectLibraryPublication(
	value: unknown,
	currentMetadataValue: unknown,
	newEntryId: string,
	now: number,
): Readonly<SoundscaperDesktopProjectLibraryPublicationPlan> {
	const request = snapshotClosedRecord(value, REQUEST_FIELDS, 'Soundscaper desktop baseline publication');
	const lease = validateSoundscaperDesktopProjectLibraryLeaseToken(
		request.lease as SoundscaperDesktopProjectLibraryLease,
	);
	const expectedMetadataRevision = nonNegativeInteger(
		request.expectedMetadataRevision,
		'expected metadata revision',
	);
	const expectedProject = normalizeExpectedProject(request.expectedProject);
	validateSoundscaperDesktopCurrentProject(request.project);
	const document = JSON.stringify(request.project);
	if (typeof document !== 'string' || document.length === 0) {
		throw new TypeError('Soundscaper desktop baseline publication project is not JSON serializable');
	}
	const project = validateSoundscaperDesktopCurrentProject(JSON.parse(document) as unknown);
	const bodyInputs = denseArray(request.bodies, 'Soundscaper desktop baseline publication bodies', MAXIMUM_BODIES)
		.map(normalizeBodyInput);
	const currentMetadata = validateSoundscaperDesktopLibraryMetadata(currentMetadataValue);
	if (currentMetadata.revision !== expectedMetadataRevision) {
		throw new SoundscaperDesktopProjectLibraryPublicationRefusal(
			'compare-and-swap',
			'Soundscaper desktop baseline metadata revision failed compare-and-swap',
		);
	}
	const projectId = String(project.id);
	const current = currentMetadata.projects.filter((candidate) => candidate.projectId === projectId);
	if (current.length > 1) throw new Error('Soundscaper desktop baseline metadata has duplicate project identity');
	if (expectedProject === null) {
		if (current.length !== 0) {
			throw new SoundscaperDesktopProjectLibraryPublicationRefusal(
				'destination-presence',
				'Soundscaper desktop baseline expected an absent project',
			);
		}
	} else {
		if (current.length !== 1 || current[0]!.projectRevision !== expectedProject.projectRevision
			|| current[0]!.sha256 !== expectedProject.projectSha256) {
			throw new SoundscaperDesktopProjectLibraryPublicationRefusal(
				'compare-and-swap',
				'Soundscaper desktop baseline expected project failed compare-and-swap',
			);
		}
		if (!isStrictlyHigherProjectRevision(project.revision, expectedProject.projectRevision)) {
			throw new SoundscaperDesktopProjectLibraryPublicationRefusal(
				'revision-order',
				'Soundscaper desktop baseline publication requires a strictly higher project revision',
			);
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
		schemaFamily: SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY,
		schemaVersion: SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
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
				throw new Error('Soundscaper desktop baseline freeze metadata binding conflicts with existing inventory');
			}
		} else media.push(candidate);
	}
	const nextMetadata = validateSoundscaperDesktopLibraryMetadata({
		schemaVersion: 1,
		revision: increment(expectedMetadataRevision, 'metadata revision'),
		projects: [...currentMetadata.projects.filter((candidate) => candidate.projectId !== projectId), projectRow],
		media,
	});
	const bundle = validateSoundscaperDesktopProjectLibraryTransferBundle({
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
): Readonly<SoundscaperDesktopProjectLibraryExpectedProject> | null {
	if (value === null) return null;
	const record = snapshotClosedRecord(value, EXPECTED_FIELDS, 'Soundscaper desktop baseline expected project');
	return Object.freeze({
		projectRevision: nonNegativeInteger(record.projectRevision, 'expected project revision'),
		projectSha256: digest(record.projectSha256, 'expected project'),
	});
}

function normalizeBodyInput(value: unknown): SoundscaperDesktopProjectLibraryPublicationBodyInput {
	const record = snapshotClosedRecord(value, BODY_INPUT_FIELDS, 'Soundscaper desktop baseline publication body');
	const descriptor = validateSoundscaperDesktopProjectLibraryTransferBody(record.descriptor);
	const chunks = record.chunks;
	if (!chunks || (typeof chunks !== 'object' && typeof chunks !== 'function')
		|| typeof (chunks as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function') {
		throw new TypeError('Soundscaper desktop baseline publication body requires an async byte stream');
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
		throw new TypeError(`Soundscaper desktop baseline ${label} digest is invalid`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Soundscaper desktop baseline ${label} must be a non-negative safe integer`);
	}
	return value;
}

function increment(value: number, label: string): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError(`Soundscaper desktop baseline ${label} cannot advance`);
	return value + 1;
}
