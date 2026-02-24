"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Lock, Loader2, AlertCircle } from "lucide-react";

interface ShieldingAnimationProps {
  status: "detecting" | "shielding" | "complete" | "error";
  message?: string;
}

export function ShieldingAnimation({ status, message }: ShieldingAnimationProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* Main Animation Container */}
      <div className="relative w-40 h-40 flex items-center justify-center">
        {/* Outer Ring - pulsing */}
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-hop-500/30"
          animate={
            status === "shielding" || status === "detecting"
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

        {/* Middle Ring - pulsing with offset */}
        <motion.div
          className="absolute inset-4 rounded-full border-2 border-hop-500/50"
          animate={
            status === "shielding" || status === "detecting"
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
            status === "shielding" || status === "detecting"
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
            repeat: status === "shielding" || status === "detecting" ? Infinity : 0,
            ease: "easeInOut",
          }}
        />

        {/* Center Icon/Image */}
        <motion.div
          className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center overflow-hidden ${
            status === "complete"
              ? "bg-hop-500"
              : status === "error"
              ? "bg-red-500/20"
              : "bg-transparent"
          }`}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          {status === "detecting" && (
            <motion.div
              animate={{ 
                y: [0, -8, 0],
                scale: [1, 1.05, 1],
              }}
              transition={{ 
                duration: 0.8, 
                repeat: Infinity, 
                ease: "easeInOut" 
              }}
            >
              <Image
                src="/bunnyspin.png"
                alt="Loading"
                width={80}
                height={80}
                className="object-contain"
              />
            </motion.div>
          )}
          {status === "shielding" && (
            <motion.div
              animate={{ 
                y: [0, -10, 0],
                rotate: [0, 5, -5, 0],
                scale: [1, 1.1, 1],
              }}
              transition={{ 
                duration: 1.2, 
                repeat: Infinity, 
                ease: "easeInOut" 
              }}
            >
              <Image
                src="/bunnyspin.png"
                alt="Processing"
                width={80}
                height={80}
                className="object-contain"
              />
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
            <AlertCircle className="w-10 h-10 text-red-500" />
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
          {status === "detecting" && "Finding Your Funds..."}
          {status === "shielding" && "Hopping Through Privacy..."}
          {status === "complete" && "Claim Complete!"}
          {status === "error" && "Something Went Wrong"}
        </h3>
        <p className="text-muted-foreground text-sm max-w-xs">
          {status === "detecting" &&
            "Reading your claim link..."}
          {status === "shielding" &&
            "Processing your private claim. This may take a moment..."}
          {status === "complete" &&
            "Funds are on their way to your wallet."}
          {status === "error" && (message || "Please try again or contact support.")}
        </p>
      </motion.div>
    </div>
  );
}
