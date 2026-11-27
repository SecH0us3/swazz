// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package payloads

import (
	"bytes"
	"embed"
	"encoding/json"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode"

	"swazz-engine/internal/swagger"
)

//go:embed upload_corpus
var embeddedUploadCorpus embed.FS

// FileCategory classifies uploaded files into broad handler families.
type FileCategory string

const (
	FileCatImage    FileCategory = "image"
	FileCatArchive  FileCategory = "archive"
	FileCatDocument FileCategory = "document"
	FileCatText     FileCategory = "text"
	FileCatBinary   FileCategory = "binary"
)

// CorpusEntry holds a loaded upload fixture together with its inferred classification.
type CorpusEntry struct {
	File         swagger.UploadFile
	Category     FileCategory
	DeclaredMIME string
	DetectedMIME string
	Mismatch     bool
}

type uploadFileMeta struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	ProbeKind   string `json:"probeKind"`
	Category    string `json:"category"`
}

const maxCorpusFileBytes = 10 << 20 // 10 MiB safety cap per embedded/runtime corpus file

var (
	corpusMu    sync.RWMutex
	validCorpus []CorpusEntry
	probeCorpus []CorpusEntry
	extToMIME   = map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".gif":  "image/gif",
		".webp": "image/webp",
		".avif": "image/avif",
		".bmp":  "image/bmp",
		".tif":  "image/tiff",
		".tiff": "image/tiff",
		".svg":  "image/svg+xml",
		".ico":  "image/x-icon",
		".zip":  "application/zip",
		".gz":   "application/gzip",
		".tgz":  "application/gzip",
		".tar":  "application/x-tar",
		".7z":   "application/x-7z-compressed",
		".rar":  "application/vnd.rar",
		".bz2":  "application/x-bzip2",
		".xz":   "application/x-xz",
		".pdf":  "application/pdf",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		".doc":  "application/msword",
		".xls":  "application/vnd.ms-excel",
		".ppt":  "application/vnd.ms-powerpoint",
		".odt":  "application/vnd.oasis.opendocument.text",
		".rtf":  "application/rtf",
		".txt":  "text/plain",
		".csv":  "text/csv",
		".json": "application/json",
		".xml":  "application/xml",
		".html": "text/html",
	}
)

func init() {
	_ = ReloadUploadCorpus(os.Getenv("SWAZZ_UPLOAD_CORPUS_DIR"))
}

// ReloadUploadCorpus reloads the compile-time embedded upload_corpus and, when extraDir is
// non-empty and exists, merges files from that runtime directory using the same auto-classification rules.
func ReloadUploadCorpus(extraDir string) error {
	valid, probes, err := loadCorpusFromFS(embeddedUploadCorpus, "upload_corpus")
	if err != nil {
		return err
	}

	// "../" cannot be stored on disk, so traversal_filename is synthesized alongside embedded probes.
	traversalFile := newUploadFile("../../swazz-probe.txt", "text/plain", "traversal_filename", []byte("swazz-filename-probe\n"))
	probes = append(probes, CorpusEntry{
		File:         traversalFile,
		Category:     FileCatText,
		DeclaredMIME: "text/plain",
		DetectedMIME: "text/plain",
	})

	if extraDir = strings.TrimSpace(extraDir); extraDir != "" {
		cleanDir := filepath.Clean(extraDir)
		extFS := os.DirFS(cleanDir) // #nosec G703 -- SWAZZ_UPLOAD_CORPUS_DIR is an operator-configured corpus directory
		if info, statErr := fs.Stat(extFS, "."); statErr == nil && info.IsDir() {
			extValid, extProbes, extErr := loadCorpusFromFS(extFS, ".")
			if extErr != nil {
				return extErr
			}
			valid = append(valid, extValid...)
			probes = append(probes, extProbes...)
		}
	}

	rawProbes := make([]swagger.UploadFile, len(probes))
	for i, p := range probes {
		rawProbes[i] = cloneUploadFile(p.File)
	}

	corpusMu.Lock()
	validCorpus = valid
	probeCorpus = probes
	MaliciousFileUploads = rawProbes
	for i := range MaliciousCategories {
		if MaliciousCategories[i].ID == CatMaliciousFileUpload {
			MaliciousCategories[i].Items = toAny(rawProbes)
			break
		}
	}
	corpusMu.Unlock()
	return nil
}

