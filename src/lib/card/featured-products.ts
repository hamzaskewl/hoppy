/**
 * Curated list of brands shown at the top of the catalog. Slugs verified
 * against Bitrefill's US catalog. Color is used for the letter-avatar
 * fallback when no logo is available.
 */

export interface FeaturedProduct {
  slug: string;
  name: string;
  /** Short label for the avatar tile. */
  short: string;
  /** Brand-ish background color for the avatar tile. */
  color: string;
}

export const FEATURED_PRODUCTS: FeaturedProduct[] = [
  { slug: "amazon_com-usa", name: "Amazon", short: "Amazon", color: "#FF9900" },
  { slug: "uber-usa", name: "Uber", short: "Uber", color: "#000000" },
  { slug: "uber-eats-usa", name: "Uber Eats", short: "Uber Eats", color: "#06C167" },
  { slug: "doordash-usa", name: "DoorDash", short: "DoorDash", color: "#FF3008" },
  { slug: "starbucks-usa", name: "Starbucks", short: "Starbucks", color: "#006241" },
  { slug: "walmart-usa", name: "Walmart", short: "Walmart", color: "#0071DC" },
  { slug: "target-usa", name: "Target", short: "Target", color: "#CC0000" },
  { slug: "apple-usa", name: "Apple", short: "Apple", color: "#1A1A1A" },
  { slug: "google-play-usa", name: "Google Play", short: "Play", color: "#4285F4" },
  { slug: "netflix-usa", name: "Netflix", short: "Netflix", color: "#E50914" },
  { slug: "spotify-usa", name: "Spotify", short: "Spotify", color: "#1DB954" },
  { slug: "steam", name: "Steam", short: "Steam", color: "#1B2838" },
  { slug: "playstation-usa", name: "PlayStation", short: "PSN", color: "#003791" },
  { slug: "xbox-usa", name: "Xbox", short: "Xbox", color: "#107C10" },
  { slug: "nike-usa", name: "Nike", short: "Nike", color: "#111111" },
  { slug: "ebay-usa", name: "eBay", short: "eBay", color: "#E53238" },
  { slug: "best-buy-usa", name: "Best Buy", short: "Best Buy", color: "#003B64" },
  { slug: "home-depot-usa", name: "Home Depot", short: "Home Depot", color: "#F96302" },
  { slug: "lyft-usa", name: "Lyft", short: "Lyft", color: "#FF00BF" },
  { slug: "virtual-prepaid-visa-usa", name: "Prepaid Visa", short: "Visa", color: "#1A1F71" },
  { slug: "virtual-prepaid-mastercard-usa", name: "Prepaid Mastercard", short: "MC", color: "#EB001B" },
];

/** Fast lookup of brand metadata for a known slug. */
export const FEATURED_BY_SLUG: Record<string, FeaturedProduct> = Object.fromEntries(
  FEATURED_PRODUCTS.map((p) => [p.slug, p])
);

/** Color generator for non-featured products — deterministic hash → hue. */
export function colorForSlug(slug: string): string {
  const featured = FEATURED_BY_SLUG[slug];
  if (featured) return featured.color;
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

/** First letter (or two) of a brand name for the avatar tile. */
export function shortLabelFor(name: string): string {
  const trimmed = name.replace(/USA|US$/i, "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
