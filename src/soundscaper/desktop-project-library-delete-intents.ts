/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	validateSoundscaperDesktopBundle,
	validateSoundscaperDesktopCatalogSnapshot,
	validateSoundscaperDesktopProjectId,
	snapshotSoundscaperDesktopProject,
	type SoundscaperDesktopRendererBridge,
} from './desktop-project-library-renderer-contract.ts';
import type { SoundscaperDesktopCurrentWitness } from './desktop-project-library-renderer-lifecycle.ts';

const PREFIX = 'soundscaper.desktop-v1.delete-intent.v1:';
const FIELDS = [
	'kind', 'version', 'projectId', 'metadataRevision', 'projectRevision', 'projectSha256',
] as const;

export interface SoundscaperDesktopDeleteIntentStore {
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
	listByPrefix(prefix: string): PromiseLike<readonly Readonly<{ key: string; value: unknown }>[]> |
		readonly Readonly<{ key: string; value: unknown }>[];
}

export interface SoundscaperDesktopDeleteIntentShadowStore {
	loadProject(projectId: string): PromiseLike<unknown> | unknown;
	readonly projectRepository: Readonly<{
		deleteExact(project: unknown): PromiseLike<boolean> | boolean;
	}>;
	readonly linkedOriginalStoreService: Readonly<{
		deleteProject<Value>(projectId: string, operation: () => PromiseLike<Value> | Value): Promise<Value>;
	}>;
}

export interface SoundscaperDesktopDeleteIntent {
	readonly kind: 'soundscaper-desktop-v1-delete-intent';
	readonly version: 1;
	readonly projectId: string;
	readonly metadataRevision: number;
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export async function reconcileSoundscaperDesktopDeleteIntents(options: Readonly<{
	profile: EditorProjectRuntimeProfile;
	bridge: SoundscaperDesktopRendererBridge;
	shadow: SoundscaperDesktopDeleteIntentShadowStore;
	intents: SoundscaperDesktopDeleteIntents;
}>): Promise<void> {
	for (const intent of await options.intents.list()) {
		const raw = await options.bridge.readProjectBundle(intent.projectId);
		if (raw !== null) {
			validateSoundscaperDesktopBundle(options.profile, raw, intent.projectId);
			await options.intents.remove(intent);
			continue;
		}
		const catalog = validateSoundscaperDesktopCatalogSnapshot(await options.bridge.listProjects());
		if (catalog.projects.some(({ id }) => id === intent.projectId)) {
			throw new Error('A pending desktop  delete is catalogued without a readable bundle.');
		}
		if (catalog.metadataRevision < intent.metadataRevision + 1) {
			throw new Error('A pending desktop  delete lacks a newer authoritative catalog tombstone.');
		}
		await options.shadow.linkedOriginalStoreService.deleteProject(intent.projectId, async () => {
			const currentValue = await options.shadow.loadProject(intent.projectId);
			if (currentValue === null || currentValue === undefined) return;
			const current = snapshotSoundscaperDesktopProject(options.profile, currentValue);
			if (Number(current.project.revision) !== intent.projectRevision
				|| current.sha256 !== intent.projectSha256
				|| !await options.shadow.projectRepository.deleteExact(current.project)) {
				throw new Error('A pending desktop  delete shadow changed before exact cleanup.');
			}
		});
		if (await options.shadow.loadProject(intent.projectId) !== null) {
			throw new Error('A pending desktop  delete shadow remained after restart cleanup.');
		}
		await options.intents.remove(intent);
	}
}

export class SoundscaperDesktopDeleteIntents {
	readonly #store: SoundscaperDesktopDeleteIntentStore;

	constructor(store: SoundscaperDesktopDeleteIntentStore) { this.#store = store; }

	async create(witness: SoundscaperDesktopCurrentWitness): Promise<SoundscaperDesktopDeleteIntent> {
		const intent = Object.freeze({
			kind: 'soundscaper-desktop-v1-delete-intent' as const,
			version: 1 as const,
			projectId: validateSoundscaperDesktopProjectId(String(witness.project.id)),
			metadataRevision: witness.expectedMetadataRevision,
			projectRevision: witness.expectedProject.projectRevision,
			projectSha256: witness.expectedProject.projectSha256,
		});
		if (!await this.#store.putIfAbsent(key(intent.projectId), intent)) {
			throw new Error('A desktop  delete intent already owns this project.');
		}
		return intent;
	}

	async remove(intent: SoundscaperDesktopDeleteIntent): Promise<void> {
		if (!await this.#store.deleteIfCurrent(key(intent.projectId), intent)) {
			throw new Error('The desktop  delete intent changed before cleanup.');
		}
	}

	async list(): Promise<readonly SoundscaperDesktopDeleteIntent[]> {
		const rows = await this.#store.listByPrefix(PREFIX);
		const projectIds = new Set<string>();
		return Object.freeze(rows.map((row) => {
			const intent = validate(row.value);
			if (row.key !== key(intent.projectId)) throw new Error('A desktop  delete intent key drifted.');
			if (projectIds.has(intent.projectId)) throw new Error('Desktop  delete intents contain a duplicate project.');
			projectIds.add(intent.projectId);
			return intent;
		}));
	}
}

function key(projectId: string): string { return `${PREFIX}${encodeURIComponent(projectId)}`; }

function validate(value: unknown): SoundscaperDesktopDeleteIntent {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| JSON.stringify(Reflect.ownKeys(value).sort()) !== JSON.stringify([...FIELDS].sort())) {
		throw new TypeError('A closed desktop  delete intent is required.');
	}
	const raw = value as Record<(typeof FIELDS)[number], unknown>;
	if (raw.kind !== 'soundscaper-desktop-v1-delete-intent' || raw.version !== 1
		|| !Number.isSafeInteger(raw.metadataRevision) || Number(raw.metadataRevision) < 0
		|| !Number.isSafeInteger(raw.projectRevision) || Number(raw.projectRevision) < 0
		|| typeof raw.projectSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.projectSha256)) {
		throw new TypeError('The desktop  delete intent is invalid.');
	}
	return Object.freeze({
		...raw,
		projectId: validateSoundscaperDesktopProjectId(raw.projectId),
	}) as SoundscaperDesktopDeleteIntent;
}
