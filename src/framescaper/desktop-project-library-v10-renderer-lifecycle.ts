/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { cloneFramescaperProjectV18, type FramescaperProjectV18 } from './editor-project-v18.ts';
import {
	validateFramescaperDesktopV10ProjectId,
	type FramescaperDesktopV10BundleSnapshot,
	type FramescaperDesktopV10CatalogSnapshot,
} from './desktop-project-library-v10-renderer-contract.ts';

const DUPLICATE_FIELDS = ['id', 'title', 'timestamp'] as const;
const MAXIMUM_TITLE_BYTES = 1_024;

export function createFramescaperDesktopV10RendererOperationId(): string {
	if (typeof globalThis.crypto?.randomUUID !== 'function') {
		throw new Error('A cryptographic renderer operation identity is required for V18 reconciliation.');
	}
	return `desktop-v10:${globalThis.crypto.randomUUID()}`;
}

export function createFramescaperDesktopV10PublicationId(): string {
	if (typeof globalThis.crypto?.getRandomValues !== 'function') {
		throw new Error('A cryptographic renderer publication identity is required.');
	}
	return [...globalThis.crypto.getRandomValues(new Uint8Array(24))]
		.map((value) => value.toString(16).padStart(2, '0')).join('');
}

export interface FramescaperDesktopV10DuplicateOptions {
	readonly id: string;
	readonly title: string;
	readonly timestamp: string;
}

export type FramescaperDesktopV10Witness = Readonly<{
	readonly kind: 'absent';
	readonly expectedMetadataRevision: number;
}> | FramescaperDesktopV10CurrentWitness;

export type FramescaperDesktopV10CurrentWitness = Readonly<{
	readonly kind: 'current';
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<{ readonly projectRevision: number; readonly projectSha256: string }>;
	readonly project: FramescaperProjectV18;
}>;

/** Private one-use project witnesses rebased only by a validated local catalog mutation. */
export class FramescaperDesktopV10WitnessLedger {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #witnesses = new Map<string, FramescaperDesktopV10Witness>();

	constructor(profile: EditorProjectRuntimeProfile) { this.#profile = profile; }

	rememberAbsent(projectId: string, metadataRevision: number): void {
		this.#witnesses.set(projectId, Object.freeze({ kind: 'absent', expectedMetadataRevision: metadataRevision }));
	}

	rememberCurrent(snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>): void {
		this.#witnesses.set(snapshot.bundle.project.projectId, currentWitness(this.#profile, snapshot));
	}

	take(projectId: string): FramescaperDesktopV10Witness {
		const witness = this.#witnesses.get(projectId);
		if (!witness) throw new Error('An authoritative desktop V10 load witness is required before mutation.');
		this.#witnesses.delete(projectId);
		return witness;
	}

	takeCurrent(projectId: string): FramescaperDesktopV10CurrentWitness {
		const witness = this.take(projectId);
		if (witness.kind !== 'current') throw new Error('A current desktop V10 project witness is required.');
		return witness;
	}

	commitSnapshot(
		priorMetadataRevision: number,
		snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>,
	): void {
		this.#rebase(priorMetadataRevision, snapshot.bundle.metadataRevision, snapshot.bundle.project.projectId);
		this.rememberCurrent(snapshot);
	}

	commitDelete(projectId: string, priorMetadataRevision: number, metadataRevision: number): void {
		this.#rebase(priorMetadataRevision, metadataRevision, projectId);
		this.#witnesses.delete(projectId);
	}

	restoreCurrent(witness: FramescaperDesktopV10CurrentWitness, metadataRevision: number): void {
		this.#witnesses.set(String(witness.project.id), Object.freeze({
			...witness,
			expectedMetadataRevision: metadataRevision,
		}));
	}

	observeCatalog(snapshot: Readonly<FramescaperDesktopV10CatalogSnapshot>): void {
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

export function validateFramescaperDesktopV10DuplicateOptions(
	value: unknown,
): Readonly<FramescaperDesktopV10DuplicateOptions> {
	const raw = closedRecord(value, DUPLICATE_FIELDS, 'Framescaper desktop V10 duplicate options');
	if (typeof raw.title !== 'string' || !raw.title.trim()
		|| new TextEncoder().encode(raw.title).byteLength > MAXIMUM_TITLE_BYTES) {
		throw new TypeError('The Framescaper desktop V10 duplicate title is invalid.');
	}
	if (typeof raw.timestamp !== 'string') throw new TypeError('The duplicate timestamp is invalid.');
	const time = Date.parse(raw.timestamp);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== raw.timestamp) {
		throw new TypeError('The duplicate timestamp is invalid.');
	}
	return Object.freeze({
		id: validateFramescaperDesktopV10ProjectId(raw.id),
		title: raw.title,
		timestamp: raw.timestamp,
	});
}

export function createFramescaperDesktopV10DuplicateProject(
	profile: EditorProjectRuntimeProfile,
	source: FramescaperProjectV18,
	options: Readonly<FramescaperDesktopV10DuplicateOptions>,
): FramescaperProjectV18 {
	const value = structuredClone(source) as unknown as Record<string, unknown>;
	value.id = options.id;
	value.title = options.title;
	value.revision = 0;
	value.createdAt = options.timestamp;
	value.updatedAt = options.timestamp;
	value.multicameraGroups = (value.multicameraGroups as Record<string, unknown>[]).map((group) => ({
		...group,
		projectId: options.id,
	}));
	return cloneFramescaperProjectV18(profile, value);
}

export function sameFramescaperDesktopV10Project(
	left: FramescaperProjectV18,
	right: FramescaperProjectV18,
): boolean {
	return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
}

function currentWitness(
	profile: EditorProjectRuntimeProfile,
	snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>,
): FramescaperDesktopV10CurrentWitness {
	return Object.freeze({
		kind: 'current',
		expectedMetadataRevision: snapshot.bundle.metadataRevision,
		expectedProject: Object.freeze({
			projectRevision: snapshot.bundle.project.projectRevision,
			projectSha256: snapshot.bundle.project.sha256,
		}),
		project: cloneFramescaperProjectV18(profile, snapshot.project),
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
