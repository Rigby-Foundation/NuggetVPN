import { describe, expect, test } from "bun:test";
import { canEditProxyForm, parseProxyLink, serializeProxyConfig } from "../src/lib/proxy-config";
import { validDnsAddress } from "../src/lib/dns";

describe("server editor preserves native options", () => {
  test("advanced and unsupported configs stay in the raw editor", () => {
    for (const raw of [
      '{"protocol":"vless","streamSettings":{"network":"xhttp"}}',
      "vless://id@example.com:443?type=xhttp&extra=%7B%7D",
      "vless://id@example.com:443?type=http",
      "vless://id@example.com:443?packetEncoding=packetaddr",
      "vless://id@example.com:443?encryption=mlkem768x25519plus.native.0rtt",
      "tuic://id:secret@example.com:443",
      "ssh://user:secret@example.com:22",
      "hysteria2://secret@example.com:443?fp=chrome",
    ]) expect(canEditProxyForm(raw)).toBe(false);
  });

  test("Trojan REALITY is preserved when saving a form", () => {
    const raw = "trojan://secret@example.com:443?security=reality&sni=example.com&pbk=key&sid=abcd&spx=%2Ftest";
    expect(canEditProxyForm(raw)).toBe(true);
    const saved = new URL(serializeProxyConfig(parseProxyLink(raw)));
    for (const key of ["security", "sni", "pbk", "sid", "spx"])
      expect(saved.searchParams.get(key)).toBe(new URL(raw).searchParams.get(key));
  });

  test("Hysteria 2 keeps full authentication, port hopping and TLS options", () => {
    const raw = "hy2://user:secret@example.com:443?sni=example.com&mport=20000-20100&obfs=salamander&obfs-password=secret&alpn=h3";
    expect(canEditProxyForm(raw)).toBe(true);
    const saved = new URL(serializeProxyConfig(parseProxyLink(raw)));
    expect(decodeURIComponent(saved.username)).toBe("user:secret");
    for (const key of ["sni", "mport", "obfs", "obfs-password", "alpn"])
      expect(saved.searchParams.get(key)).toBe(new URL(raw).searchParams.get(key));
  });
});

test("DNS editor accepts only resolver transports routed through the tunnel", () => {
  for (const value of ["1.1.1.1", "udp://1.1.1.1", "tcp://1.1.1.1", "https://dns.google/dns-query"])
    expect(validDnsAddress(value)).toBe(true);
  for (const value of ["tls://one.one.one.one", "quic://dns.example.com", "h3://dns.google", "local", "system"])
    expect(validDnsAddress(value)).toBe(false);
});
