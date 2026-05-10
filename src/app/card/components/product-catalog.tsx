"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { Search, Loader2, Sparkles, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FEATURED_PRODUCTS,
  FEATURED_BY_SLUG,
  colorForSlug,
  shortLabelFor,
} from "@/lib/card/featured-products";

interface ProductSummary {
  slug: string;
  name: string;
  type?: string;
  categories?: string[];
  countries?: string[];
  currency?: string;
  keywords?: string[];
}

const QUICK_AMOUNTS = [5, 15, 25];

function ProductTile({
  product,
  onSelect,
}: {
  product: ProductSummary;
  onSelect: (slug: string, amount?: number) => void;
}) {
  const featured = FEATURED_BY_SLUG[product.slug];
  const color = colorForSlug(product.slug);
  const label = featured?.short ?? shortLabelFor(product.name);

  return (
    <div className="group rounded-2xl border-2 border-border bg-card overflow-hidden hover:border-hop-400 transition-colors flex flex-col">
      <button
        onClick={() => onSelect(product.slug)}
        className="flex-1 p-4 text-left flex flex-col gap-3"
      >
        <div
          className="w-full aspect-square rounded-xl flex items-center justify-center text-white font-bold text-xl border-2 border-border/40 shadow-sm"
          style={{ backgroundColor: color }}
        >
          <span className="px-2 text-center leading-tight break-words">{label}</span>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium truncate">{product.name}</p>
          {product.categories && product.categories[0] && (
            <p className="text-xs text-muted-foreground capitalize truncate">
              {product.categories[0].replace(/-/g, " ")}
            </p>
          )}
        </div>
      </button>
      <div className="grid grid-cols-3 border-t-2 border-border">
        {QUICK_AMOUNTS.map((value, idx) => (
          <button
            key={value}
            onClick={() => onSelect(product.slug, value)}
            className={cn(
              "py-2 text-xs font-medium hover:bg-hop-100 dark:hover:bg-hop-500/10 transition-colors",
              idx > 0 && "border-l-2 border-border"
            )}
          >
            ${value}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Cheap fuzzy ranking — featured brands always rank above search hits, and
 * exact prefix matches outrank substring matches. Bitrefill's server-side
 * search is lexical, so we re-rank client-side to surface the brands the
 * user likely meant first.
 */
function rankProducts(products: ProductSummary[], query: string): ProductSummary[] {
  if (!query || query === "*") return products;
  const q = query.toLowerCase().trim();
  return [...products].sort((a, b) => {
    const score = (p: ProductSummary) => {
      const name = p.name.toLowerCase();
      let s = 0;
      if (FEATURED_BY_SLUG[p.slug]) s += 100;
      if (name === q) s += 80;
      if (name.startsWith(q)) s += 40;
      if (name.includes(q)) s += 20;
      if (p.keywords?.some((k) => k.toLowerCase().includes(q))) s += 10;
      return s;
    };
    return score(b) - score(a);
  });
}

export function ProductCatalog({
  onSelect,
}: {
  onSelect: (slug: string, amount?: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const fetchProducts = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/card/products?q=${encodeURIComponent(q || "*")}&per_page=60`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load products");
      setProducts(data.products || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: pull all products. We use the catalog at large + the
  // hardcoded featured list for the curated row.
  useEffect(() => {
    fetchProducts(debounced || "*");
  }, [debounced, fetchProducts]);

  const isSearching = debounced.length > 0;
  const ranked = useMemo(() => rankProducts(products, debounced), [products, debounced]);

  // For the featured row, prefer freshly-fetched data (so we know each is
  // in-stock); fall back to the hardcoded list when no data has loaded yet.
  const featuredRow = useMemo<ProductSummary[]>(() => {
    if (products.length === 0) {
      return FEATURED_PRODUCTS.map((p) => ({ slug: p.slug, name: p.name }));
    }
    const bySlug: Record<string, ProductSummary> = Object.fromEntries(
      products.map((p) => [p.slug, p])
    );
    return FEATURED_PRODUCTS.map((f) => bySlug[f.slug] || { slug: f.slug, name: f.name });
  }, [products]);

  return (
    <div className="space-y-8">
      {/* Search */}
      <div className="relative max-w-xl mx-auto">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Amazon, Uber, Starbucks, Visa..."
          className="pl-10 py-6 bg-card border-2 border-border text-base"
        />
        {loading && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {error && (
        <div className="max-w-xl mx-auto p-3 rounded-xl bg-red-100 dark:bg-red-500/10 border-2 border-red-400 text-red-700 dark:text-red-200 text-sm">
          {error}
        </div>
      )}

      {!isSearching && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-hop-500" />
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Popular brands
            </h2>
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
          >
            {featuredRow.map((product) => (
              <ProductTile key={product.slug} product={product} onSelect={onSelect} />
            ))}
          </motion.div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-hop-500" />
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {isSearching ? `Results for "${debounced}"` : "All gift cards"}
          </h2>
          {!loading && (
            <span className="text-xs text-muted-foreground">
              ({ranked.length}
              {ranked.length === 60 ? "+" : ""})
            </span>
          )}
        </div>

        {ranked.length === 0 && !loading && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No products found. Try a different search term.
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {ranked.map((product) => (
            <ProductTile key={product.slug} product={product} onSelect={onSelect} />
          ))}
        </div>
      </section>
    </div>
  );
}