func cloneUploadFile(uf swagger.UploadFile) swagger.UploadFile {
	return newUploadFile(uf.Filename, uf.ContentType, uf.ProbeKind, uf.Data)
}

func loadCorpusFromFS(fsys fs.FS, root string) (valid, probes []CorpusEntry, err error) {
	var paths []string
	walkErr := fs.WalkDir(fsys, root, func(p string, d fs.DirEntry, wErr error) error {
		if wErr != nil {
			return wErr
		}
		if d.IsDir() {
			return nil
		}
		base := path.Base(p)
		if strings.HasPrefix(base, ".") || strings.EqualFold(base, "README.md") || strings.HasSuffix(base, ".meta.json") {
			return nil
		}
		paths = append(paths, p)
		return nil
	})
	if walkErr != nil {
		return nil, nil, walkErr
	}
	sort.Strings(paths)

	for _, p := range paths {
		info, statErr := fs.Stat(fsys, p)
		if statErr != nil || info.Size() > maxCorpusFileBytes {
			continue
		}
		data, readErr := fs.ReadFile(fsys, p)
		if readErr != nil {
			return nil, nil, readErr
		}

		rel := strings.TrimPrefix(p, root)
		rel = strings.TrimPrefix(rel, "/")
		isValidDir := strings.HasPrefix(rel, "valid/")

		var meta *uploadFileMeta
		if metaBytes, metaErr := fs.ReadFile(fsys, p+".meta.json"); metaErr == nil {
			var parsed uploadFileMeta
			if json.Unmarshal(metaBytes, &parsed) == nil {
				meta = &parsed
			}
		}

		entry := classifyCorpusFile(path.Base(p), data, isValidDir, meta)
		if isValidDir {
			valid = append(valid, entry)
		} else {
			probes = append(probes, entry)
		}
	}
	return valid, probes, nil
}

func classifyCorpusFile(filename string, data []byte, isValidDir bool, meta *uploadFileMeta) CorpusEntry {
	declaredMIME := mimeForFilename(filename)
	detectedMIME := detectMagicMIME(data)
	cat := CategoryForMIME(declaredMIME)

	ext := strings.ToLower(path.Ext(filename))
	normExt := strings.TrimPrefix(ext, ".")
	if normExt == "jpg" {
		normExt = "jpeg"
	}
	if normExt == "" {
		normExt = "bin"
	}

	mismatch := isBinaryFormatMismatch(declaredMIME, detectedMIME)

	probeKind := ""
	switch {
	case isValidDir:
		if normExt == "txt" {
			probeKind = "valid_text"
		} else {
			probeKind = "valid_" + normExt
		}
	case ext == ".svg":
		probeKind = "svg_upload_probe"
	case hasDangerousDoubleExt(filename):
		probeKind = "double_ext_filename"
	case strings.Contains(strings.ToLower(filename), "truncated"):
		probeKind = "truncated_" + normExt
	case mismatch:
		probeKind = "mime_mismatch_" + normExt
	default:
		probeKind = "custom_upload_" + string(cat)
	}

	finalName := filename
	finalCT := declaredMIME
	if meta != nil {
		if meta.Filename != "" {
			finalName = meta.Filename
		}
		if meta.ContentType != "" {
			finalCT = meta.ContentType
			cat = CategoryForMIME(finalCT)
			mismatch = isBinaryFormatMismatch(finalCT, detectedMIME)
		}
		if meta.ProbeKind != "" {
			probeKind = meta.ProbeKind
		}
		if meta.Category != "" {
			cat = FileCategory(strings.ToLower(meta.Category))
		}
	}

	return CorpusEntry{
		File:         newUploadFile(finalName, finalCT, probeKind, data),
		Category:     cat,
		DeclaredMIME: declaredMIME,
		DetectedMIME: detectedMIME,
		Mismatch:     mismatch,
	}
}

