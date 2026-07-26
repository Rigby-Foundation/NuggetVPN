package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

type authResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

// serverProfile is the sync server's envelope; `hash` holds the serialized
// Profile rather than a digest, matching the existing server contract.
type serverProfile struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Hash           string `json:"hash"`
	EncryptionType string `json:"encryption_type"`
	UpdatedAt      string `json:"updated_at"`
}

func (c *Client) postJSON(
	ctx context.Context,
	rawURL, token string,
	payload any,
) ([]byte, int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}

	response, err := c.http.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()

	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	return data, response.StatusCode, err
}

// Login exchanges credentials for a bearer token.
func (c *Client) Login(ctx context.Context, server, username, password string) (string, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(server), "/") + "/login"
	data, status, err := c.postJSON(ctx, endpoint, "", map[string]string{
		"username": username,
		"password": password,
	})
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("%s", strings.TrimSpace(string(data)))
	}

	var parsed authResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", fmt.Errorf("unexpected login response: %w", err)
	}
	if parsed.Token == "" {
		return "", fmt.Errorf("no token received")
	}
	return parsed.Token, nil
}

// Register creates an account on the sync server.
func (c *Client) Register(ctx context.Context, server, username, password string) (string, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(server), "/") + "/register"
	data, status, err := c.postJSON(ctx, endpoint, "", map[string]string{
		"username": username,
		"password": password,
	})
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("%s", strings.TrimSpace(string(data)))
	}
	return "Registration successful", nil
}

// PushProfiles uploads every local profile to the sync server.
func (c *Client) PushProfiles(
	ctx context.Context,
	settings models.AppSettings,
	profiles []models.Profile,
) (string, error) {
	server, token, err := syncCredentials(settings)
	if err != nil {
		return "", err
	}
	endpoint := strings.TrimRight(server, "/") + "/profiles"

	for _, profile := range profiles {
		encoded, err := json.Marshal(profile)
		if err != nil {
			return "", err
		}
		data, status, err := c.postJSON(ctx, endpoint, token, map[string]string{
			"name":            profile.Name,
			"hash":            string(encoded),
			"encryption_type": "json",
		})
		if err != nil {
			return "", err
		}
		if status < 200 || status >= 300 {
			return "", fmt.Errorf("failed to push profile %s: %s",
				profile.Name, strings.TrimSpace(string(data)))
		}
	}
	return "All profiles pushed successfully", nil
}

// PullProfiles downloads the profile set stored on the sync server.
func (c *Client) PullProfiles(
	ctx context.Context,
	settings models.AppSettings,
) ([]models.Profile, error) {
	server, token, err := syncCredentials(settings)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(server, "/") + "/profiles"

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)

	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	data, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("%s", strings.TrimSpace(string(data)))
	}

	var remoteProfiles []serverProfile
	if err := json.Unmarshal(data, &remoteProfiles); err != nil {
		return nil, fmt.Errorf("unexpected profiles response: %w", err)
	}

	profiles := make([]models.Profile, 0, len(remoteProfiles))
	for _, remote := range remoteProfiles {
		var profile models.Profile
		// A malformed entry should not discard the rest of the account.
		if err := json.Unmarshal([]byte(remote.Hash), &profile); err != nil {
			continue
		}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}

func syncCredentials(settings models.AppSettings) (server, token string, err error) {
	if settings.AuthServer == nil || strings.TrimSpace(*settings.AuthServer) == "" {
		return "", "", fmt.Errorf("no auth server configured")
	}
	if settings.AuthToken == nil || strings.TrimSpace(*settings.AuthToken) == "" {
		return "", "", fmt.Errorf("no auth token configured")
	}
	return strings.TrimSpace(*settings.AuthServer), strings.TrimSpace(*settings.AuthToken), nil
}
