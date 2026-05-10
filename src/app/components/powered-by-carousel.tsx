"use client";

import Image from "next/image";
import { motion } from "framer-motion";

type Partner = {
  name: string;
  src?: string;
  // For partners with separate light/dark logos
  srcLight?: string;
  srcDark?: string;
  rounded?: boolean;
};

const partners: Partner[] = [
  { name: "Umbra", src: "/umbra-logo.svg" },
  { name: "Helius", src: "/Helius-Vertical-Logo.png" },
  { name: "Solana", src: "/sol.svg" },
  {
    name: "Privy",
    srcLight: "/Privy_Symbol_Black.png",
    srcDark: "/Privy_Symbol_White.png",
  },
  // TODO: drop /public/bitrefill-logo.svg in and re-enable
  // { name: "Bitrefill", src: "/bitrefill-logo.svg" },
];

function PartnerLogo({ partner }: { partner: Partner }) {
  return (
    <div className="flex flex-col items-center group transition-all duration-300 mx-10 md:mx-14 shrink-0">
      <div className="relative w-24 h-24 mb-5 transition-transform duration-300 group-hover:scale-110">
        {partner.rounded ? (
          <div className="w-full h-full rounded-full overflow-hidden bg-white dark:bg-gray-100 shadow-md flex items-center justify-center">
            <Image
              src={partner.src!}
              alt={partner.name}
              width={80}
              height={80}
              className="object-contain scale-110"
            />
          </div>
        ) : partner.srcLight && partner.srcDark ? (
          <>
            <Image
              src={partner.srcLight}
              alt={partner.name}
              fill
              className="object-contain dark:hidden"
            />
            <Image
              src={partner.srcDark}
              alt={partner.name}
              fill
              className="object-contain hidden dark:block"
            />
          </>
        ) : (
          <Image
            src={partner.src!}
            alt={partner.name}
            fill
            className="object-contain"
          />
        )}
      </div>
      <span className="text-sm tracking-wide text-foreground/70 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
        {partner.name}
      </span>
    </div>
  );
}

export function PoweredByCarousel() {
  // Triple the list so the seamless loop has runway at any viewport width
  const loop = [...partners, ...partners, ...partners];

  return (
    <div className="relative overflow-hidden max-w-3xl mx-auto">
      {/* Edge fades — match parent bg-card so the loop seam is invisible */}
      <div className="absolute left-0 top-0 bottom-0 w-20 md:w-32 bg-gradient-to-r from-card via-card to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-20 md:w-32 bg-gradient-to-l from-card via-card to-transparent z-10 pointer-events-none" />

      <motion.div
        className="flex items-center w-max"
        animate={{ x: ["0%", "-33.3333%"] }}
        transition={{
          duration: 28,
          repeat: Infinity,
          ease: "linear",
        }}
      >
        {loop.map((partner, i) => (
          <PartnerLogo key={`${partner.name}-${i}`} partner={partner} />
        ))}
      </motion.div>
    </div>
  );
}
