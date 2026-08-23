/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateFramescaperDesktopExactBody,
	type FramescaperDesktopExactBodyDescriptor,
} from './project-library-exact-generation-storage.ts';
import { framescaperDesktopProjectLibraryV12DenseArray as denseArray } from './project-library-v12-values.ts';

const MAXIMUM_BODIES = 4_094;

export interface ExactGenerationProject extends Record<string, unknown> {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface FramescaperDesktopProjectLibraryExactGenerationBodyConfiguration {
	readonly label: string;
	readonly validateBodyDescriptor?: (
		value: unknown,
		label: string,
	) => Readonly<FramescaperDesktopExactBodyDescriptor>;
	readonly validateBodies?: (
		project: unknown,
		projectSha256: string,
		value: unknown,
	) => readonly Readonly<FramescaperDesktopExactBodyDescriptor>[];
}

export function framescaperDesktopExactConfiguredBody(
	configuration: FramescaperDesktopProjectLibraryExactGenerationBodyConfiguration,
	value: unknown,
): Readonly<FramescaperDesktopExactBodyDescriptor> {
	return configuration.validateBodyDescriptor?.(value, configuration.label)
		?? validateFramescaperDesktopExactBody(value, configuration.label);
}

export function framescaperDesktopExactConfiguredBodies(
	configuration: FramescaperDesktopProjectLibraryExactGenerationBodyConfiguration,
	project: unknown,
	projectSha256: string,
	value: unknown,
): readonly Readonly<FramescaperDesktopExactBodyDescriptor>[] {
	if (configuration.validateBodies) {
		return Object.freeze([...configuration.validateBodies(project, projectSha256, value)]);
	}
	return Object.freeze(denseArray(value, MAXIMUM_BODIES, `${configuration.label} bodies`)
		.map((body) => framescaperDesktopExactConfiguredBody(configuration, body)));
}
