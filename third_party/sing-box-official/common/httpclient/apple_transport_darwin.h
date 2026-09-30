#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct nvpn_box_apple_http_session nvpn_box_apple_http_session_t;
typedef struct nvpn_box_apple_http_task nvpn_box_apple_http_task_t;

typedef struct nvpn_box_apple_http_session_config {
	const char *proxy_host;
	int proxy_port;
	const char *proxy_username;
	const char *proxy_password;
	uint16_t min_tls_version;
	uint16_t max_tls_version;
	bool insecure;
	void *anchors_cf;
	bool anchor_only;
	const uint8_t *pinned_certificate_sha256;
	size_t pinned_certificate_sha256_len;
	const uint8_t *pinned_public_key_sha256;
	size_t pinned_public_key_sha256_len;
} nvpn_box_apple_http_session_config_t;

typedef struct nvpn_box_apple_http_request {
	const char *method;
	const char *url;
	const char **header_keys;
	const char **header_values;
	size_t header_count;
	const uint8_t *body;
	size_t body_len;
	bool has_verify_time;
	int64_t verify_time_unix_millis;
} nvpn_box_apple_http_request_t;

typedef struct nvpn_box_apple_http_response {
	int status_code;
	char **header_keys;
	char **header_values;
	size_t header_count;
	uint8_t *body;
	size_t body_len;
	char *error;
} nvpn_box_apple_http_response_t;

nvpn_box_apple_http_session_t *nvpn_box_apple_http_session_create(
	const nvpn_box_apple_http_session_config_t *config,
	char **error_out
);
void nvpn_box_apple_http_session_retire(nvpn_box_apple_http_session_t *session);
void nvpn_box_apple_http_session_close(nvpn_box_apple_http_session_t *session);

nvpn_box_apple_http_task_t *nvpn_box_apple_http_session_send_async(
	nvpn_box_apple_http_session_t *session,
	const nvpn_box_apple_http_request_t *request,
	char **error_out
);
nvpn_box_apple_http_response_t *nvpn_box_apple_http_task_wait(
	nvpn_box_apple_http_task_t *task,
	char **error_out
);
void nvpn_box_apple_http_task_cancel(nvpn_box_apple_http_task_t *task);
void nvpn_box_apple_http_task_close(nvpn_box_apple_http_task_t *task);

void nvpn_box_apple_http_response_free(nvpn_box_apple_http_response_t *response);

char *nvpn_box_apple_http_verify_pinned_certificate(
	uint8_t *certificate_hash_values,
	size_t certificate_hash_values_len,
	uint8_t *public_key_hash_values,
	size_t public_key_hash_values_len,
	uint8_t *leaf_cert,
	size_t leaf_cert_len
);
