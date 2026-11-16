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

// serverProfile is NuggetSync's storage row. Its numeric ID increases with
// each upload; hash is an opaque, client-encrypted snapshot, not a digest.
type serverProfile struct {
	ID             int64  `json:"id"`
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

// PushProfiles uploads one encrypted snapshot. NuggetSync appends rows rather
// than updating them, so a snapshot also represents deletions without reviving
// old profiles on the next download.
func (c *Client) PushProfiles(
	ctx context.Context,
	settings models.AppSettings,
	profiles []models.Profile,
	password string,
) (string, error) {
	server, token, err := syncCredentials(settings)
	if err != nil {
		return "", err
	}
	endpoint := strings.TrimRight(server, "/") + "/profiles"

	encoded, err := sealSyncProfiles(profiles, password)
	if err != nil {
		return "", err
	}
	data, status, err := c.postJSON(ctx, endpoint, token, map[string]string{
		"name":            "Kage profiles",
		"hash":            encoded,
		"encryption_type": syncCipher,
	})
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("failed to upload profiles: %s", strings.TrimSpace(string(data)))
	}
	return "All profiles pushed successfully", nil
}

// PullProfiles downloads the profile set stored on the sync server.
func (c *Client) PullProfiles(
	ctx context.Context,
	settings models.AppSettings,
	password string,
) ([]models.Profile, error) {
	server, token, err := syncCredentials(settings)
	if err != nil {
		return nil, err
	}
	if password == "" {
		return nil, errSyncPasswordRequired
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

	const maxResponse = 32 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponse+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxResponse {
		return nil, fmt.Errorf("sync response is too large")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("%s", strings.TrimSpace(string(data)))
	}

	var remoteProfiles []serverProfile
	if err := json.Unmarshal(data, &remoteProfiles); err != nil {
		return nil, fmt.Errorf("unexpected profiles response: %w", err)
	}

	if len(remoteProfiles) == 0 {
		// nil means this account has no saved snapshot. An explicitly empty
		// decrypted list, in contrast, is a valid snapshot of zero profiles.
		return nil, nil
	}
	latest := remoteProfiles[0]
	for _, row := range remoteProfiles {
		if row.ID <= 0 {
			return nil, fmt.Errorf("invalid sync profile ID")
		}
		if row.ID > latest.ID {
			latest = row
		}
	}
	return openSyncProfiles(latest.Hash, password)
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
