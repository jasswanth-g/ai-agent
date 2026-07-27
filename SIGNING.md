# Signing & notarizing DeployMate (macOS)

For **others to install the app by double-clicking**, the `.dmg` must be:

1. **Code-signed** with a *Developer ID Application* certificate, and
2. **Notarized** by Apple (automated malware scan), and
3. **Stapled** (electron-builder does this automatically after notarization).

A signed-but-not-notarized app is still blocked on other Macs with *"Apple cannot
check it for malicious software."* All three steps are required.

The build config is already set up (`build/entitlements.mac.plist`, `hardenedRuntime`,
`gatekeeperAssess: false` in `package.json`). You only need to supply credentials.

---

## One-time: get a Developer ID certificate

1. Enrol in the **Apple Developer Program** ($99/yr): https://developer.apple.com/programs/
2. Create a **Developer ID Application** certificate — easiest via Xcode:
   *Xcode → Settings → Accounts → (your team) → Manage Certificates → + → Developer ID Application.*
   Or generate it at https://developer.apple.com/account/resources/certificates.
3. Confirm it's in your login keychain:
   ```bash
   security find-identity -v -p codesigning
   ```
   You should see a line like `"Developer ID Application: Your Name (TEAMID)"`.

Your **Team ID** is the 10-character code in parentheses.

---

## One-time: notarization credentials

Pick **one** method.

### Option A — App Store Connect API key (recommended)

1. https://appstoreconnect.apple.com/access/integrations/api → generate a key with the
   **Developer** role. Download the `AuthKey_XXXX.p8` (you can only download it once).
2. Note the **Key ID** and the **Issuer ID** shown on that page.
3. Export for the build:
   ```bash
   export APPLE_API_KEY="/absolute/path/AuthKey_XXXX.p8"
   export APPLE_API_KEY_ID="XXXXXXXXXX"
   export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   ```

### Option B — Apple ID + app-specific password

1. https://account.apple.com → Sign-In and Security → **App-Specific Passwords** → generate one.
2. Export for the build:
   ```bash
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="XXXXXXXXXX"
   ```

---

## Build a signed + notarized DMG

With the certificate in your keychain, and the notarization env vars above set:

```bash
export APPLE_TEAM_ID="XXXXXXXXXX"   # required by the dist:release script
npm run dist:release
```

`dist:release` runs `electron-builder --mac -c.mac.notarize.teamId=$APPLE_TEAM_ID`.
electron-builder signs with the keychain identity, uploads for notarization using the
env credentials, waits, and staples the ticket. Notarization typically adds 2–10 min.

**CI / no keychain:** export the certificate as a `.p12` and pass it by env instead:
```bash
export CSC_LINK="/absolute/path/DeveloperID.p12"   # or a base64 string
export CSC_KEY_PASSWORD="the .p12 password"
```

---

## Verify the result

```bash
# Signature is valid + Developer ID
codesign --verify --deep --strict --verbose=2 "dist/mac-universal/DeployMate.app"
spctl -a -vvv -t install "dist/mac-universal/DeployMate.app"      # -> "accepted, source=Notarized Developer ID"
xcrun stapler validate "dist/DeployMate-1.0.0-universal.dmg"       # -> "The validate action worked!"
```

---

## Interim: unsigned builds

Until the cert is ready, build unsigned:

```bash
npm run dist:unsigned
```

`build/adhoc-sign.js` (the `afterPack` hook) ad-hoc signs the bundle so macOS doesn't
report it as *"damaged … move it to the Trash"*. Recipients must still bypass Gatekeeper
once per install:
- **Right-click the app → Open → Open**, or
- `xattr -cr /Applications/DeployMate.app`

This is the only friction that signing + notarization removes.
