# Desktop release signing and notarization

Soundscaper and Framescaper use electron-builder 26. Signing is opt-in through
GitHub repository variables. It applies to candidate tags in
`desktop-preview.yml` and stable Soundscaper tags in `soundscaper-stable-1.yml`.
Ordinary CI, scheduled nightlies, and development builds keep their existing
unsigned Windows and ad-hoc macOS behavior. Enabling signing makes missing
credentials, signature verification failures, or notarization failures fatal.

Create variables under **Settings → Secrets and variables → Actions → Variables**
and secrets under the adjacent **Secrets** tab. Keep certificate private keys,
passwords, and Azure credentials out of commits, workflow text, and issue comments.
The examples below are commands to run privately on your computer.

## macOS: accounts and certificate

You need an Apple Developer Program membership, an Apple Account with two-factor
authentication, and a **Developer ID Application** certificate. You do not need
to buy a Mac: GitHub's macOS runner builds, signs, submits, and staples the app.
The DMG target does not require a Developer ID Installer certificate.

You can create the private key and certificate signing request in WSL using
OpenSSL. These commands prompt for passwords and identity information:

```sh
openssl genpkey -algorithm RSA -aes-256-cbc -pkeyopt rsa_keygen_bits:2048 -out developer-id.key.pem
openssl req -new -key developer-id.key.pem -out developer-id.csr
```

In the Apple developer account, open **Certificates, Identifiers & Profiles →
Certificates → + → Developer ID Application**. As the Account Holder, upload
the CSR and download the issued certificate. Use the Developer ID intermediate
certificate corresponding to the issuer of your leaf certificate, available
from [Apple's certificate authority](https://www.apple.com/certificateauthority/).
Convert the downloaded DER certificates to PEM and export the identity:

```sh
openssl x509 -inform DER -in developerID_application.cer -out developer-id.cert.pem
openssl x509 -inform DER -in DeveloperIDG2CA.cer -out developer-id.intermediate.pem
openssl pkcs12 -export -legacy -inkey developer-id.key.pem -in developer-id.cert.pem \
  -certfile developer-id.intermediate.pem -out developer-id.p12
base64 -w 0 developer-id.p12 > developer-id.p12.base64
```

Keep the private key and export password in your password manager or another
private backup. The certificate alone cannot recreate its private key.

Create an app-specific password at **account.apple.com → Sign-In and Security →
App-Specific Passwords**. This workflow uses Apple ID authentication for
notarization; an App Store Connect API key is not required.

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `MAC_CERTIFICATE_P12` | Contents of `developer-id.p12.base64`, one line |
| Secret | `MAC_CERTIFICATE_PASSWORD` | Password chosen for the `.p12` export |
| Secret | `APPLE_ID` | Apple account email authorized to notarize for the team |
| Secret | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password, not the account login password |
| Variable | `APPLE_TEAM_ID` | Ten-character team identifier from Apple Membership details |
| Variable | `MAC_SIGNING_IDENTITY` | Exact certificate identity, such as `Developer ID Application: Example Name (ABCDEFGHIJ)` |
| Variable | `MAC_SIGNING_ENABLED` | `true`, after all the above are configured |

The runner imports the identity into a temporary keychain, exports its path as
`CSC_KEYCHAIN`, and removes the keychain in an `always()` cleanup step. Do not
also configure `CSC_LINK`: the workflow already imports the certificate.

Native runtime inputs first pass their ordinary provenance checks. The signing
hook signs Mach-O payloads, verifies the team, compares executable contents with
their original inputs after removing signature envelopes, and repins the staged
JSON manifests. Checked-in upstream pins and source files remain unchanged.
The packaging hook verifies exact copies of that signed stage; the outer app
signature protects the repinned configuration inside the ASAR. The release
manifest retains original and signed native file hashes.

electron-builder signs the enclosing app with hardened runtime, submits it to
Apple, and staples its ticket before constructing the DMG. The post-sign hook
requires `codesign` verification, `stapler validate`, and a successful Gatekeeper
assessment. The final DMG is also signed, submitted, and stapled before the
release inventory calculates checksums. A failed or rejected submission cannot
silently produce a release.

## Windows: Microsoft Artifact Signing

Microsoft Artifact Signing (formerly Trusted Signing) is the cloud signing
backend supported by this configuration. It avoids keeping a signing token on
a runner. Public Trust eligibility currently includes EU organizations, but
individual developers must be in the US or Canada. Check
[Microsoft's current eligibility and setup instructions](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
before creating paid resources.

1. Create an Azure subscription and Artifact Signing account.
2. Complete public identity validation and create a **Public Trust** certificate
   profile. Private Trust and Public Trust Test are not public distribution profiles.
3. Create a Microsoft Entra application/service principal and a client secret.
   Give that principal the **Artifact Signing Certificate Profile Signer** role
   scoped to the selected certificate profile. Schedule rotation before the
   client secret expires.
4. Configure the following GitHub values:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `AZURE_TENANT_ID` | Microsoft Entra tenant ID |
| Secret | `AZURE_CLIENT_ID` | Application/client ID of the service principal |
| Secret | `AZURE_CLIENT_SECRET` | Client secret **value**, not its identifier |
| Variable | `AZURE_SIGNING_ENDPOINT` | Regional signing endpoint from the account, including `https://` |
| Variable | `AZURE_SIGNING_ACCOUNT` | Artifact Signing account name |
| Variable | `AZURE_SIGNING_PROFILE` | Public Trust certificate profile name |
| Variable | `WINDOWS_PUBLISHER_NAME` | Exact publisher name on the certificate |
| Variable | `WINDOWS_SIGNING_MODE` | `azure` |

electron-builder signs the application and NSIS installers and timestamps their
signatures. Verification requires a valid Authenticode chain, timestamp, and
the configured publisher. ZIP downloads contain the signed application; ZIP
containers themselves do not carry Authenticode signatures.

### Existing exportable Windows certificate

If your provider supplies a usable exportable code-signing identity, set
`WINDOWS_SIGNING_MODE=certificate`, `WIN_CSC_LINK` to its base64 PFX, and
`WIN_CSC_KEY_PASSWORD` to its export password. Set `WINDOWS_PUBLISHER_NAME` too.
Do not assume a new public code-signing certificate can be exported: many
providers require a hardware token or managed signing service. Provider-specific
HSM integrations require their own signing adapter and are not configured here.

## First signed candidate

Enable each platform independently; the defaults are `MAC_SIGNING_ENABLED=false`
and `WINDOWS_SIGNING_MODE=none`. Prepare a new candidate version and push its
matching tag. Do not overwrite RC3's existing artifacts: signing changes bytes
and therefore its checksums.

Check the tagged workflow's packaging, signature/notarization verification,
smoke tests, package audit, and assembled inventory. Publish only artifacts and
`SHA256SUMS` from that same successful run. macOS notarization is an external
service; local unit tests cannot establish that Apple accepts your identity or
the submitted build. The first credentialed run is the end-to-end acceptance test.

If the certificate cannot be imported, check the base64, export password, and
intermediate certificate. If no identity matches, check `MAC_SIGNING_IDENTITY`
and `APPLE_TEAM_ID`. For notarization authentication errors, check the
app-specific password and team membership. For Azure authorization errors,
check the profile signer role and the region/account/profile combination.
If Apple rejects the DMG, the log prints its submission ID; use
`xcrun notarytool log` with that ID and the same team credentials on a macOS
runner to retrieve Apple's detailed rejection report.

References: [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/),
[electron-builder 26 macOS options](https://www.electron.build/v26/docs/mac/),
[electron-builder 26 Windows signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).
