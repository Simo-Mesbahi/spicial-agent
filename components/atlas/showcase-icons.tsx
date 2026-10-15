import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
function icon(name: string) {
  return function ShowcaseIcon({ size = 18, ...props }: IconProps) {
    return (
      <svg
        {...props}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <use href={`/showcase/icons.svg#${name}`} />
      </svg>
    );
  };
}

export const ArrowLeft = icon('ArrowLeft');
export const ArrowRight = icon('ArrowRight');
export const ArrowUpRight = icon('ArrowUpRight');
export const BookOpen = icon('BookOpen');
export const Check = icon('Check');
export const FileCheck2 = icon('FileCheck2');
export const Headphones = icon('Headphones');
export const Layers3 = icon('Layers3');
export const LockKeyhole = icon('LockKeyhole');
export const Mail = icon('Mail');
export const MessageSquareText = icon('MessageSquareText');
export const Plus = icon('Plus');
export const RotateCcw = icon('RotateCcw');
export const ShieldCheck = icon('ShieldCheck');
export const SlidersHorizontal = icon('SlidersHorizontal');
export const Sparkles = icon('Sparkles');
export const Truck = icon('Truck');
export const Wrench = icon('Wrench');
