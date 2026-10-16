"use client";

/** Three animated bars marking the row that's currently playing. */
export function Equalizer({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex h-4 w-4 items-end justify-center gap-[2px] text-spotify ${className}`}
    >
      <span className="eq-bar h-full w-[3px] bg-current [animation-delay:-200ms]" />
      <span className="eq-bar h-full w-[3px] bg-current [animation-delay:-600ms]" />
      <span className="eq-bar h-full w-[3px] bg-current [animation-delay:-400ms]" />
    </span>
  );
}