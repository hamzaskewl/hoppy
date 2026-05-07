"use client";
import dynamic from "next/dynamic";
import { NavHeader } from "@/components/nav-header";

const PayrollClaim = dynamic(
  () =>
    import("@/components/payroll/payroll-claim").then((mod) => ({
      default: mod.PayrollClaim,
    })),
  { ssr: false },
);

export default function PayrollClaimPage() {
  return (
    <div className="min-h-screen flex flex-col relative">
      <div
        className="absolute inset-0 -z-10 dark:hidden"
        style={{
          backgroundImage: "url('/hoppy-bg-tile.png')",
          backgroundRepeat: "repeat",
          filter: "blur(6px)",
        }}
      />
      <div
        className="absolute inset-0 -z-10 hidden dark:block"
        style={{
          backgroundImage: "url('/hoppy-bgblack.png')",
          backgroundRepeat: "repeat",
          filter: "blur(6px)",
        }}
      />
      <NavHeader />
      <main className="flex-1 py-12 px-4">
        <div className="max-w-xl mx-auto">
          <PayrollClaim />
        </div>
      </main>
    </div>
  );
}
