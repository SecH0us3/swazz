# Swazz File Upload Corpus (`upload_corpus/`)

This directory is embedded into the `swazz-engine` binary at compile time via `//go:embed upload_corpus`.

## Directory Layout

- `valid/` — minimal, valid canary files used for `RANDOM` baseline requests and runtime type probing (`png`, `jpg`, `gif`, `pdf`, `zip`, `txt`).
- `probes/` — validation probes used during `MALICIOUS` fuzzing.

> **Safety rule:** Keep all files committed here tiny and non-destructive. Never commit zip bombs, decompression bombs, or forged-dimension pixel-flood images. Symlinks in `SWAZZ_UPLOAD_CORPUS_DIR` are skipped for safety.

## Automatic Classification (No Manifest Required)

When you drop a file into `valid/` or `probes/` and rebuild `swazz-engine`, it is classified automatically:

1. **Declared MIME & Category (from extension):**
   - `image`: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.tif`, `.tiff`, `.svg`, `.ico`
   - `archive`: `.zip`, `.gz`, `.tgz`, `.tar`, `.7z`, `.rar`, `.bz2`, `.xz`
   - `document`: `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.doc`, `.xls`, `.ppt`, `.odt`, `.rtf`
   - `text`: `.txt`, `.csv`, `.json`, `.xml`, `.html`
   - `binary`: anything else (`application/octet-stream`)
2. **Actual MIME (from magic bytes):**
   - Inspects PNG, JPEG, GIF, WebP, PDF, ZIP, GZIP, SVG headers and `http.DetectContentType`.
   - If the declared binary format disagrees with the actual content (for example `sample.png` containing plain text or another format), it is automatically tagged as `mime_mismatch_<ext>`.
3. **ProbeKind inference:**
   - `.svg` → `svg_upload_probe`
   - Dangerous double extensions (`.php.png`, `.jsp.jpg`, `.exe.pdf`, etc.) → `double_ext_filename`
   - Filenames containing `polyglot` → `gif_polyglot_probe` (valid 1×1 GIF89a + canary tail to check re-encoding / `nosniff` on follow-up `GET`)
   - Filenames containing `exif-canary` → `png_metadata_canary` (valid 1×1 PNG with `tEXt` chunk to check metadata stripping on follow-up `GET`)
   - Filenames containing `truncated` → `truncated_<ext>`
   - Magic-byte mismatch → `mime_mismatch_<ext>`
   - Any other valid/custom probe → `custom_upload_<category>`

### Optional Sidecar Metadata (`<filename>.meta.json`)

If you need a custom `filename`, `contentType`, `probeKind`, or `category`, place a `<filename>.meta.json` next to the file:

```json
{
  "filename": "custom-name.png",
  "contentType": "image/png",
  "probeKind": "mime_mismatch_png",
  "category": "image"
}
```

## Runtime Directory Override (`SWAZZ_UPLOAD_CORPUS_DIR`)

To load additional local test files **without recompiling**, set `SWAZZ_UPLOAD_CORPUS_DIR=/path/to/corpus`. Files inside `valid/` and `probes/` (or top-level files, treated as `probes`) are merged with the embedded corpus using the same auto-classification rules.
