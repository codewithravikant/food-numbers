/**
 * FitNexus logo badge — gradient circle + oversized logo overlay.
 *
 * QUICK GUIDE — what to edit for what:
 * ---------------------------------------------------------------------------
 * | Goal                         | Where to change                          |
 * ---------------------------------------------------------------------------
 * | Bigger / smaller circle      | `sizeClasses.*.circle` (h-/w- Tailwind)  |
 * | Bigger / smaller logo mark   | `sizeClasses.*.logoWrap` h-[…] w-[…]     |
 * | Logo more left / right       | `logoWrap`: `left-1/2` + `-ml-[…]`        |
 * | Logo more up / down          | `logoWrap`: `-translate-y-1/2`, `-mt-*`    |
 * | Half in circle vs more out   | Adjust `-ml-*` vs logo `h/w` (see below) |
 * | Stronger / softer shadow     | Image `className` drop-shadow-[…]        |
 * | Different gradient on circle | Default classes on the circle `<div>`    |
 * | One-off override (e.g. hero) | Pass `circleClassName` / `logoClassName` |
 * | Swap SVG → PNG               | `Image` `src` prop only                  |
 * ---------------------------------------------------------------------------
 *
 * Half-overlap intuition: logo center is at circle center (`left-1/2` +
 * negative margin ≈ half logo width). Tweak `-ml-[…]` in step with logo size
 * so the mark stays visually centered on the circle.
 */

import Image from 'next/image';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Section: size variants
// Add a new key here + matching `sizeClasses` entry if you need e.g. `xl`.
// ---------------------------------------------------------------------------
type FnexLogoBadgeSize = 'sm' | 'md' | 'lg';

// ---------------------------------------------------------------------------
// Section: per-size layout tokens
//
// - circle: Tailwind size + shape for the gradient disk only.
// - logoWrap: absolutely positioned box for `next/image` fill layout.
//   Edit h-[…] w-[…] for logo scale; -ml-[…] nudges horizontal anchor;
//   -mt-* fine-tunes vertical alignment with the circle.
// ---------------------------------------------------------------------------
const sizeClasses: Record<
  FnexLogoBadgeSize,
  {
    circle: string;
    logoWrap: string;
  }
> = {
  sm: {
    // Header / compact rails — keep circle small so row height stays stable.
    circle: 'h-10 w-10',
    // Logo box larger than circle → overlay “flyout”. Match -ml to ~half of h/w.
    logoWrap: 'h-[5.5rem] w-[5.5rem] -translate-y-1/2 left-1/2 -ml-[2.75rem] -mt-1',
  },
  md: {
    // Onboarding top bar — slightly larger than sm.
    circle: 'h-12 w-12',
    logoWrap: 'h-[6.5rem] w-[6.5rem] -translate-y-1/2 left-1/2 -ml-[3.25rem] -mt-1',
  },
  lg: {
    // Auth hero / 404 / landing — largest circle + biggest mark.
    circle: 'h-16 w-16',
    logoWrap: 'h-[9rem] w-[9rem] -translate-y-1/2 left-1/2 -ml-[4.5rem] -mt-2',
  },
};

// ---------------------------------------------------------------------------
// Section: component API
//
// - size: picks one row from `sizeClasses`.
// - className: outer wrapper (e.g. shrink-0, mx-auto) — does not resize circle.
// - circleClassName: merge extra classes on circle (one-off shadow, etc.).
// - logoClassName: merge extra classes on Image (opacity, filters).
// - priority: pass true for above-the-fold logos (LCP).
// ---------------------------------------------------------------------------
export function FnexLogoBadge({
  size = 'sm',
  className,
  circleClassName,
  logoClassName,
  priority = false,
}: {
  size?: FnexLogoBadgeSize;
  className?: string;
  circleClassName?: string;
  logoClassName?: string;
  priority?: boolean;
}) {
  const classes = sizeClasses[size];

  return (
    // ---------------------------------------------------------------------
    // Section: root — stacking context for circle + absolutely positioned logo
    // Change: add padding/margin here if the badge needs space from siblings.
    // ---------------------------------------------------------------------
    <div className={cn('relative flex items-center justify-center', className)}>
      {/* -----------------------------------------------------------------
          Section: gradient circle (“portal”)
          Change: gradient stops, shadow, ring — default look for all usages.
          Per-screen tweaks: use `circleClassName` from parent instead.
          ----------------------------------------------------------------- */}
      <div
        className={cn(
          'rounded-full bg-gradient-to-br from-indigo-500 via-primary to-cyan-400 shadow-[0_0_30px_rgba(139,92,246,0.4)]',
          classes.circle,
          circleClassName
        )}
      />

      {/* -----------------------------------------------------------------
          Section: logo layer (sits above circle, z-10)
          Change size/position: edit `logoWrap` in `sizeClasses` for that size.
          Keep pointer events enabled so clicks on the protruding logo area
          still trigger parent links/buttons.
          ----------------------------------------------------------------- */}
      <div className={cn('pointer-events-auto absolute top-1/2 z-10', classes.logoWrap)}>
        {/* Inner relative box required for next/image fill */}
        <div className="relative h-full w-full">
          <Image
            src="/FNex_Logo.svg"
            alt="FitNexus Logo"
            fill
            sizes="(max-width: 768px) 150px, 200px"
            className={cn(
              // Change: drop-shadow for depth; object-contain keeps SVG aspect ratio.
              'object-contain drop-shadow-[0_12px_20px_rgba(0,0,0,0.4)]',
              logoClassName
            )}
            priority={priority}
          />
        </div>
      </div>
    </div>
  );
}
