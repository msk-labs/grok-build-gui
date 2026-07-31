import type { ReactNode } from "react";

type IconProps = {
  size?: number;
};

function IconFrame({
  children,
  size = 16,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </IconFrame>
  );
}

export function ForwardIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m12 5 7 7-7 7" />
      <path d="M5 12h14" />
    </IconFrame>
  );
}

export function ReloadIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M20 6v5h-5" />
      <path d="M19 11a8 8 0 1 0 .3 5" />
    </IconFrame>
  );
}
