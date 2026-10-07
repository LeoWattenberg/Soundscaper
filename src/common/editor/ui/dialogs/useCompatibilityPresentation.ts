/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import type { ProjectFeatureAffectedObjectIndex, ProjectFeatureAffectedRequirement } from '../../project-feature-affected-objects.ts';

interface NamedOwner { readonly id: string; readonly name?: string | null; readonly title?: string | null }
interface OwnerProject {
	readonly tracks?: readonly NamedOwner[];
	readonly clips?: readonly NamedOwner[];
	readonly projectBin?: Readonly<{ readonly clips?: readonly NamedOwner[] }> | null;
	readonly mixer?: Readonly<{ readonly groups?: readonly NamedOwner[]; readonly sends?: readonly NamedOwner[] }> | null;
}
type OwnerScope = 'track' | 'group' | 'send' | 'timeline' | 'project-bin';
export type CompatibilityOwnerLookup = (scope: OwnerScope, id: string | null) => NamedOwner | undefined;

/** Index only collections an actual placeholder asks for, preserving find's first match. */
export function useCompatibilityOwnerLookup(project: OwnerProject | null | undefined): CompatibilityOwnerLookup {
	const tracks = project?.tracks, clips = project?.clips, bin = project?.projectBin?.clips, groups = project?.mixer?.groups, sends = project?.mixer?.sends;
	return useMemo(() => {
		const collections = { track: tracks, group: groups, send: sends, timeline: clips, 'project-bin': bin };
		const indexes = new Map<OwnerScope, ReadonlyMap<string, NamedOwner>>();
		return (scope, id) => {
			let indexed = indexes.get(scope);
			if (!indexed) {
				const owners = new Map<string, NamedOwner>();
				for (const owner of collections[scope] ?? []) { const id = owner.id; if (!owners.has(id)) owners.set(id, owner); }
				indexed = owners; indexes.set(scope, owners);
			}
			return id === null ? undefined : indexed.get(id);
		};
	}, [tracks, clips, bin, groups, sends]);
}

export function useFeatureAffectedLookup(index: ProjectFeatureAffectedObjectIndex | null | undefined) {
	const requirements = index?.requirements;
	return useMemo(() => {
		const byId = new Map<string, ProjectFeatureAffectedRequirement>();
		for (const requirement of requirements ?? []) {
			const id = requirement.requirementId;
			if (!byId.has(id)) byId.set(id, { ...requirement,
				objects: requirement.objects.filter(object => object.channel === 'rendered-fallback-replaced' || !object.registered),
			});
		}
		return byId;
	}, [requirements]);
}
