/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportPlan,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/product-video-export-strategy.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import { validateFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';
import {
	createFramescaperVideoExportStrategyV27,
	type FramescaperVideoExportStrategyV27Dependencies,
} from './video-export-strategy-v27.ts';
import type { FramescaperVideoExportVisualAssetStoreV27 } from './video-export-visual-execution-v27.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';
import { createFramescaperOpenFxExecutionForFoundationV28 } from './selected-v28-openfx-execution.ts';

interface ExportAuthorityV28 {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly inheritedProject: Readonly<Record<string, unknown>>;
}

/**
 * Preserve selected web-core export for V28 projects that need no native node.
 * Professional and OFX state fails closed into the V14 native route.
 */
export function createFramescaperVideoExportStrategyV28(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyV27Dependencies,
	assetStore?: FramescaperVideoExportVisualAssetStoreV27,
	openFxExecute?: FramescaperSelectedOpenFxExecutionV28['execute'],
): ProductVideoExportStrategy {
	const authorities = new Map<string, ExportAuthorityV28>();
	const createOpenFxExecution = openFxExecute === undefined ? undefined
		: ({ foundationPlan, timingViews }: Parameters<NonNullable<
			Parameters<typeof createFramescaperVideoExportStrategyV27>[3]
		>>[0]) => {
			const authority = authorities.get(projectKey(foundationPlan.project));
			if (!authority) throw new Error('Selected V28 OpenFX export lost its exact project authority.');
			return createFramescaperOpenFxExecutionForFoundationV28({
				profile, project: authority.canonicalProject as unknown as FramescaperProjectV28,
				foundationPlan, timingViews, execute: openFxExecute,
			});
		};
	const delegate = createFramescaperVideoExportStrategyV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, dependencies, assetStore, createOpenFxExecution,
	);
	const exports = new WeakMap<object, ExportAuthorityV28>();
	const plans = new WeakMap<object, ExportAuthorityV28>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const authority = projectAuthority(profile, request.canonicalProject, openFxExecute !== undefined);
			authorities.set(projectKey(authority.canonicalProject), authority);
			const exportProject = delegate.createExportProject({
				canonicalProject: authority.inheritedProject,
				delivery: request.delivery,
			});
			exports.set(exportProject, authority);
			return exportProject;
		},
		hasPicture(exportProject: Readonly<Record<string, unknown>>) {
			if (!exports.has(exportProject)) {
				throw new TypeError('Selected V28 picture authority requires an owned export project.');
			}
			return delegate.hasPicture?.(exportProject) ?? false;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			const authority = currentAuthority(profile, request, exports);
			const plan = delegate.createPlan({
				...request,
				canonicalProject: authority.inheritedProject,
			});
			if (plan) plans.set(plan, authority);
			return plan;
		},
		encode(request: ProductVideoExportStrategyEncodeRequest): Promise<ProductVideoExportEncodedOutput> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			return delegate.encode({ ...request, canonicalProject: authority.inheritedProject });
		},
		encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			return delegate.encodeToSink(
				{ ...request, canonicalProject: authority.inheritedProject }, sink,
			);
		},
		captureTimingSourceIds(plan: ProductVideoExportPlan) {
			if (!plans.has(plan)) throw new TypeError('Selected V28 timing closure requires an owned plan.');
			return delegate.captureTimingSourceIds?.(plan) ?? plan.activeSourceIds;
		},
	});
}

function projectAuthority(
	profile: unknown,
	project: Readonly<Record<string, unknown>>,
	allowOpenFx = false,
): ExportAuthorityV28 {
	validateFramescaperProjectV28(profile, project);
	assertBrowserFoundationOnly(project, allowOpenFx);
	return Object.freeze({
		canonicalProject: project,
		inheritedProject: framescaperProjectV27FoundationShapeV28(project),
	});
}

function currentAuthority(
	profile: unknown,
	request: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly exportProject: Readonly<Record<string, unknown>>;
	}>,
	exports: WeakMap<object, ExportAuthorityV28>,
): ExportAuthorityV28 {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact V28 project.');
	}
	const current = projectAuthority(profile, request.canonicalProject, true);
	if (!sameProjectSnapshot(current.inheritedProject, authority.inheritedProject)) {
		throw new Error('The selected V28 browser export projection is stale.');
	}
	return authority;
}

function ownedPlanAuthority(
	profile: unknown,
	request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityV28>,
	plans: WeakMap<object, ExportAuthorityV28>,
): ExportAuthorityV28 {
	const authority = currentAuthority(profile, request, exports);
	if (plans.get(request.plan) !== authority) {
		throw new TypeError('The V28 export plan is not owned by this exact project snapshot.');
	}
	return authority;
}

function assertBrowserFoundationOnly(project: Readonly<Record<string, unknown>>, allowOpenFx: boolean): void {
	if (!Array.isArray(project.ofxEffects) || project.ofxEffects.length > 0 && !allowOpenFx) {
		throw new Error('Selected V28 browser export refuses OpenFX state; use the V14 native route.');
	}
	if (!Array.isArray(project.sources)) throw new TypeError('Selected V28 browser export sources are invalid.');
	for (const sourceValue of project.sources) {
		if (!sourceValue || typeof sourceValue !== 'object' || Array.isArray(sourceValue)) {
			throw new TypeError('Selected V28 browser export source is invalid.');
		}
		const source = sourceValue as Readonly<Record<string, unknown>>;
		if (source.kind === 'video' && source.imageSequence !== null) {
			throw new Error('Selected V28 browser export refuses image sequences; use the V14 native route.');
		}
		if (source.kind === 'video' && record(source.characteristics).status === 'reported') {
			throw new Error('Selected V28 browser export refuses professional media; use the V14 native route.');
		}
	}
}

function projectKey(value: Readonly<{ readonly id?: unknown; readonly revision?: unknown }>): string {
	if (typeof value.id !== 'string' || !Number.isSafeInteger(value.revision)) {
		throw new TypeError('Selected V28 OpenFX export project identity is invalid.');
	}
	return `${value.id}\0${String(value.revision)}`;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected V28 source characteristics are invalid.');
	}
	return value as Readonly<Record<string, unknown>>;
}
