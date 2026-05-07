'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { LucideIcon, Dumbbell, Droplets, Utensils, Brain, User, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

const ThreeCanvas = dynamic(
  () => import('@/components/three/three-canvas').then((m) => m.ThreeCanvas),
  { ssr: false }
);

const WellnessBodyScene = dynamic(
  () => import('@/components/three/wellness-body-scene').then((m) => m.WellnessBodyScene),
  { ssr: false }
);

interface ProgressBarProps {
  label: string;
  value: number;
  icon: LucideIcon;
  fillClass: string;
  side: 'left' | 'right';
}

const ProgressBar = ({ label, value, icon: Icon, fillClass, side }: ProgressBarProps) => {
  const isLeft = side === 'left';
  
  return (
    <div className={cn(
      "flex flex-col gap-1 w-full max-w-[180px]",
      isLeft ? "items-end text-right" : "items-start text-left"
    )}>
      <div className={cn(
        "flex items-center gap-2 text-[10px] font-bold uppercase tracking-tighter text-muted-foreground",
        isLeft ? "flex-row-reverse" : "flex-row"
      )}>
        <Icon className="h-3 w-3 text-emerald-400/80" />
        <span>{label}</span>
      </div>
      
      <div className="relative w-full h-10 rounded-2xl border border-emerald-500/10 bg-black/40 overflow-hidden shadow-inner">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1.5, ease: "circOut" }}
          className={cn(
            "absolute inset-y-0 h-full rounded-2xl shadow-[0_0_14px_rgba(45,212,191,0.22)]",
            fillClass,
            isLeft ? "right-0" : "left-0"
          )}
        />
        <div className={cn(
          "absolute inset-0 flex items-center px-3 z-10",
          isLeft ? "justify-start" : "justify-end"
        )}>
          <span className="text-xs font-black tabular-nums text-emerald-50 drop-shadow-[0_0_8px_rgba(16,185,129,0.35)]">
            {Math.round(value)}%
          </span>
        </div>
      </div>
    </div>
  );
};

interface WellnessScores {
  exercise: number;
  water: number;
  food: number;
  stress: number;
  relaxation: number;
  sleep: number;
}

function averageWellnessScore(scores: WellnessScores) {
  const sum =
    scores.exercise +
    scores.water +
    scores.food +
    scores.stress +
    scores.relaxation +
    scores.sleep;
  return sum / 6;
}

export function WellnessBodyVisualizer({ scores }: { scores: WellnessScores }) {
  const averageScore = averageWellnessScore(scores);

  return (
    <div className="relative overflow-hidden border-t border-emerald-500/10 bg-gradient-to-b from-emerald-500/[0.04] via-transparent to-transparent px-6 py-8 md:px-8">
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center p-3"
        aria-hidden
      >
        {/* CSS-only “hologram” backdrop — no missing asset (was /blueprint-hologram-bg.png). */}
        <div className="absolute inset-0 opacity-[0.42] bg-[radial-gradient(ellipse_85%_72%_at_50%_42%,rgba(45,212,191,0.28)_0%,transparent_68%)]" />
        <div className="absolute inset-0 opacity-[0.35] bg-[radial-gradient(circle_at_28%_38%,rgba(139,92,246,0.14)_0%,transparent_52%)]" />
        <div className="absolute inset-0 opacity-[0.14] bg-[linear-gradient(rgba(52,211,153,0.35)_1px,transparent_1px),linear-gradient(90deg,rgba(52,211,153,0.35)_1px,transparent_1px)] bg-size-[28px_28px]" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/92 via-background/35 to-background/92" />
        <div className="absolute inset-0 bg-gradient-to-b from-teal-500/[0.06] via-transparent to-violet-500/[0.04]" />
      </div>

      <div className="relative z-10 flex items-center justify-between gap-6 max-w-5xl w-full mx-auto">
        
        {/* Left Bars */}
        <div className="flex flex-col gap-6 w-[185px]">
          <ProgressBar label="Exercise" value={scores.exercise} icon={Dumbbell} fillClass="bg-gradient-to-r from-emerald-500 to-teal-400" side="left" />
          <ProgressBar label="Water" value={scores.water} icon={Droplets} fillClass="bg-gradient-to-r from-teal-400 to-emerald-400" side="left" />
          <ProgressBar label="Nutrition" value={scores.food} icon={Utensils} fillClass="bg-gradient-to-r from-emerald-400 to-teal-300" side="left" />
        </div>

        {/* Center: human silhouette + particles (R3F) */}
        <div className="hidden md:flex flex-shrink-0 w-[380px] h-[360px] items-center justify-center pointer-events-auto">
          <ThreeCanvas
            className="h-full w-full min-h-[320px]"
            camera={{ position: [0, 0, 6], fov: 45 }}
          >
            <WellnessBodyScene averageScore={averageScore} />
          </ThreeCanvas>
        </div>

        {/* Right Bars */}
        <div className="flex flex-col gap-6 w-[185px]">
          <ProgressBar label="Stress" value={scores.stress} icon={Brain} fillClass="bg-gradient-to-r from-teal-500 to-cyan-400" side="right" />
          <ProgressBar label="Mindset" value={scores.relaxation} icon={User} fillClass="bg-gradient-to-r from-emerald-500/95 to-teal-400/95" side="right" />
          <ProgressBar label="Sleep" value={scores.sleep} icon={Moon} fillClass="bg-gradient-to-r from-cyan-500 to-emerald-400" side="right" />
        </div>

      </div>
    </div>
  );
}