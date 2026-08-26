/* SPDX-License-Identifier: AGPL-3.0-only */

/** Stable, pathless provenance for one semantically accepted Reframe crop path. */

import {
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
	validateAssistanceWorkflow,
	type AssistanceWorkflowModelBindingV1,
	type AssistanceWorkflowSourceRangeV1,
} from './workflow.ts';
import {
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from './owned-video-highlight-transform-results-v1.ts';
import type {
	AssistanceOwnedReframePathV1,
} from './owned-video-highlight-transform-types-v1.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	validateAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from './workflow-settings-v1.ts';
import { validateAssistanceWorkflowFenceV1 } from './workflow-fence-v1.ts';

export const ASSISTANCE_ACCEPTED_REFRAME_DERIVATIVE_MEDIA_TYPE =
	'application/vnd.soundscaper.accepted-reframe-path+json';

type ReframeSettings = Extract<AssistanceWorkflowSettingsV1,
	{ readonly workflowId: 'reframe' }>;

export interface AssistanceAcceptedReframeDerivativeAuthorityV1 {
	readonly projectId: string;
	readonly projectSchemaVersion: number;
	readonly baseProjectRevision: number;
	readonly acceptedProjectRevision: number;
	readonly sequenceId: string;
	readonly sourceRange: AssistanceWorkflowSourceRangeV1;
	readonly recipeVersion: 1;
	readonly settingsVersion: 1;
	readonly settings: ReframeSettings;
	readonly stageIds: readonly ['detect-subjects', 'detect-saliency', 'track-subjects', 'plan-crops'];
	readonly models: readonly AssistanceWorkflowModelBindingV1[];
	readonly recipeSha256: string;
	readonly settingsSha256: string;
	readonly modelBindingsSha256: string;
}

export interface AssistanceAcceptedReframeDerivativeV1 {
	readonly schemaVersion: 1;
	readonly kind: 'accepted-reframe-path';
	readonly authority: AssistanceAcceptedReframeDerivativeAuthorityV1;
	readonly result: AssistanceOwnedReframePathV1;
}

const DERIVATIVE_FIELDS = Object.freeze(['schemaVersion', 'kind', 'authority', 'result'] as const);
const AUTHORITY_FIELDS = Object.freeze([
	'projectId', 'projectSchemaVersion', 'baseProjectRevision', 'acceptedProjectRevision',
	'sequenceId', 'sourceRange', 'recipeVersion', 'settingsVersion', 'settings', 'stageIds',
	'models', 'recipeSha256', 'settingsSha256', 'modelBindingsSha256',
] as const);
const MODEL_FIELDS = Object.freeze([
	'bindingVersion', 'stageId', 'slotId', 'modelId', 'version', 'artifactSha256s',
] as const);
const STAGE_IDS = Object.freeze([
	'detect-subjects', 'detect-saliency', 'track-subjects', 'plan-crops',
] as const);
const MODEL_ROLES = new Set([
	'detect-subjects\0face-detector',
	'detect-subjects\0object-detector',
	'detect-saliency\0saliency-detector',
]);
const SHA256 = /^[a-f\d]{64}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,126}[a-z\d])?$/u;

