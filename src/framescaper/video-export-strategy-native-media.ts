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
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { validateFramescaperProjectNativeMedia, type FramescaperProjectNativeMedia } from './editor-project-native-media.ts';
import {
	createFramescaperVideoExportStrategyFinishing,
	type FramescaperVideoExportStrategyFinishingDependencies,
} from './video-export-strategy-finishing.ts';
import type {
	CreateFramescaperVideoExportSupplementalPictureExecutionFinishing,
} from './video-export-exact-execution-finishing.ts';
import type { FramescaperVideoExportVisualAssetStoreFinishing } from './video-export-visual-execution-finishing.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';
import { createFramescaperOpenFxExecutionForFoundationNativeMedia } from './selected-native-media-openfx-execution.ts';

interface ExportAuthorityNativeMedia {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly inheritedProject: Readonly<Record<string, unknown>>;
}

/**
 * Preserve selected web-core export for nativeMedia projects that need no native node.
 * Professional and OFX state fails closed into the V14 native route.
 */
export function createFramescaperVideoExportStrategyNativeMedia(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyFinishingDependencies,
	assetStore?: FramescaperVideoExportVisualAssetStoreFinishing,
	openFxExecute?: FramescaperSelectedOpenFxExecutionNativeMedia['execute'],
	createSupplementalPictureExecution?: CreateFramescaperVideoExportSupplementalPictureExecutionFinishing,
): ProductVideoExportStrategy {
	const authorities = new Map<string, WeakRef<ExportAuthorityNativeMedia>>();
	const authorityFinalizer = new FinalizationRegistry<Readonly<{
		key: string; reference: WeakRef<ExportAuthorityNativeMedia>;
	}>>(({ key, reference }) => {
		if (authorities.get(key) === reference) authorities.delete(key);
	});
	const foundationAuthorities = new WeakMap<object, ExportAuthorityNativeMedia>();
	const createOpenFxExecution = openFxExecute === undefined ? undefined
		: ({ foundationPlan, timingViews }: Parameters<NonNullable<
			Parameters<typeof createFramescaperVideoExportStrategyFinishing>[3]
		>>[0]) => {
			const authority = authorities.get(projectKey(foundationPlan.project))?.deref();
			if (!authority) throw new Error('Selected nativeMedia OpenFX export lost its exact project authority.');
			return createFramescaperOpenFxExecutionForFoundationNativeMedia({
				profile, project: authority.canonicalProject as unknown as FramescaperProjectNativeMedia,
				foundationPlan, timingViews, execute: openFxExecute,
			});
		};
	const createSupplementalExecution = createSupplementalPictureExecution === undefined ? undefined
		: (options: Parameters<CreateFramescaperVideoExportSupplementalPictureExecutionFinishing>[0]) => {
			const authority = foundationAuthorities.get(options.canonicalProject);
			if (!authority) throw new Error('Selected nativeMedia supplemental export lost its exact project authority.');
			return createSupplementalPictureExecution({
				...options,
				canonicalProject: authority.canonicalProject,
			});
		};
	const delegate = createFramescaperVideoExportStrategyFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, dependencies, assetStore, createOpenFxExecution,
		createSupplementalExecution,
	);
	const exports = new WeakMap<object, ExportAuthorityNativeMedia>();
	const plans = new WeakMap<object, ExportAuthorityNativeMedia>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const authority = projectAuthority(profile, request.canonicalProject, openFxExecute !== undefined);
			if (openFxExecute !== undefined) {
				const key = projectKey(authority.canonicalProject);
				const reference = new WeakRef(authority);
				authorities.set(key, reference);
				authorityFinalizer.register(authority, { key, reference });
			}
			foundationAuthorities.set(authority.inheritedProject, authority);
			const exportProject = delegate.createExportProject({
				canonicalProject: authority.inheritedProject,
				delivery: request.delivery,
			});
			exports.set(exportProject, authority);
			return exportProject;
		},
		hasPicture(exportProject: Readonly<Record<string, unknown>>) {
			if (!exports.has(exportProject)) {
				throw new TypeError('Selected nativeMedia picture authority requires an owned export project.');
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
			if (!plans.has(plan)) throw new TypeError('Selected nativeMedia timing closure requires an owned plan.');
			return delegate.captureTimingSourceIds?.(plan) ?? plan.activeSourceIds;
		},
	});
}

function projectAuthority(
	profile: unknown,
	project: Readonly<Record<string, unknown>>,
	allowOpenFx = false,
): ExportAuthorityNativeMedia {
	validateFramescaperProjectNativeMedia(profile, project);
	assertBrowserFoundationOnly(project, allowOpenFx);
	return Object.freeze({
		canonicalProject: project,
		inheritedProject: framescaperProjectFinishingFoundationShapeNativeMedia(project),
	});
}

function currentAuthority(
	profile: unknown,
	request: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly exportProject: Readonly<Record<string, unknown>>;
	}>,
	exports: WeakMap<object, ExportAuthorityNativeMedia>,
): ExportAuthorityNativeMedia {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact nativeMedia project.');
	}
	const current = projectAuthority(profile, request.canonicalProject, true);
	if (!sameProjectSnapshot(current.inheritedProject, authority.inheritedProject)) {
		throw new Error('The selected nativeMedia browser export projection is stale.');
	}
	return authority;
}

function ownedPlanAuthority(
	profile: unknown,
	request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityNativeMedia>,
	plans: WeakMap<object, ExportAuthorityNativeMedia>,
): ExportAuthorityNativeMedia {
	const authority = currentAuthority(profile, request, exports);
	if (plans.get(request.plan) !== authority) {
		throw new TypeError('The nativeMedia export plan is not owned by this exact project snapshot.');
	}
	return authority;
}

function assertBrowserFoundationOnly(project: Readonly<Record<string, unknown>>, allowOpenFx: boolean): void {
	if (!Array.isArray(project.ofxEffects) || project.ofxEffects.length > 0 && !allowOpenFx) {
		throw new Error('Selected nativeMedia browser export refuses OpenFX state; use the V14 native route.');
	}
	if (!Array.isArray(project.sources)) throw new TypeError('Selected nativeMedia browser export sources are invalid.');
	for (const sourceValue of project.sources) {
		if (!sourceValue || typeof sourceValue !== 'object' || Array.isArray(sourceValue)) {
			throw new TypeError('Selected nativeMedia browser export source is invalid.');
		}
		const source = sourceValue as Readonly<Record<string, unknown>>;
		if (source.kind === 'video' && source.imageSequence !== null) {
			throw new Error('Selected nativeMedia browser export refuses image sequences; use the V14 native route.');
		}
		if (source.kind === 'video' && record(source.characteristics).status === 'reported') {
			throw new Error('Selected nativeMedia browser export refuses professional media; use the V14 native route.');
		}
	}
}

function projectKey(value: Readonly<{ readonly id?: unknown; readonly revision?: unknown }>): string {
	if (typeof value.id !== 'string' || !Number.isSafeInteger(value.revision)) {
		throw new TypeError('Selected nativeMedia OpenFX export project identity is invalid.');
	}
	return `${value.id}\0${String(value.revision)}`;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected nativeMedia source characteristics are invalid.');
	}
	return value as Readonly<Record<string, unknown>>;
}
