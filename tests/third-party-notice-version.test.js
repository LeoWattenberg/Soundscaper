import assert from 'node:assert/strict';
import test from 'node:test';

import { thirdPartyNoticeRecordsVersion } from '../scripts/lib/third-party-notice-version.mjs';

test('notice versions must end at the locked package version', () => {
	assert.equal(thirdPartyNoticeRecordsVersion('`react` 18.3.10', 'react', '18.3.1'), false);
	assert.equal(thirdPartyNoticeRecordsVersion('`react` 18.3.1 (MIT)', 'react', '18.3.1'), true);
	assert.equal(thirdPartyNoticeRecordsVersion('Electron 38.2.10', 'electron', '38.2.1'), false);
	assert.equal(thirdPartyNoticeRecordsVersion('Electron 38.2.1\n', 'electron', '38.2.1'), true);
	assert.equal(thirdPartyNoticeRecordsVersion('SomeElectron 38.2.1', 'electron', '38.2.1'), false);
	assert.equal(thirdPartyNoticeRecordsVersion('x`react` 18.3.1', 'react', '18.3.1'), false);
});