export function createAssistanceAcceptedReframeDerivativeV1(
	workflowValue: unknown,
	resultValue: unknown,
	acceptedProjectRevisionValue: number,
): AssistanceAcceptedReframeDerivativeV1 {
	const workflow = validateAssistanceWorkflow(workflowValue);
	if (workflow.workflowId !== 'reframe') {
		throw new TypeError('Accepted Reframe evidence requires the closed Reframe workflow.');
	}
	const acceptedProjectRevision = integer(acceptedProjectRevisionValue, 0,
		'accepted project revision');
	if (acceptedProjectRevision !== workflow.fence.revision + 1
		|| !Number.isSafeInteger(workflow.fence.revision + 1)) {
		throw new RangeError('Accepted Reframe evidence must bind the next atomic project revision.');
	}
	const videoRanges = workflow.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === 'video');
	if (videoRanges.length !== 1 || workflow.fence.sourceRanges.length !== 1) {
		throw new TypeError('Accepted Reframe evidence requires one exact video source range.');
	}
	return reviewAssistanceAcceptedReframeDerivativeV1({
		schemaVersion: 1,
		kind: 'accepted-reframe-path',
		authority: {
			projectId: workflow.fence.projectId,
			projectSchemaVersion: workflow.fence.schemaVersion,
			baseProjectRevision: workflow.fence.revision,
			acceptedProjectRevision,
			sequenceId: workflow.fence.sequenceId,
			sourceRange: videoRanges[0],
			recipeVersion: workflow.recipeVersion,
			settingsVersion: workflow.settingsVersion,
			settings: workflow.settings,
			stageIds: workflow.stageIds,
			models: workflow.models,
			recipeSha256: workflow.fence.recipeSha256,
			settingsSha256: workflow.fence.settingsSha256,
			modelBindingsSha256: workflow.fence.modelBindingsSha256,
		},
		result: resultValue,
	});
}

export function reviewAssistanceAcceptedReframeDerivativeV1(
	value: unknown,
): AssistanceAcceptedReframeDerivativeV1 {
	const row = exactRecord(value, DERIVATIVE_FIELDS, 'accepted Reframe derivative');
	if (row.schemaVersion !== 1 || row.kind !== 'accepted-reframe-path') {
		throw new TypeError('The accepted Reframe derivative identity is unsupported.');
	}
	const candidate = exactRecord(row.authority, AUTHORITY_FIELDS,
		'accepted Reframe derivative authority');
	const baseProjectRevision = integer(candidate.baseProjectRevision, 0,
		'base project revision');
	const acceptedProjectRevision = integer(candidate.acceptedProjectRevision, 1,
		'accepted project revision');
	if (acceptedProjectRevision !== baseProjectRevision + 1
		|| !Number.isSafeInteger(baseProjectRevision + 1)) {
		throw new RangeError('Accepted Reframe derivative revisions are not one atomic edit apart.');
	}
	if (candidate.recipeVersion !== 1 || candidate.settingsVersion !== 1) {
		throw new TypeError('Accepted Reframe derivative versions are unsupported.');
	}
	const stageIds = exactStageIds(candidate.stageIds);
	const settings = validateAssistanceWorkflowSettingsV1(candidate.settings, 'reframe');
	if (settings.workflowId !== 'reframe') {
		throw new TypeError('Accepted Reframe derivative settings changed workflow identity.');
	}
	const models = modelBindings(candidate.models);
	const recipeSha256 = digest(candidate.recipeSha256, 'recipe');
	const settingsSha256 = digest(candidate.settingsSha256, 'settings');
	const modelBindingsSha256 = digest(candidate.modelBindingsSha256, 'model bindings');
	if (recipeSha256 !== assistanceWorkflowRecipeSha256V1('reframe', 1, stageIds)
		|| settingsSha256 !== assistanceWorkflowSettingsSha256V1(settings)
		|| modelBindingsSha256 !== assistanceWorkflowModelBindingsSha256V1(models)) {
		throw new TypeError('Accepted Reframe derivative provenance digests disagree with their bodies.');
	}
	const projectId = id(candidate.projectId, 'project');
	const projectSchemaVersion = integer(candidate.projectSchemaVersion, 1,
		'project schema version');
	const sequenceId = id(candidate.sequenceId, 'sequence');
	const fence = validateAssistanceWorkflowFenceV1({
		fenceVersion: 1, projectId, schemaVersion: projectSchemaVersion,
		revision: baseProjectRevision, sequenceId, sourceRanges: [candidate.sourceRange],
		transcriptBodySha256: null, recipeSha256, settingsSha256, modelBindingsSha256,
	});
	const sourceRange = fence.sourceRanges[0]!;
	if (sourceRange.mediaKind !== 'video') {
		throw new TypeError('Accepted Reframe derivative authority must bind video.');
	}
	const reviewed = reviewAssistanceOwnedVideoHighlightTransformResultV1({
		schemaVersion: 1, transformId: 'plan-crops', outputs: { 'reframe-path': row.result },
	});
	if (reviewed.transformId !== 'plan-crops') {
		throw new TypeError('Accepted Reframe derivative changed terminal identity.');
	}
	const result = reviewed.outputs['reframe-path'];
	if (result.path.targetAspect.width !== settings.targetAspectWidth
		|| result.path.targetAspect.height !== settings.targetAspectHeight
		|| result.authority.frames[0]!.sourceFrame !== sourceRange.sourceStartFrame
		|| result.authority.frames.some(({ sourceFrame }) => sourceFrame < sourceRange.sourceStartFrame
			|| sourceFrame >= sourceRange.sourceEndFrame)) {
		throw new RangeError('Accepted Reframe path disagrees with exact source or settings authority.');
	}
	const authority: AssistanceAcceptedReframeDerivativeAuthorityV1 = Object.freeze({
		projectId, projectSchemaVersion, baseProjectRevision, acceptedProjectRevision,
		sequenceId, sourceRange, recipeVersion: 1, settingsVersion: 1,
		settings, stageIds, models, recipeSha256, settingsSha256, modelBindingsSha256,
	});
	return Object.freeze({ schemaVersion: 1, kind: 'accepted-reframe-path', authority, result });
}

