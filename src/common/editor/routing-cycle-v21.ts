/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Reject a routing cycle over an explicit adjacency map. The traversal carries its
 * own stack rather than recursing, so a deep routing chain is either rejected as a
 * cycle or accepted, and never fails as a call-stack overflow instead.
 */
export function assertAcyclicRoutingV21(
	vertices: Iterable<string>,
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
	message: string,
): true {
	const visiting = new Set<string>()
	const visited = new Set<string>()
	const pending: { readonly vertex: string; readonly next: Iterator<string> }[] = []
	const enter = (vertex: string): void => {
		if (visiting.has(vertex)) throw new TypeError(message)
		if (visited.has(vertex)) return
		visiting.add(vertex)
		pending.push({ vertex, next: (adjacency.get(vertex) ?? new Set<string>()).values() })
	}
	for (const origin of vertices) {
		if (visited.has(origin)) continue
		enter(origin)
		while (pending.length > 0) {
			const frame = pending[pending.length - 1]!
			const step = frame.next.next()
			if (step.done === true) {
				pending.pop()
				visiting.delete(frame.vertex)
				visited.add(frame.vertex)
				continue
			}
			enter(step.value)
		}
	}
	return true
}
