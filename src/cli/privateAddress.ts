import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** Loopback, private (RFC 1918, ULA), link-local, CGNAT and unspecified ranges. */
const PRIVATE = new BlockList();
PRIVATE.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addAddress("::", "ipv6");
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");

/** The IP is loopback, private, link-local, CGNAT or unspecified (IPv4-mapped IPv6 included). */
export function isPrivateIp(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped !== undefined) return PRIVATE.check(mapped, "ipv4");
  const family = isIP(ip);
  if (family === 0) return false;
  return PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * A URL hostname is private when it is a private IP literal, "localhost" (or a *.localhost name),
 * or when DNS resolves it to any private address. Unresolvable names count as public.
 *
 * Limitation: this is a point-in-time lookup. fetch() resolves the name again to connect, so a
 * DNS-rebinding host (public answer here, private answer there) is not detected.
 */
export async function isPrivateHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host) !== 0) return isPrivateIp(host);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    return addrs.some((a) => isPrivateIp(a.address));
  } catch {
    return false;
  }
}
