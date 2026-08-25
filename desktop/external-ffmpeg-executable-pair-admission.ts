/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact executable-pair admission checks shared by bounded external FFmpeg runners. */

import { isAbsolute } from 'node:path';

import { externalFfmpegExecutablePairClosureSha256 } from './external-ffmpeg-node-runtime.ts';

export interface ExternalFfmpegExecutablePairAdmission {
	readonly executablePath: string;
	readonly ffmpegSha256: string;
	readonly ffprobePath: string;
	readonly ffprobeSha256: string;
	readonly executablePairClosureSha256: string;
}

const SHA256 = /^[0-9a-f]{64}$/u;
const EXECUTABLE_PATH_LIMIT = 4_096;

export function isExternalFfmpegExecutablePairAdmission(
	value: ExternalFfmpegExecutablePairAdmission | null,
): value is ExternalFfmpegExecutablePairAdmission {
	if (!value || typeof value !== 'object') return false;
	if (typeof value.executablePath !== 'string' || !isAbsolute(value.executablePath)
		|| value.executablePath.length > EXECUTABLE_PATH_LIMIT || value.executablePath.includes('\0')
		|| typeof value.ffprobePath !== 'string' || !isAbsolute(value.ffprobePath)
		|| value.ffprobePath.length > EXECUTABLE_PATH_LIMIT || value.ffprobePath.includes('\0')
		|| value.ffprobePath === value.executablePath
		|| typeof value.ffmpegSha256 !== 'string' || !SHA256.test(value.ffmpegSha256)
		|| typeof value.ffprobeSha256 !== 'string' || !SHA256.test(value.ffprobeSha256)
		|| typeof value.executablePairClosureSha256 !== 'string'
		|| !SHA256.test(value.executablePairClosureSha256)) return false;
	try {
		return externalFfmpegExecutablePairClosureSha256({
			ffmpegPath: value.executablePath, ffmpegSha256: value.ffmpegSha256,
			ffprobePath: value.ffprobePath, ffprobeSha256: value.ffprobeSha256,
		}) === value.executablePairClosureSha256;
	} catch { return false; }
}

export async function externalFfmpegExecutablePairMatches(
	executable: ExternalFfmpegExecutablePairAdmission,
	digestFile: (path: string) => Promise<string>,
): Promise<boolean> {
	const ffmpegSha256 = await digestFile(executable.executablePath);
	const ffprobeSha256 = await digestFile(executable.ffprobePath);
	if (!SHA256.test(ffmpegSha256) || !SHA256.test(ffprobeSha256)) return false;
	const closure = externalFfmpegExecutablePairClosureSha256({
		ffmpegPath: executable.executablePath, ffmpegSha256,
		ffprobePath: executable.ffprobePath, ffprobeSha256,
	});
	return ffmpegSha256 === executable.ffmpegSha256
		&& ffprobeSha256 === executable.ffprobeSha256
		&& closure === executable.executablePairClosureSha256;
}
