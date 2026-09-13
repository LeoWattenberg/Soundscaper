# Actual public model delivery checks

Each JSON receipt records a completed publication check on the exact versioned
URL and bytes it names. Checks include HEAD length, a one-byte range response,
browser-origin CORS, and a streamed full-file SHA-256 readback. The model catalog
task pins the SHA-256 of the complete retained JSON receipt.

These retained checks ran against the public asset server. They are not fixture
responses or proof of catalog publication, installation, inference, or
all-platform support. The digest-pinned production catalog remains the
installation authority. All eight additional model artifacts have retained
public readbacks. See
`docs/local-model-release-setup.md` for the repository-only catalog-inclusion
check.

The ordinary nightly-with-tests package repeats public HEAD, one-byte Range, and
CORS checks with `verifyMirroredArtifactDelivery` before every fresh install.
The production installer then supplies the streamed full SHA-256 readback, so
the nightly does not fetch a model twice. Its install and inference attachments
bind those results to the exact source revision and packaged product identity.
This repeat check needs network access but no storage or catalog-change
credentials.