func mimeForFilename(filename string) string {
	ext := strings.ToLower(path.Ext(filename))
	if m, ok := extToMIME[ext]; ok {
		return m
	}
	if ext != "" {
		if m := mime.TypeByExtension(ext); m != "" {
			if semi := strings.IndexByte(m, ';'); semi > 0 {
				m = strings.TrimSpace(m[:semi])
			}
			return m
		}
	}
	return "application/octet-stream"
}

func detectMagicMIME(data []byte) string {
	if len(data) == 0 {
		return "application/x-empty"
	}
	switch {
	case len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}):
		return "image/png"
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg"
	case len(data) >= 6 && (bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a"))):
		return "image/gif"
	case len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "image/webp"
	case bytes.HasPrefix(data, []byte("%PDF-")):
		return "application/pdf"
	case len(data) >= 4 && data[0] == 'P' && data[1] == 'K' && ((data[2] == 0x03 && data[3] == 0x04) || (data[2] == 0x05 && data[3] == 0x06)):
		return "application/zip"
	case len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b:
		return "application/gzip"
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) > 0 && bytes.Contains(bytes.ToLower(trimmed[:min(len(trimmed), 256)]), []byte("<svg")) {
		return "image/svg+xml"
	}
	detected := http.DetectContentType(data)
	if semi := strings.IndexByte(detected, ';'); semi > 0 {
		detected = strings.TrimSpace(detected[:semi])
	}
	return detected
}

func isBinaryFormatMismatch(declaredMIME, detectedMIME string) bool {
	if declaredMIME == "application/octet-stream" || declaredMIME == "image/svg+xml" || strings.HasPrefix(declaredMIME, "text/") {
		return false
	}
	if detectedMIME == "" || detectedMIME == "application/x-empty" {
		return false
	}
	if strings.EqualFold(declaredMIME, detectedMIME) {
		return false
	}
	// OOXML (.docx/.xlsx/.pptx) uses ZIP container magic bytes.
	if strings.HasPrefix(declaredMIME, "application/vnd.openxmlformats-") && detectedMIME == "application/zip" {
		return false
	}
	return true
}

