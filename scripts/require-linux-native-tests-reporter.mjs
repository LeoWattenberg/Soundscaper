/* SPDX-License-Identifier: AGPL-3.0-only */

import { appendFileSync } from 'node:fs';
import { Transform } from 'node:stream';
import { spec } from 'node:test/reporters';

import {
	REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV,
	requiredLinuxNativeSkipDetail,
} from './lib/required-linux-native-tests.mjs';

export default function requireLinuxNativeTestsReporter() {
	const reportPath = process.env[REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV];
	if (!reportPath) {
		throw new Error(`The required native reporter needs ${REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV}.`);
	}
	const formatter = spec();
	const reporter = new Transform({
		writableObjectMode: true,
		transform(event, _encoding, callback) {
			const detail = requiredLinuxNativeSkipDetail(event);
			if (detail !== null) appendFileSync(reportPath, `${detail}\n`, { encoding: 'utf8', mode: 0o600 });
			formatter.write(event, callback);
		},
		flush(callback) {
			formatter.end(callback);
		},
	});
	formatter.on('data', (chunk) => reporter.push(chunk));
	formatter.on('error', (error) => reporter.destroy(error));
	return reporter;
}