function exactStageIds(value: unknown): typeof STAGE_IDS {
	if (!Array.isArray(value) || value.length !== STAGE_IDS.length
		|| value.some((stageId, index) => stageId !== STAGE_IDS[index])) {
		throw new TypeError('Accepted Reframe derivative stages changed closed recipe order.');
	}
	return STAGE_IDS;
}

function modelBindings(value: unknown): readonly AssistanceWorkflowModelBindingV1[] {
	if (!Array.isArray(value) || value.length !== MODEL_ROLES.size) {
		throw new TypeError('Accepted Reframe derivative requires every explicit model role.');
	}
	const seen = new Set<string>();
	const models = value.map((candidate, index) => {
		const row = exactRecord(candidate, MODEL_FIELDS,
			`accepted Reframe model binding ${String(index)}`);
		if (row.bindingVersion !== 1 || typeof row.stageId !== 'string'
			|| typeof row.slotId !== 'string') {
			throw new TypeError('Accepted Reframe model binding identity is unsupported.');
		}
		const role = `${row.stageId}\0${row.slotId}`;
		if (!MODEL_ROLES.has(role) || seen.has(role)) {
			throw new TypeError('Accepted Reframe model roles are missing or repeated.');
		}
		seen.add(role);
		if (typeof row.modelId !== 'string' || !MODEL_ID.test(row.modelId)
			|| typeof row.version !== 'string' || row.version.length < 1
			|| row.version.length > 128 || row.version !== row.version.trim()) {
			throw new TypeError('Accepted Reframe model identity is invalid.');
		}
		if (!Array.isArray(row.artifactSha256s) || row.artifactSha256s.length < 1
			|| row.artifactSha256s.length > 64) {
			throw new RangeError('Accepted Reframe model artifacts exceed their bound.');
		}
		const artifactSha256s = row.artifactSha256s.map((artifact) => digest(artifact,
			'model artifact'));
		if (artifactSha256s.some((artifact, artifactIndex) => artifactIndex > 0
			&& artifact <= artifactSha256s[artifactIndex - 1]!)) {
			throw new TypeError('Accepted Reframe model artifacts must be sorted and unique.');
		}
		return Object.freeze({ bindingVersion: 1 as const, stageId: row.stageId,
			slotId: row.slotId, modelId: row.modelId, version: row.version,
			artifactSha256s: Object.freeze(artifactSha256s) });
	});
	return Object.freeze(models);
}

function exactRecord<const Field extends string>(
	value: unknown, fields: readonly Field[], label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be one plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Field, unknown>;
}

function id(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u.test(value)) {
		throw new TypeError(`The accepted Reframe ${label} ID is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The accepted Reframe ${label} digest is invalid.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The accepted Reframe ${label} is invalid.`);
	}
	return Number(value);
}
