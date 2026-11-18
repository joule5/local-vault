# Local Vault

A fully offline, encrypted notebook that supports both text and freehand drawing (stylus or finger).

**Nothing ever leaves your device.**

## Privacy design

- All notes and drawings are encrypted with AES-GCM using a key derived from your passphrase (PBKDF2, 310 000 iterations).
- Storage is IndexedDB only.
- Strict Content-Security-Policy blocks any network requests.
- No accounts, no analytics, no external scripts, no fonts from CDNs.
- Export produces an already-encrypted backup file.
- “Wipe everything” clears the local database.

If you forget the passphrase, the data cannot be recovered. That is intentional.

## Features

- Text notes
- Freehand drawing with stylus / finger / mouse (Pointer Events + pressure)
- Create, edit, delete notes
- Lock the vault (clears decrypted data from memory)
- Export encrypted backup
- Full wipe

## Run it

No build step. Any static file server works:

```bash
cd local-vault
python3 -m http.server 8080
```

Then open http://127.0.0.1:8080/

Or host the folder on GitHub Pages, Netlify, etc. — still no backend required.

## License

Apache-2.0
