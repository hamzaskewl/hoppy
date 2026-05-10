/**
 * Curated list of brands shown at the top of the catalog. Slugs verified
 * against Bitrefill's US catalog. Domain is used to fetch a real logo from
 * Clearbit's free public logo API; color is the avatar-tile fallback when
 * no logo loads.
 *
 * NOTE: Some big-tech brands (Amazon, Apple, Google Play) require special
 * Bitrefill partner approval and are NOT enabled on most API accounts. They
 * are intentionally absent from this list. The UI surfaces a clean error if
 * a user picks a restricted product via search.
 */

export interface FeaturedProduct {
  slug: string;
  name: string;
  /** Short label for the avatar tile (used as logo-load fallback). */
  short: string;
  /** Brand-ish background color for the avatar tile. */
  color: string;
  /** Domain for Clearbit logo lookup (e.g. "uber.com"). */
  domain?: string;
}

export const FEATURED_PRODUCTS: FeaturedProduct[] = [
  { slug: "uber-usa", name: "Uber", short: "Uber", color: "#000000", domain: "uber.com" },
  { slug: "uber-eats-usa", name: "Uber Eats", short: "Uber Eats", color: "#06C167", domain: "ubereats.com" },
  { slug: "doordash-usa", name: "DoorDash", short: "DoorDash", color: "#FF3008", domain: "doordash.com" },
  { slug: "starbucks-usa", name: "Starbucks", short: "Starbucks", color: "#006241", domain: "starbucks.com" },
  { slug: "walmart-usa", name: "Walmart", short: "Walmart", color: "#0071DC", domain: "walmart.com" },
  { slug: "target-usa", name: "Target", short: "Target", color: "#CC0000", domain: "target.com" },
  { slug: "netflix-usa", name: "Netflix", short: "Netflix", color: "#E50914", domain: "netflix.com" },
  { slug: "spotify-usa", name: "Spotify", short: "Spotify", color: "#1DB954", domain: "spotify.com" },
  { slug: "steam", name: "Steam", short: "Steam", color: "#1B2838", domain: "steampowered.com" },
  { slug: "playstation-usa", name: "PlayStation", short: "PSN", color: "#003791", domain: "playstation.com" },
  { slug: "xbox-usa", name: "Xbox", short: "Xbox", color: "#107C10", domain: "xbox.com" },
  { slug: "nike-usa", name: "Nike", short: "Nike", color: "#111111", domain: "nike.com" },
  { slug: "ebay-usa", name: "eBay", short: "eBay", color: "#E53238", domain: "ebay.com" },
  { slug: "best-buy-usa", name: "Best Buy", short: "Best Buy", color: "#003B64", domain: "bestbuy.com" },
  { slug: "home-depot-usa", name: "Home Depot", short: "Home Depot", color: "#F96302", domain: "homedepot.com" },
  { slug: "lyft-usa", name: "Lyft", short: "Lyft", color: "#FF00BF", domain: "lyft.com" },
  { slug: "airbnb-usa", name: "Airbnb", short: "Airbnb", color: "#FF5A5F", domain: "airbnb.com" },
  { slug: "hotels-com-usa", name: "Hotels.com", short: "Hotels", color: "#D32F2F", domain: "hotels.com" },
  { slug: "virtual-prepaid-visa-usa", name: "Prepaid Visa", short: "Visa", color: "#1A1F71", domain: "visa.com" },
  { slug: "virtual-prepaid-mastercard-usa", name: "Prepaid Mastercard", short: "MC", color: "#EB001B", domain: "mastercard.com" },
];

/** Fast lookup of brand metadata for a known slug. */
export const FEATURED_BY_SLUG: Record<string, FeaturedProduct> = Object.fromEntries(
  FEATURED_PRODUCTS.map((p) => [p.slug, p])
);

/** Color generator for non-featured products — deterministic hash → hue. */
export function colorForSlug(slug: string | undefined | null): string {
  if (!slug) return "#6b7280";
  const featured = FEATURED_BY_SLUG[slug];
  if (featured) return featured.color;
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

/** First letter (or two) of a brand name for the avatar tile. */
export function shortLabelFor(name: string | undefined | null): string {
  if (!name) return "?";
  const trimmed = name.replace(/USA|US$/i, "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Best-effort domain inference from a Bitrefill slug, for non-featured
 * products. Strips trailing -usa/-us/-uk/etc and joins the rest with .com.
 * Returns null if we can't make a reasonable guess.
 */
export function domainForSlug(slug: string | undefined | null): string | null {
  if (!slug) return null;
  const featured = FEATURED_BY_SLUG[slug];
  if (featured?.domain) return featured.domain;

  const cleaned = slug
    .replace(/-(usa|us|uk|ca|eu|au|in|de|fr|jp|cn|br|mx|sg|nl|kr|it|es)$/i, "")
    .replace(/_com$/i, "")
    .replace(/_/g, "-");

  if (!cleaned || /^(virtual|physical|prepaid|digital)-/.test(cleaned)) return null;

  // Single token → "{token}.com"
  const parts = cleaned.split("-").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return `${parts[0]}.com`;
  // Multi token: try {first}{rest}.com (e.g. "home-depot" → "homedepot.com")
  return `${parts.join("")}.com`;
}

/** Public Clearbit logo URL for a domain. Free, no auth, returns 404 if missing. */
export function logoUrlForDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}
