#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <unistd.h>

typedef struct nvpn_box_apple_tls_client nvpn_box_apple_tls_client_t;
typedef struct nvpn_box_apple_tls_read_result nvpn_box_apple_tls_read_result_t;

typedef struct nvpn_box_apple_tls_state {
	uint16_t version;
	uint16_t cipher_suite;
	char *alpn;
	char *server_name;
	uint8_t *peer_cert_chain;
	size_t peer_cert_chain_len;
} nvpn_box_apple_tls_state_t;

nvpn_box_apple_tls_client_t *nvpn_box_apple_tls_client_create(
	int connected_socket,
	const char *server_name,
	const char *alpn,
	size_t alpn_len,
	uint16_t min_version,
	uint16_t max_version,
	bool insecure,
	void *anchors_cf,
	bool anchor_only,
	bool has_verify_time,
	int64_t verify_time_unix_millis,
	char **error_out
);

int nvpn_box_apple_tls_client_wait_ready(nvpn_box_apple_tls_client_t *client, int timeout_msec, char **error_out);
void nvpn_box_apple_tls_client_cancel(nvpn_box_apple_tls_client_t *client);
void nvpn_box_apple_tls_client_free(nvpn_box_apple_tls_client_t *client);
ssize_t nvpn_box_apple_tls_client_read(nvpn_box_apple_tls_client_t *client, void *buffer, size_t buffer_len, int timeout_msec, bool *eof_out, char **error_out);
ssize_t nvpn_box_apple_tls_client_write(nvpn_box_apple_tls_client_t *client, const void *buffer, size_t buffer_len, int timeout_msec, char **error_out);
bool nvpn_box_apple_tls_client_read_async(nvpn_box_apple_tls_client_t *client, size_t maximum_len, uintptr_t callback_handle, char **error_out);
ssize_t nvpn_box_apple_tls_read_result_copy(nvpn_box_apple_tls_read_result_t *result, void *buffer, size_t buffer_len, bool *eof_out, char **error_out);
void nvpn_box_apple_tls_read_result_free(nvpn_box_apple_tls_read_result_t *result);
bool nvpn_box_apple_tls_client_copy_state(nvpn_box_apple_tls_client_t *client, nvpn_box_apple_tls_state_t *state, char **error_out);
void nvpn_box_apple_tls_state_free(nvpn_box_apple_tls_state_t *state);
ssize_t nvpn_box_apple_tls_copy_dispatch_data_for_test(const void *first, size_t first_len, const void *second, size_t second_len, void *buffer, size_t buffer_len, char **error_out);
