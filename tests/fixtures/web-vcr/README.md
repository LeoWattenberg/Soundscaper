# Web VCR diagnostic fixture

These files are test-only inputs for the loopback Web VCR diagnostic server.
The private key is intentionally checked in and must never be used outside local
tests. Production trusts neither this certificate nor its key; packaged tests
admit only the exact exported SHA-256 certificate fingerprint.
