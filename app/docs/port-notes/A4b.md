# A4b legacy keychain reader notes

- Follows the A4 finding: expo-secure-store cannot see Swift-written items (no kSecAttrGeneric). The local iOS-only Expo
  module `modules/legacy-keychain` (autolinked from app/modules) queries kSecClassGenericPassword by service + account,
  exactly like the Swift `baseQuery`, and deletes the same way.
- Port: `LegacySecretReader` (read, remove) with `FakeLegacySecretReader`; the D3 importer reads each Swift item
  (service `quartermint.efb-212.faa-notam-api`, accounts `client_id`, `client_secret`), writes it via SecretStore, then removes the original.
- Android and Jest: the native module is absent, so read returns null and remove is a no-op (there was no Android app).
- Not testable in Jest: the Swift module and podspec. Verified on device in I3 (seed a Swift item, import, check it is gone).
