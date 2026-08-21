const visit = (node) => {
	if (node?.type === 'element' && node.tagName === 'table') {
		node.properties ??= {};
		node.properties.tabIndex ??= 0;
	}
	for (const child of node?.children ?? []) visit(child);
};

export default function rehypeAccessibleTables() {
	return visit;
}
