"use client";

import { motion } from "framer-motion";
import { Shield, Lock, Loader2 } from "lucide-react";

interface ShieldingAnimationProps {
  status: "detecting" | "shielding" | "complete" | "error";
  message?: string;
}

export function ShieldingAnimation({ status, message }: ShieldingAnimationProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* Main Animation Container */}
      <div className="relative w-40 h-40 flex items-center justify-center">
        {/* Outer Ring */}
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-hop-500/30"
          animate={
            status === "shielding"
              ? {
                  scale: [1, 1.1, 1],
                  opacity: [0.3, 0.6, 0.3],
                }
              : {}
          }
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {/* Middle Ring */}
        <motion.div
          className="absolute inset-4 rounded-full border-2 border-hop-500/50"
          animate={
            status === "shielding"
              ? {
                  scale: [1, 1.15, 1],
                  opacity: [0.5, 0.8, 0.5],
                }
              : {}
          }
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.3,
          }}
        />

        {/* Inner Glow */}
        <motion.div
          className="absolute inset-8 rounded-full bg-hop-500/20"
          animate={
            status === "shielding"
              ? {
                  scale: [1, 1.2, 1],
                  opacity: [0.2, 0.4, 0.2],
                }
              : status === "complete"
              ? { scale: 1, opacity: 0.3 }
              : {}
          }
          transition={{
            duration: 1.5,
            repeat: status === "shielding" ? Infinity : 0,
            ease: "easeInOut",
          }}
        />

        {/* Center Icon */}
        <motion.div
          className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center ${
            status === "complete"
              ? "bg-hop-500"
              : status === "error"
              ? "bg-red-500/20"
              : "bg-hop-500/20"
          }`}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          {status === "detecting" && (
            <Loader2 className="w-8 h-8 text-hop-600 dark:text-hop-400 animate-spin" />
          )}
          {status === "shielding" && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            >
              <Shield className="w-10 h-10 text-hop-600 dark:text-hop-400" />
            </motion.div>
          )}
          {status === "complete" && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 10 }}
            >
              <Lock className="w-10 h-10 text-white" />
            </motion.div>
          )}
          {status === "error" && (
            <span className="text-3xl">!</span>
          )}
        </motion.div>

        {/* Particles (only during shielding) */}
        {status === "shielding" && (
          <>
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 rounded-full bg-hop-400"
                initial={{
                  x: 0,
                  y: 0,
                  opacity: 0,
                }}
                animate={{
                  x: [0, Math.cos((i * 60 * Math.PI) / 180) * 60],
                  y: [0, Math.sin((i * 60 * Math.PI) / 180) * 60],
                  opacity: [0, 1, 0],
                  scale: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: "easeOut",
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* Status Text */}
      <motion.div
        className="mt-8 text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h3 className="text-xl font-semibold mb-2">
          {status === "detecting" && "Detecting Funds..."}
          {status === "shielding" && "Shielding Funds..."}
          {status === "complete" && "Funds Shielded!"}
          {status === "error" && "Shielding Failed"}
        </h3>
        <p className="text-muted-foreground text-sm max-w-xs">
          {status === "detecting" &&
            "Reading claim note and verifying..."}
          {status === "shielding" &&
            "Processing your claim. This may take a moment..."}
          {status === "complete" &&
            "Funds verified. Ready to withdraw."}
          {status === "error" && (message || "Something went wrong. Please try again.")}
        </p>
      </motion.div>
    </div>
  );
}
