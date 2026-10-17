"use client";

import { useState } from "react";
import { stationArtStyle, stationInitials } from "@/lib/art";

/**
 * Station artwork with a generated fallback.
 *
 * About a third of the radio directory publishes no logo, and some logos are
 * hotlink-blocked or simply 404. Both cases used to end as a flat colour swatch
 * with nothing in it, which looks like a broken image rather than a missing
 * one. This renders generated initials when there is no usable logo, including
 * when one was supplied but failed to load.
 */
export function StationArt({
  src,
  name,
  className = "h-14 w-14",
}: {
  src?: string;
  name: string;
  className?: string;
}) {
  // Starts optimistic and demotes to the generated art on load failure, so a
  // broken URL never renders as an empty box.
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  if (!showImage) {
    const style = stationArtStyle(name);
    return (
      <div
        className={`${className} flex shrink-0 items-center justify-center overflow-hidden rounded font-bold tracking-tight`}
        style={{ background: style.background, color: style.color }}
        aria-hidden
      >
        <span className="text-sm leading-none">{stationInitials(name)}</span>
      </div>
    );
  }

  return (
    <div className={`${className} relative shrink-0 overflow-hidden rounded`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
      <FallbackUnderneath name={name} />
    </div>
  );
}

/**
 * Sits behind the image so the generated art is already painted if the image
 * fails, rather than appearing a frame later.
 */
function FallbackUnderneath({ name }: { name: string }) {
  const style = stationArtStyle(name);
  return (
    <span
      className="absolute inset-0 flex items-center justify-center font-bold"
      style={{ background: style.background, color: style.color }}
      aria-hidden
    >
      {stationInitials(name)}
    </span>
  );
}

export { stationInitials, stationArtStyle, RadioIconFallback };

function RadioIconFallback({ size }: { size: number }) {
  // Kept for callers that want the glyph rather than initials.
  return <span style={{ fontSize: size }} aria-hidden>♪</span>;
}
