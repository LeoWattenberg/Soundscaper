/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV24,
} from '../src/framescaper/editor-project-feature-requirements-v24.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV25,
} from '../src/framescaper/editor-project-feature-requirements-v25.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV26,
} from '../src/framescaper/editor-project-feature-requirements-v26.ts';
import {
	FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import {
	FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import {
	FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import { createFramescaperProjectV24 } from '../src/framescaper/editor-project-v24.ts';
import { createFramescaperProjectV25 } from '../src/framescaper/editor-project-v25.ts';
import { createFramescaperProjectV26 } from '../src/framescaper/editor-project-v26.ts';
import { createFramescaperScapeNativeRuntimeV24 } from '../src/framescaper/editor-scape-native-v24.ts';
import { createFramescaperScapeNativeRuntimeV25 } from '../src/framescaper/editor-scape-native-v25.ts';
import { createFramescaperScapeNativeRuntimeV26 } from '../src/framescaper/editor-scape-native-v26.ts';

interface ScapeInspection {
	readonly schemaVersion: number;
	readonly readOnly: boolean;
	readonly featureRequirementsCompatibility: ProjectFeatureRequirementsReport | null;
}

interface CandidateRevision {
	readonly schemaVersion: 24 | 25 | 26;
	readonly createProject: () => Record<string, unknown>;
	readonly reconcile: (project: unknown) => unknown;
	readonly inspect: (archive: Blob) => Promise<ScapeInspection>;
}

const REVISIONS: readonly CandidateRevision[] = Object.freeze([
	revision(
		24,
		() => createFramescaperProjectV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, projectOptions(24)),
		(project) => reconcileFramescaperProjectFeatureRequirementsV24(
			FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, project,
		),
		(archive) => inspect(createFramescaperScapeNativeRuntimeV24(
			FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		), archive),
	),
	revision(
		25,
		() => createFramescaperProjectV25(FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, projectOptions(25)),
		(project) => reconcileFramescaperProjectFeatureRequirementsV25(
			FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, project,
		),
		(archive) => inspect(createFramescaperScapeNativeRuntimeV25(
			FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
		), archive),
	),
	revision(
		26,
		() => createFramescaperProjectV26(FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE, projectOptions(26)),
		(project) => reconcileFramescaperProjectFeatureRequirementsV26(
			FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE, project,
		),
		(archive) => inspect(createFramescaperScapeNativeRuntimeV26(
			FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE,
		), archive),
	),
]);

for (const candidate of REVISIONS) {
	test(`V${String(candidate.schemaVersion)} Scape inspection uses its exact candidate capability evaluator`, async () => {
		const project = candidate.createProject();
		project.featureRequirements = {
			schemaVersion: 2,
			requirements: [
				...requirements(project),
				requirement('publisher.available', PROJECT_FEATURE_CAPABILITY_IDS.audioImport),
				requirement('publisher.unavailable', PROJECT_FEATURE_CAPABILITY_IDS.audioEffects),
				requirement('publisher.unknown', 'org.example.future-video-pipeline'),
			],
		};
		project.featureRequirements = candidate.reconcile(project);
		const inspected = await candidate.inspect(await archive(project));
		const report = inspected.featureRequirementsCompatibility;
		assert.ok(report);
		assert.deepEqual(report.items.map(({ requirementId, availability }) => [requirementId, availability]), [
			['publisher.available', 'available'],
			['publisher.unavailable', 'unavailable'],
			['publisher.unknown', 'unknown'],
		]);
		assert.deepEqual(report.counts, { available: 1, unavailable: 1, unknown: 1 });
		assert.equal(report.compatible, false);
	});

	test(`V${String(candidate.schemaVersion)} Scape inspection refuses earlier schemas and keeps future custody opaque`, async () => {
		const project = candidate.createProject();
		await assert.rejects(
			async () => candidate.inspect(await archive({
				...project,
				schemaVersion: candidate.schemaVersion - 1,
			})),
			/re-import|reimport/iu,
		);
		const inspected = await candidate.inspect(await archive({
			...project,
			schemaVersion: candidate.schemaVersion + 1,
			futureOpaqueState: { preserved: true },
		}));
		assert.equal(inspected.schemaVersion, candidate.schemaVersion + 1);
		assert.equal(inspected.readOnly, true);
		assert.equal(inspected.featureRequirementsCompatibility, null);
	});
}

function revision(
	schemaVersion: 24 | 25 | 26,
	createProject: () => object,
	reconcile: (project: unknown) => unknown,
	inspectArchive: (archive: Blob) => Promise<ScapeInspection>,
): CandidateRevision {
	return Object.freeze({
		schemaVersion,
		createProject: () => structuredClone(createProject()) as Record<string, unknown>,
		reconcile,
		inspect: inspectArchive,
	});
}

function projectOptions(schemaVersion: number): Readonly<Record<string, unknown>> {
	return Object.freeze({
		id: `framescaper-v${String(schemaVersion)}-scape-compatibility`,
		title: `Framescaper V${String(schemaVersion)} Scape compatibility`,
		now: '2026-08-22T12:00:00.000Z',
	});
}

function requirements(project: Record<string, unknown>): readonly unknown[] {
	const manifest = project.featureRequirements as Readonly<{ readonly requirements: readonly unknown[] }>;
	return manifest.requirements;
}

function requirement(id: string, featureId: string): Readonly<Record<string, unknown>> {
	return Object.freeze({ id, featureId, displayName: id, disposition: 'bypass', fallback: null });
}

async function inspect(
	runtime: ReturnType<typeof createFramescaperScapeNativeRuntimeV24>
		| ReturnType<typeof createFramescaperScapeNativeRuntimeV25>
		| ReturnType<typeof createFramescaperScapeNativeRuntimeV26>,
	archive: Blob,
): Promise<ScapeInspection> {
	return runtime.inspectScapeProject(
		archive,
		null,
		{ signal: new AbortController().signal },
		{ retain() {} },
	) as Promise<ScapeInspection>;
}

async function archive(project: unknown): Promise<Blob> {
	const projectText = JSON.stringify(project);
	const projectBytes = new TextEncoder().encode(projectText);
	const manifest = {
		format: 'scape-project',
		formatVersion: 1,
		project: {
			entry: 'project.json',
			mimeType: 'application/json',
			schemaVersion: (project as { schemaVersion: number }).schemaVersion,
			size: projectBytes.byteLength,
			sha256: createHash('sha256').update(projectBytes).digest('hex'),
		},
		assets: [],
	};
	const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
		level: 0,
		useWebWorkers: false,
		zip64: true,
	});
	await writer.add('project.json', new TextReader(projectText), { level: 0, zip64: true });
	await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)), { level: 0, zip64: true });
	return writer.close(undefined, { zip64: true });
}
