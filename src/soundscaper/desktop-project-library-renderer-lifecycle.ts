/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { soundscaperProjectClone } from './editor-project-profile.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';
import {
	validateSoundscaperDesktopProjectId,
	type SoundscaperDesktopBundleSnapshot,
	type SoundscaperDesktopCatalogSnapshot,
} from './desktop-project-library-renderer-contract.ts';

const DUPLICATE_FIELDS = ['id', 'title', 'timestamp'] as const;
const MAXIMUM_TITLE_BYTES = 1_024;

export function createSoundscaperDesktopRendererOperationId(): string {
	if (typeof globalThis.crypto?.randomUUID !== 'function') {
		throw new Error('A cryptographic renderer operation identity is required for document reconciliation.');
	}
	return `desktop-v1:${globalThis.crypto.randomUUID()}`;
}

export function createSoundscaperDesktopPublicationId(): string {
	if (typeof globalThis.crypto?.getRandomValues !== 'function') {
		throw new Error('A cryptographic renderer publication identity is required.');
	}
	return [...globalThis.crypto.getRandomValues(new Uint8Array(24))]
		.map((value) => value.toString(16).padStart(2, '0')).join('');
}

export interface SoundscaperDesktopDuplicateOptions {
	readonly id: string;
	readonly title: string;
	readonly timestamp: string;
}

export type SoundscaperDesktopWitness = Readonly<{
	readonly kind: 'absent';
	readonly expectedMetadataRevision: number;
}> | SoundscaperDesktopCurrentWitness;

export type SoundscaperDesktopCurrentWitness = Readonly<{
	readonly kind: 'current';
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<{ readonly projectRevision: number; readonly projectSha256: string }>;
	readonly project: SoundscaperProject;
}>;

/** Private one-use project witnesses rebased only by a validated local catalog mutation. */
export class SoundscaperDesktopWitnessLedger {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #witnesses = new Map<string, SoundscaperDesktopWitness>();

	constructor(profile: EditorProjectRuntimeProfile) { this.#profile = profile; }

	rememberAbsent(projectId: string, metadataRevision: number): void {
		this.#witnesses.set(projectId, Object.freeze({ kind: 'absent', expectedMetadataRevision: metadataRevision }));
	}

	rememberCurrent(snapshot: Readonly<SoundscaperDesktopBundleSnapshot>): void {
		this.#witnesses.set(snapshot.bundle.project.projectId, currentWitness(this.#profile, snapshot));
	}

	take(projectId: string): SoundscaperDesktopWitness {
		const witness = this.#witnesses.get(projectId);
		if (!witness) throw new Error('An authoritative desktop  load witness is required before mutation.');
		this.#witnesses.delete(projectId);
		return witness;
	}

	takeCurrent(projectId: string): SoundscaperDesktopCurrentWitness {
		const witness = this.take(projectId);
		if (witness.kind !== 'current') throw new Error('A current desktop  project witness is required.');
		return witness;
	}

	commitSnapshot(
		priorMetadataRevision: number,
		snapshot: Readonly<SoundscaperDesktopBundleSnapshot>,
	): void {
		this.#rebase(priorMetadataRevision, snapshot.bundle.metadataRevision, snapshot.bundle.project.projectId);
		this.rememberCurrent(snapshot);
	}

	commitDelete(projectId: string, priorMetadataRevision: number, metadataRevision: number): void {
		this.#rebase(priorMetadataRevision, metadataRevision, projectId);
		this.#witnesses.delete(projectId);
	}

	restoreCurrent(witness: SoundscaperDesktopCurrentWitness, metadataRevision: number): void {
		this.#witnesses.set(String(witness.project.id), Object.freeze({
			...witness,
			expectedMetadataRevision: metadataRevision,
		}));
	}

	observeCatalog(snapshot: Readonly<SoundscaperDesktopCatalogSnapshot>): void {
		const summaries = new Map(snapshot.projects.map((project) => [project.id, project]));
		for (const [projectId, witness] of this.#witnesses) {
			const summary = summaries.get(projectId);
			if ((witness.kind === 'absent' && summary)
				|| (witness.kind === 'current'
					&& summary?.revision !== witness.expectedProject.projectRevision)) {
				this.#witnesses.delete(projectId);
				continue;
			}
			this.#witnesses.set(projectId, Object.freeze({
				...witness,
				expectedMetadataRevision: snapshot.metadataRevision,
			}));
		}
	}

	clear(): void { this.#witnesses.clear(); }

	#rebase(from: number, to: number, excludedProjectId: string): void {
		if (to !== from + 1) {
			this.#witnesses.clear();
			return;
		}
		for (const [projectId, witness] of this.#witnesses) {
			if (projectId === excludedProjectId) continue;
			if (witness.expectedMetadataRevision !== from) {
				this.#witnesses.delete(projectId);
				continue;
			}
			this.#witnesses.set(projectId, Object.freeze({ ...witness, expectedMetadataRevision: to }));
		}
	}
}

export function validateSoundscaperDesktopDuplicateOptions(
	value: unknown,
): Readonly<SoundscaperDesktopDuplicateOptions> {
	const raw = closedRecord(value, DUPLICATE_FIELDS, 'Soundscaper desktop  duplicate options');
	if (typeof raw.title !== 'string' || !raw.title.trim()
		|| new TextEncoder().encode(raw.title).byteLength > MAXIMUM_TITLE_BYTES) {
		throw new TypeError('The Soundscaper desktop  duplicate title is invalid.');
	}
	if (typeof raw.timestamp !== 'string') throw new TypeError('The duplicate timestamp is invalid.');
	const time = Date.parse(raw.timestamp);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== raw.timestamp) {
		throw new TypeError('The duplicate timestamp is invalid.');
	}
	return Object.freeze({
		id: validateSoundscaperDesktopProjectId(raw.id),
		title: raw.title,
		timestamp: raw.timestamp,
	});
}

export function createSoundscaperDesktopDuplicateProject(
	profile: EditorProjectRuntimeProfile,
	source: SoundscaperProject,
	options: Readonly<SoundscaperDesktopDuplicateOptions>,
): SoundscaperProject {
	const value = structuredClone(source) as unknown as Record<string, unknown>;
	value.id = options.id;
	value.title = options.title;
	value.revision = 0;
	value.createdAt = options.timestamp;
	value.updatedAt = options.timestamp;
	return soundscaperProjectClone(profile, value);
}

export function sameSoundscaperDesktopProject(
	left: SoundscaperProject,
	right: SoundscaperProject,
): boolean {
	return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
}

function currentWitness(
	profile: EditorProjectRuntimeProfile,
	snapshot: Readonly<SoundscaperDesktopBundleSnapshot>,
): SoundscaperDesktopCurrentWitness {
	return Object.freeze({
		kind: 'current',
		expectedMetadataRevision: snapshot.bundle.metadataRevision,
		expectedProject: Object.freeze({
			projectRevision: snapshot.bundle.project.projectRevision,
			projectSha256: snapshot.bundle.project.sha256,
		}),
		project: soundscaperProjectClone(profile, snapshot.project),
	});
}

function closedRecord<const Field extends string>(value: unknown, fields: readonly Field[], name: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${name} must be a plain object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields.`);
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own data property.`);
		}
		result[field] = descriptor.value;
	}
	return result;
}
