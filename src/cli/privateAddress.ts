import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * IPv4 ranges that are not public unicast: unspecified ("this network"), private (RFC 1918),
 * CGNAT, loopback, link-local, IETF protocol assignments, benchmarking (198.18.0.0/15), multicast,
 * reserved and broadcast.
 */
const PRIVATE_V4 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_V4.addSubnet(net, bits, "ipv4");
}

/** IPv6 ranges that are not public unicast: ULA, link-local, the deprecated site-local, multicast and local-use NAT64. */
const PRIVATE_V6 = new BlockList();
for (const [net, bits] of [
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["64:ff9b:1::", 48],
] as const) {
  PRIVATE_V6.addSubnet(net, bits, "ipv6");
}

/** The 16 bytes of an IPv6 address (a trailing dotted IPv4 part allowed), else null. */
function ipv6Bytes(ip: string): number[] | null {
  let s = ip;
  const tail: number[] = [];
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    if (isIP(dotted[2]!) !== 4) return null;
    tail.push(...dotted[2]!.split(".").map(Number));
    s = dotted[1]!.endsWith("::") ? dotted[1]! : dotted[1]!.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]!);
  const rest = halves.length === 2 ? groups(halves[1]!) : [];
  const want = 8 - tail.length / 2;
  const fill = halves.length === 2 ? want - head.length - rest.length : 0;
  if (fill < 0 || head.length + fill + rest.length !== want) return null;
  const words = [...head, ...Array<string>(fill).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const w of words) {
    if (!/^[0-9a-f]{1,4}$/i.test(w)) return null;
    const n = parseInt(w, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return [...bytes, ...tail];
}

const v4 = (b: number[], at: number): string => b.slice(at, at + 4).join(".");
const zero = (b: number[], from: number, to: number): boolean => b.slice(from, to).every((x) => x === 0);

/** The IPv4 address an IPv6 address carries (mapped, compatible, NAT64 or 6to4), else undefined. */
function embeddedV4(b: number[]): string | undefined {
  if (zero(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) return v4(b, 12); // ::ffff:0:0/96
  if (zero(b, 0, 12)) return v4(b, 12); // ::/96 (IPv4-compatible; :: and ::1 fall in 0.0.0.0/8)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(b, 4, 12)) return v4(b, 12); // 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) return v4(b, 2); // 2002::/16 (6to4)
  return undefined;
}

/**
 * The IP is not a public unicast address: loopback, private, link-local, CGNAT, unspecified,
 * benchmarking, multicast or reserved. IPv6 forms that embed an IPv4 address (mapped, compatible,
 * NAT64, 6to4) are judged by that address. A zone index ("fe80::1%lo0") is ignored.
 */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.replace(/%.*$/, "");
  const family = isIP(addr);
  if (family === 4) return PRIVATE_V4.check(addr, "ipv4");
  if (family !== 6) return false;
  const bytes = ipv6Bytes(addr);
  if (bytes === null) return false;
  const inner = embeddedV4(bytes);
  if (inner !== undefined) return PRIVATE_V4.check(inner, "ipv4");
  return PRIVATE_V6.check(addr, "ipv6");
}

/**
 * A URL hostname is private when it is a private IP literal, "localhost" (or a *.localhost name),
 * or when DNS resolves it to any private address. Unresolvable names count as public.
 *
 * This is a point-in-time lookup, used to classify hosts. Connections are checked separately, at
 * connect time, by the address they actually use (see fetchText's `allowAddress`).
 */
export async function isPrivateHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host.replace(/%.*$/, "")) !== 0) return isPrivateIp(host);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    return addrs.some((a) => isPrivateIp(a.address));
  } catch {
    return false;
  }
}
