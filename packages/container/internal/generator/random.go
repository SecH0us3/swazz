package generator

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ─── Mini word dictionary (~200 words) ──────────────────

var words = []string{
	"alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
	"india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
	"quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey",
	"xray", "yankee", "zulu", "apple", "banana", "cherry", "dragon",
	"eagle", "falcon", "grape", "hawk", "iron", "jade", "knight", "lemon",
	"mango", "night", "ocean", "pearl", "quartz", "river", "storm", "tiger",
	"umbra", "venom", "whale", "xenon", "yeti", "zebra", "amber", "blaze",
	"coral", "dusk", "ember", "frost", "glow", "haze", "ivory", "jet",
	"karma", "lotus", "mist", "neon", "onyx", "prism", "quest", "rune",
	"silk", "torch", "ultra", "vivid", "wind", "pixel", "solar", "lunar",
	"cyber", "nexus", "pulse", "spark", "steel", "stone", "swift", "flux",
	"blitz", "crypt", "drift", "forge", "grain", "haven", "index", "joule",
	"knot", "latch", "mesh", "node", "orbit", "phase", "query", "relay",
	"scope", "trace", "unity", "valve", "warp", "yield", "zinc", "axis",
}

var firstNames = []string{
	"James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael",
	"Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan",
	"Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
}

var lastNames = []string{
	"Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
	"Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
	"Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
}

var domains = []string{
	"test.com", "example.org", "demo.net", "sample.io", "mock.dev",
	"fake.co", "stub.app", "local.test",
}

const alphanumeric = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// ─── Core random functions ──────────────────────────────

// Pick returns a random element from a slice.
func Pick[T any](arr []T) T {
	return arr[rand.IntN(len(arr))]
}

// UUID generates a UUID v4.
func UUID() string {
	return uuid.New().String()
}

// Word returns a random word from the built-in dictionary.
func Word() string {
	return Pick(words)
}

// Words returns n random words joined by space.
func Words(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(Word())
	}
	return b.String()
}

// IntRange returns a random integer in [min, max] inclusive.
func IntRange(min, max int) int {
	return min + rand.IntN(max-min+1)
}

// FloatRange returns a random float in [min, max).
func FloatRange(min, max float64) float64 {
	return min + rand.Float64()*(max-min)
}

// RandomDate returns a random date between 2020-01-01 and now.
func RandomDate() time.Time {
	from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Now().UTC()
	diff := to.Sub(from)
	return from.Add(time.Duration(rand.Int64N(int64(diff))))
}

// Email generates a random email address.
func Email() string {
	first := strings.ToLower(Pick(firstNames))
	last := strings.ToLower(Pick(lastNames))
	domain := Pick(domains)
	return fmt.Sprintf("%s.%s%d@%s", first, last, IntRange(1, 999), domain)
}

// IPv4 generates a random IPv4 address.
func IPv4() string {
	return fmt.Sprintf("%d.%d.%d.%d", IntRange(1, 254), IntRange(0, 255), IntRange(0, 255), IntRange(1, 254))
}

// URI generates a random URI.
func URI() string {
	return fmt.Sprintf("https://%s.example.com/%s/%s", Word(), Word(), Word())
}

// RandomString generates a random alphanumeric string of given length.
func RandomString(length int) string {
	b := make([]byte, length)
	for i := range b {
		b[i] = alphanumeric[rand.IntN(len(alphanumeric))]
	}
	return string(b)
}

// FullName generates a random full name.
func FullName() string {
	return fmt.Sprintf("%s %s", Pick(firstNames), Pick(lastNames))
}

// HashStr computes a fast djb2 hash of a string — used for payload dedup.
func HashStr(s string) uint32 {
	var h uint32 = 5381
	for i := 0; i < len(s); i++ {
		h = (h << 5) + h + uint32(s[i])
	}
	return h
}
