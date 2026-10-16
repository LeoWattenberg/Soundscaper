/* SPDX-License-Identifier: AGPL-3.0-only */

export async function scapeVideoProxySourceReferences(
	files: readonly string[],
	requiredFiles: readonly string[],
	moduleStem: string,
	readSource: (file: string) => Promise<string>,
): Promise<string[]> {
	const required = new Set(requiredFiles);
	const references: string[] = [];
	for (const file of files) {
		if (!required.has(file) && !file.includes(`${moduleStem}-v2`)) continue;
		if ((await readSource(file)).includes(moduleStem)) references.push(file);
	}
	return references;
}
