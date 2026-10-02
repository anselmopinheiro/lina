/**
 * Endpoint Locality (Phase LINA-15F)
 *
 * Pure, syntactic classification of a provider Base URL. "Local" means the request is addressed to
 * this very machine (loopback), i.e. note content does not leave the device. It deliberately does
 * NOT use DNS, network ranges or hostname heuristics: LAN hosts and private addresses are remote
 * from the point of view of "does not leave this device".
 *
 * Anything that cannot be proven loopback from the URL alone is classified as not local
 * (conservative side).
 */

export type EndpointLocality = "loopback" | "remote" | "invalid";

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet))) {
    return false;
  }
  const values = octets.map(Number);
  if (values.some((value) => value > 255)) {
    return false;
  }
  // 127.0.0.0/8 is loopback; 0.0.0.0 is the unspecified address and addresses the local host.
  return values[0] === 127 || values.every((value) => value === 0);
}

function isLoopbackIpv6(hostname: string): boolean {
  const address = stripIpv6Brackets(hostname).toLowerCase();
  if (address === "::1" || address === "::") {
    return true;
  }
  // IPv4-mapped loopback as normalised by the WHATWG URL parser, e.g. ::ffff:7f00:1
  return /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(address);
}

/**
 * Classifies a Base URL. Only `http:` and `https:` URLs with a host can be loopback or remote;
 * everything else (empty, malformed, other schemes) is `invalid`.
 */
export function classifyEndpointLocality(baseUrl: string | null | undefined): EndpointLocality {
  const trimmed = typeof baseUrl === "string" ? baseUrl.trim() : "";
  if (trimmed.length === 0) {
    return "invalid";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "invalid";
  }

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.hostname.length === 0) {
    return "invalid";
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "loopback";
  }
  if (isLoopbackIpv4(hostname) || isLoopbackIpv6(hostname)) {
    return "loopback";
  }
  return "remote";
}

export function isLoopbackEndpoint(baseUrl: string | null | undefined): boolean {
  return classifyEndpointLocality(baseUrl) === "loopback";
}
