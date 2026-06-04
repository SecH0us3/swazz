package swagger

import (
	"testing"
)

func TestSettingsValidate(t *testing.T) {
	tests := []struct {
		name      string
		settings  Settings
		expectErr bool
	}{
		{
			name: "Valid default settings",
			settings: Settings{
				Concurrency: 5,
				TimeoutMs:   1000,
				Profiles:    []FuzzingProfile{ProfileRandom, ProfileBoundary, ProfileMalicious},
			},
			expectErr: false,
		},
		{
			name: "Negative concurrency",
			settings: Settings{
				Concurrency: -1,
				TimeoutMs:   1000,
				Profiles:    []FuzzingProfile{ProfileRandom},
			},
			expectErr: true,
		},
		{
			name: "Negative timeout",
			settings: Settings{
				Concurrency: 5,
				TimeoutMs:   -1000,
				Profiles:    []FuzzingProfile{ProfileRandom},
			},
			expectErr: true,
		},
		{
			name: "Invalid fuzzing profile",
			settings: Settings{
				Concurrency: 5,
				TimeoutMs:   1000,
				Profiles:    []FuzzingProfile{FuzzingProfile("INVALID")},
			},
			expectErr: true,
		},
		{
			name: "Zero concurrency and timeout is valid",
			settings: Settings{
				Concurrency: 0,
				TimeoutMs:   0,
				Profiles:    []FuzzingProfile{ProfileRandom},
			},
			expectErr: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.settings.Validate()
			if (err != nil) != tc.expectErr {
				t.Errorf("expected error: %v, got: %v", tc.expectErr, err)
			}
		})
	}
}

func TestValidateBaseURL(t *testing.T) {
	tests := []struct {
		name      string
		baseURL   string
		expectErr bool
	}{
		{
			name:      "Empty base URL is allowed",
			baseURL:   "",
			expectErr: false,
		},
		{
			name:      "Valid HTTP URL",
			baseURL:   "http://localhost:8080",
			expectErr: false,
		},
		{
			name:      "Valid HTTPS URL",
			baseURL:   "https://api.example.com/v1",
			expectErr: false,
		},
		{
			name:      "Invalid URL scheme FTP",
			baseURL:   "ftp://api.example.com",
			expectErr: true,
		},
		{
			name:      "No scheme",
			baseURL:   "api.example.com",
			expectErr: true,
		},
		{
			name:      "Malformed URL",
			baseURL:   "http://[::1%2525-s",
			expectErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateBaseURL(tc.baseURL)
			if (err != nil) != tc.expectErr {
				t.Errorf("expected error: %v, got: %v", tc.expectErr, err)
			}
		})
	}
}

func TestConfigValidate(t *testing.T) {
	tests := []struct {
		name      string
		config    Config
		expectErr bool
	}{
		{
			name: "Valid config",
			config: Config{
				BaseURL: "http://api.example.com",
				Settings: Settings{
					Concurrency: 2,
					TimeoutMs:   1000,
					Profiles:    []FuzzingProfile{ProfileBoundary},
				},
			},
			expectErr: false,
		},
		{
			name: "Config with invalid base URL",
			config: Config{
				BaseURL: "ftp://api.example.com",
				Settings: Settings{
					Concurrency: 2,
					TimeoutMs:   1000,
					Profiles:    []FuzzingProfile{ProfileBoundary},
				},
			},
			expectErr: true,
		},
		{
			name: "Config with invalid settings",
			config: Config{
				BaseURL: "http://api.example.com",
				Settings: Settings{
					Concurrency: -1,
					TimeoutMs:   1000,
					Profiles:    []FuzzingProfile{ProfileBoundary},
				},
			},
			expectErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.config.Validate()
			if (err != nil) != tc.expectErr {
				t.Errorf("expected error: %v, got: %v", tc.expectErr, err)
			}
		})
	}
}
