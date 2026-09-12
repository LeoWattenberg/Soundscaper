# Actual public model delivery checks

Each JSON receipt records a completed publication check on the exact versioned
URL and bytes it names. Checks include HEAD length, a one-byte range response,
browser-origin CORS, and a streamed full-file SHA-256 readback. The model catalog
task pins the SHA-256 of the complete retained JSON receipt.

These checks ran against the public asset server. They are not fixture responses
or proof of catalog signing, installation, inference, or all-platform support.
The signed production catalog remains the installation authority. All eight
additional model artifacts have retained public readbacks. See
`docs/local-model-release-setup.md` for the exact signing handoff.

Readback is reproducible using `verifyMirroredArtifact` from
`scripts/lib/local-model-mirror-publication.mjs` and each receipt's URL and
artifact identity. This repeat check needs network access but no storage or
catalog-signing credentials.