func hasDangerousDoubleExt(filename string) bool {
	lower := strings.ToLower(filename)
	for _, marker := range []string{".php.", ".phtml.", ".jsp.", ".asp.", ".aspx.", ".exe.", ".sh.", ".bat."} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// CategoryForMIME maps a MIME type string to a broad FileCategory.
func CategoryForMIME(mimeType string) FileCategory {
	m := strings.ToLower(strings.TrimSpace(mimeType))
	if semi := strings.IndexByte(m, ';'); semi > 0 {
		m = strings.TrimSpace(m[:semi])
	}
	switch {
	case strings.HasPrefix(m, "image/"):
		return FileCatImage
	case strings.Contains(m, "zip") || strings.Contains(m, "gzip") || strings.Contains(m, "tar") ||
		strings.Contains(m, "compressed") || strings.Contains(m, "rar") || strings.Contains(m, "bzip") || strings.Contains(m, "xz"):
		return FileCatArchive
	case m == "application/pdf" || strings.Contains(m, "word") || strings.Contains(m, "excel") ||
		strings.Contains(m, "powerpoint") || strings.Contains(m, "officedocument") ||
		strings.Contains(m, "opendocument") || m == "application/rtf":
		return FileCatDocument
	case strings.HasPrefix(m, "text/") || m == "application/json" || m == "application/xml":
		return FileCatText
	default:
		return FileCatBinary
	}
}

// AllValidCanaries returns copies of all loaded valid canary entries.
func AllValidCanaries() []CorpusEntry {
	corpusMu.RLock()
	defer corpusMu.RUnlock()
	out := make([]CorpusEntry, len(validCorpus))
	for i, e := range validCorpus {
		e.File = cloneUploadFile(e.File)
		out[i] = e
	}
	return out
}

// ValidCanaryForCategories returns the first valid canary matching any preferred category,
// or ValidPNGFile if none match.
func ValidCanaryForCategories(preferred []FileCategory) swagger.UploadFile {
	corpusMu.RLock()
	defer corpusMu.RUnlock()
	if len(preferred) > 0 {
		for _, want := range preferred {
			// Prefer PNG for generic image category unless a more specific MIME was requested.
			if want == FileCatImage {
				for _, e := range validCorpus {
					if e.File.ProbeKind == "valid_png" {
						return cloneUploadFile(e.File)
					}
				}
			}
			for _, e := range validCorpus {
				if e.Category == want {
					return cloneUploadFile(e.File)
				}
			}
		}
	}
	for _, e := range validCorpus {
		if e.File.ProbeKind == "valid_png" {
			return cloneUploadFile(e.File)
		}
	}
	return ValidPNGFile()
}

// ValidCanaryForHints returns a valid canary matching an explicit accepted MIME type first,
// falling back to ValidCanaryForCategories(preferred).
func ValidCanaryForHints(acceptedMIME []string, preferred []FileCategory) swagger.UploadFile {
	if len(acceptedMIME) > 0 {
		corpusMu.RLock()
		for _, raw := range acceptedMIME {
			want := strings.ToLower(strings.TrimSpace(raw))
			for _, e := range validCorpus {
				if strings.EqualFold(e.DeclaredMIME, want) {
					cp := cloneUploadFile(e.File)
					corpusMu.RUnlock()
					return cp
				}
			}
		}
		corpusMu.RUnlock()
	}
	return ValidCanaryForCategories(preferred)
}

// InferFileCategories infers expected file categories from OpenAPI accepted MIME types,
// property names, or endpoint path hints. Returns nil when the endpoint appears generic.
func InferFileCategories(acceptedMIME []string, propName, endpointPath string) []FileCategory {
	var cats []FileCategory
	seen := make(map[FileCategory]bool)
	add := func(c FileCategory) {
		if c == "" || c == FileCatBinary || seen[c] {
			return
		}
		seen[c] = true
		cats = append(cats, c)
	}

	for _, raw := range acceptedMIME {
		m := strings.ToLower(strings.TrimSpace(raw))
		if m == "" || m == "*/*" || m == "application/octet-stream" ||
			m == "multipart/form-data" || m == "application/json" || m == "application/x-www-form-urlencoded" {
			continue
		}
		if strings.HasSuffix(m, "/*") {
			prefix := strings.TrimSuffix(m, "*")
			add(CategoryForMIME(prefix + "x"))
			continue
		}
		add(CategoryForMIME(m))
	}
	if len(cats) > 0 {
		return cats
	}

	tokens := strings.FieldsFunc(strings.ToLower(propName+" "+endpointPath), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	hasToken := func(kws ...string) bool {
		for _, tok := range tokens {
			for _, kw := range kws {
				if tok == kw {
					return true
				}
			}
		}
		return false
	}
	if hasToken("image", "img", "avatar", "photo", "logo", "icon", "pic", "banner", "thumb", "thumbnail") {
		add(FileCatImage)
	}
	if hasToken("zip", "archive", "bundle", "package", "backup", "tar", "gzip") {
		add(FileCatArchive)
	}
	if hasToken("pdf", "doc", "docx", "xlsx", "pptx", "document", "resume", "invoice", "report", "sheet") {
		add(FileCatDocument)
	}
	if hasToken("txt", "csv", "text") {
		add(FileCatText)
	}
	return cats
}

// PrioritizedMaliciousUploads returns upload probes ordered so preferred categories run first,
// filtered to probes whose size does not exceed maxBytes (when maxBytes > 0).
func PrioritizedMaliciousUploads(preferred []FileCategory, maxBytes int) []swagger.UploadFile {
	corpusMu.RLock()
	defer corpusMu.RUnlock()

	fit := make([]CorpusEntry, 0, len(probeCorpus))
	for _, e := range probeCorpus {
		if maxBytes > 0 && len(e.File.Data) > maxBytes {
			continue
		}
		fit = append(fit, e)
	}
	if len(fit) == 0 {
		fit = probeCorpus
	}

	prefSet := make(map[FileCategory]bool, len(preferred))
	for _, c := range preferred {
		prefSet[c] = true
	}

	out := make([]swagger.UploadFile, 0, len(fit))
	if len(prefSet) > 0 {
		for _, e := range fit {
			if prefSet[e.Category] {
				out = append(out, cloneUploadFile(e.File))
			}
		}
	}
	for _, e := range fit {
		if !prefSet[e.Category] {
			out = append(out, cloneUploadFile(e.File))
		}
	}
	return out
}
