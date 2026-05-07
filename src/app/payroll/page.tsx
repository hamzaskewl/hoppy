"use client";
import dynamic from "next/dynamic";
import { NavHeader } from "@/components/nav-header";

const PayrollDashboard = dynamic(
  () =>
    import("@/components/payroll/payroll-dashboard").then((mod) => ({
      default: mod.PayrollDashboard,
    })),
  { ssr: false },
);

export default function PayrollPage() {
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
      <main className="flex-1 py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <PayrollDashboard />
        </div>
      </main>
    </div>
  );
}
