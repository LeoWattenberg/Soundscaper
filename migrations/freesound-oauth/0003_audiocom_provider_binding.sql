-- SPDX-License-Identifier: AGPL-3.0-only

-- Existing NULL bindings retain the default audio.com issuer registration.
-- Persisting the registration prevents callback and refresh requests from using
-- a different provider after an editor preference changes.
ALTER TABLE audiocom_oauth_attempts ADD COLUMN provider_binding TEXT;
ALTER TABLE audiocom_oauth_grants ADD COLUMN provider_binding TEXT;
