export function partitionWorkspaceFiles(files) {
	const projects = [];
	const media = [];
	const labels = [];
	for (const file of files || []) {
		if (/\.(?:scape|aup3|aup4)$/iu.test(file?.name || '')) projects.push(file);
		else if (/\.(?:srt|txt|vtt)$/iu.test(file?.name || '')) labels.push(file);
		else media.push(file);
	}
	return { projects, media, labels };
}
