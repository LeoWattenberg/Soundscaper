/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlannedScapeExportAsset } from './scape-export-plan.ts';
import {
	resolveScapeProjectAssetExtension,
	type ScapeProjectAssetExtension,
	type ScapeProjectAssetExtensionImportRequest,
} from './scape-project-asset-extension.ts';

const COMPOSED_VALIDATION = Symbol('composed Scape asset-extension validation');

interface ComposedValidation {
	readonly [COMPOSED_VALIDATION]: true;
	readonly values: readonly unknown[];
}

/**
 * Give independent durable-body owners one Scape extension slot without
 * allowing either owner to bypass the other's validation or staging work.
 */
export function composeScapeProjectAssetExtensions(
	values: readonly Readonly<ScapeProjectAssetExtension>[],
): Readonly<ScapeProjectAssetExtension> {
	if (!Array.isArray(values) || values.length < 2 || values.length > 16) {
		throw new TypeError('Composed Scape asset extensions require a bounded delegate array.');
	}
	const delegates = Object.freeze(values.map((value) => {
		const resolved = resolveScapeProjectAssetExtension(value);
		if (!resolved) throw new TypeError('A composed Scape asset extension is required.');
		return resolved;
	}));
	const assetOwner = indexKinds(delegates, 'assetKinds', 'asset');
	const sourceOwner = indexKinds(delegates, 'sourceKinds', 'source');
	const extension: ScapeProjectAssetExtension = {
		assetKinds: Object.freeze([...assetOwner.keys()]),
		sourceKinds: Object.freeze([...sourceOwner.keys()]),
		planExportAssets: async (request) => {
			const result: PlannedScapeExportAsset[] = [];
			for (const delegate of delegates) {
				result.push(...await delegate.planExportAssets(request));
			}
			return Object.freeze(result);
		},
		validateExportAssetBody: (asset, body, signal) => {
			const owner = assetOwner.get(asset.kind);
			if (!owner) throw new TypeError(`No composed Scape extension owns ${asset.kind}.`);
			return owner.validateExportAssetBody(asset, body, signal);
		},
		validateImportAssets: (project, manifest) => Object.freeze({
			[COMPOSED_VALIDATION]: true as const,
			values: Object.freeze(delegates.map((delegate) => (
				delegate.validateImportAssets(project, manifest)
			))),
		}),
		stageImportAssets: async (request) => {
			const validation = composedValidation(request.validation, delegates.length);
			for (const [index, delegate] of delegates.entries()) {
				await delegate.stageImportAssets({
					...request,
					validation: validation.values[index],
				} satisfies ScapeProjectAssetExtensionImportRequest);
			}
		},
		validateReboundProject: (project) => {
			for (const delegate of delegates) delegate.validateReboundProject(project);
		},
		sourceStorageRole: (source) => {
			const owner = sourceOwner.get(String(source.kind));
			if (!owner) {
				throw new TypeError(`No composed Scape extension owns source kind ${String(source.kind)}.`);
			}
			return owner.sourceStorageRole(source);
		},
	};
	return Object.freeze(extension);
}

function indexKinds(
	delegates: readonly ScapeProjectAssetExtension[],
	field: 'assetKinds' | 'sourceKinds',
	label: string,
): ReadonlyMap<string, ScapeProjectAssetExtension> {
	const result = new Map<string, ScapeProjectAssetExtension>();
	for (const delegate of delegates) for (const kind of delegate[field]) {
		if (result.has(kind)) {
			throw new RangeError(`Composed Scape extensions cannot share ${label} kind ${kind}.`);
		}
		result.set(kind, delegate);
	}
	return result;
}

function composedValidation(value: unknown, expectedLength: number): ComposedValidation {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (value as Partial<ComposedValidation>)[COMPOSED_VALIDATION] !== true
		|| !Array.isArray((value as Partial<ComposedValidation>).values)
		|| (value as ComposedValidation).values.length !== expectedLength) {
		throw new TypeError('Exact composed Scape import validation is required.');
	}
	return value as ComposedValidation;
}
