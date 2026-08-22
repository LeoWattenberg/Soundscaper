/* SPDX-License-Identifier: AGPL-3.0-only */

/** Resolve one V12 plan's declarative SCTI references through current project custody. */

import { HELPER_DATA_PLANE_MAXIMUM_BYTES } from './helper-data-plane.ts';
import {
	authenticateNativeProjectTimingBodies,
	type NativePlanVideoTimingAssetBytes,
	type NativeProjectMediaBody,
} from './native-services-video-timing-staging.ts';

interface OpenFxProjectRecord {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly bodies: readonly Readonly<NativeProjectMediaBody>[];
}

interface OpenFxProjectBundle {
	readonly project: Readonly<{ readonly projectRevision: number; readonly sha256: string }>;
	readonly bodies: readonly Readonly<NativeProjectMediaBody>[];
}

interface OpenFxProjectTimingPort {
	projectRecord(projectId: string): OpenFxProjectRecord | null;
	readProjectBundle(projectId: string): Promise<unknown>;
	readBody(body: unknown): Promise<Uint8Array>;
}

export async function authenticateOpenFxProjectTimingAssets(input: Readonly<{
	readonly plan: unknown;
	readonly project: OpenFxProjectTimingPort;
	readonly parseBundle: (value: unknown) => OpenFxProjectBundle;
}>): Promise<readonly NativePlanVideoTimingAssetBytes[]> {
	const identity = planProject(input.plan);
	const record = currentRecord(input.project, identity);
	const bundle = input.parseBundle(await input.project.readProjectBundle(identity.id));
	if (bundle.project.projectRevision !== identity.revision
		|| bundle.project.sha256 !== record.projectSha256) {
		throw new Error('The OpenFX V12 project bundle changed before timing authentication.');
	}
	const authenticated = await authenticateNativeProjectTimingBodies({
		plan: input.plan,
		bodies: bundle.bodies,
		readBody: (body) => input.project.readBody(body),
		maximumStagedBytes: HELPER_DATA_PLANE_MAXIMUM_BYTES,
	});
	for (const { body } of authenticated.timingAssets) {
		const matches = record.bodies.filter((candidate) => sameBody(candidate, body));
		if (matches.length !== 1) {
			throw new Error('An OpenFX timing body is outside the exact current project record.');
		}
	}
	const current = currentRecord(input.project, identity);
	if (current.projectSha256 !== record.projectSha256) {
		throw new Error('The OpenFX V12 project changed during timing authentication.');
	}
	return Object.freeze(authenticated.timingAssets.map(({ input: timingInput, bytes }) => (
		Object.freeze({ input: timingInput, bytes: new Uint8Array(bytes) })
	)));
}

function planProject(value: unknown): Readonly<{ id: string; revision: number }> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An OpenFX timing request requires a V12 plan.');
	}
	const project = (value as Record<string, unknown>).project;
	if (!project || typeof project !== 'object' || Array.isArray(project)) {
		throw new TypeError('An OpenFX timing request requires exact project identity.');
	}
	const record = project as Record<string, unknown>;
	if (typeof record.id !== 'string' || record.id.length < 1
		|| !Number.isSafeInteger(record.revision) || Number(record.revision) < 0) {
		throw new TypeError('An OpenFX timing request has invalid project identity.');
	}
	return Object.freeze({ id: record.id, revision: Number(record.revision) });
}

function currentRecord(
	port: OpenFxProjectTimingPort,
	identity: Readonly<{ id: string; revision: number }>,
): OpenFxProjectRecord {
	const record = port.projectRecord(identity.id);
	if (record === null || record.projectId !== identity.id
		|| record.projectRevision !== identity.revision) {
		throw new Error('The OpenFX V12 plan does not name the exact current project revision.');
	}
	return record;
}

function sameBody(left: NativeProjectMediaBody, right: NativeProjectMediaBody): boolean {
	return left.kind === right.kind && left.encoding === right.encoding
		&& left.bindingId === right.bindingId && left.sourceId === right.sourceId
		&& left.storageKey === right.storageKey && left.mimeType === right.mimeType
		&& left.byteLength === right.byteLength && left.sha256 === right.sha256;
}
