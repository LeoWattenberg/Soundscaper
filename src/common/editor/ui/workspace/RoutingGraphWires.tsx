/* SPDX-License-Identifier: AGPL-3.0-only */
import { memo } from 'react';
import type { RoutingLayoutEdge } from './soundscaper-routing-graph-layout.ts';

/** Connection preview and selection do not change the owned static wire list. */
export default memo(function RoutingGraphWires({ edges }: { readonly edges: readonly RoutingLayoutEdge[] }) {
	return <>{edges.map(edge => <path key={edge.key} d={edge.path} className={`kw-routing-graph__wire kw-routing-graph__wire--${edge.kind}${edge.enabled ? '' : ' is-disabled'}`} />)}</>;
});
