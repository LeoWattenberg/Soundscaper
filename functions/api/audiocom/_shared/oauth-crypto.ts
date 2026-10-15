/* SPDX-License-Identifier: AGPL-3.0-only */

// The encrypted records remain provider-bound through their additional authenticated data.
export { constantTimeEqual, decryptOAuthSecret, encryptOAuthSecret, hashCapability, randomCapability } from '../../freesound/_shared/oauth-crypto.ts';
