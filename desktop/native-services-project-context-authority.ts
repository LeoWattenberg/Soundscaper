/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-private project state and OpenFX timing authority for the selected V3 runtime. */

import {
	FRAMESCAPER_PROJECT_WATCH_BIN_ID,
} from '../src/common/editor/native-watch-target.ts';
import { readProjectSchemaIdentity } from '../src/common/editor/project-schema-identity.ts';
import { authenticateOpenFxProjectTimingAssets } from './openfx-main-project-timing-authority.ts';
import {
	framescaperNativeProjectMediaBundle,
	framescaperNativeProjectMediaRecord,
} from './native-services-project-media-custody.ts';
import type { NativePlanVideoTimingAssetBytes } from './native-services-video-timing-staging.ts';

export interface FramescaperNativeProjectContextPort {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	projectState(projectId: string): unknown;
	projectRecord(projectId: string): unknown;
	readProjectBundle(projectId: string): Promise<unknown>;
	readBody(body: unknown): Promise<Uint8Array>;
}

export interface FramescaperNativeProjectContextState {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly open: boolean;
	readonly writable: boolean;
	readonly binId: typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID;
}

export class FramescaperNativeProjectContextAuthority {
	readonly #project: FramescaperNativeProjectContextPort;

	constructor(project: FramescaperNativeProjectContextPort) {
		assertProjectIdentity(project, 'project context port');
		if (typeof project.projectState !== 'function'
			|| typeof project.projectRecord !== 'function'
			|| typeof project.readProjectBundle !== 'function'
			|| typeof project.readBody !== 'function') {
			throw new TypeError('The native project context authority requires exact project ports.');
		}
		this.#project = project;
	}

	projectState(projectId: string): FramescaperNativeProjectContextState {
		const state = this.#project.projectState(projectId);
		assertProjectIdentity(state, 'project context state');
		if (!state || typeof state !== 'object' || Array.isArray(state)) {
			throw new TypeError('The native project context state is malformed.');
		}
		const record = state as Record<string, unknown>;
		if (typeof record.open !== 'boolean' || typeof record.writable !== 'boolean'
			|| record.binId !== FRAMESCAPER_PROJECT_WATCH_BIN_ID) {
			throw new TypeError('The native project context requires its exact project-bin identity.');
		}
		return Object.freeze({
			schemaFamily: 'framescaper', schemaVersion: 1,
			open: record.open, writable: record.writable,
			binId: FRAMESCAPER_PROJECT_WATCH_BIN_ID,
		});
	}

	openFxTimingAssets(plan: unknown): Promise<readonly NativePlanVideoTimingAssetBytes[]> {
		return authenticateOpenFxProjectTimingAssets({
			plan,
			project: {
				projectRecord: (projectId) => framescaperNativeProjectMediaRecord(
					this.#project.projectRecord(projectId),
				),
				readProjectBundle: (projectId) => this.#project.readProjectBundle(projectId),
				readBody: (body) => this.#project.readBody(body),
			},
			parseBundle: framescaperNativeProjectMediaBundle,
		});
	}
}

function assertProjectIdentity(value: unknown, label: string): void {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaFamily !== 'framescaper' || identity.schemaVersion !== 1) {
		throw new TypeError(`The native ${label} requires the exact Framescaper v1 identity.`);
	}
}
