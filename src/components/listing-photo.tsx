// The card photo on /eat and /stay — the first entry of a listing's images[].
//
// ALT COMES FROM THE LIBRARY, which is why this takes the library rather than
// just a name. A listing photo is content, not decoration: it shows the room,
// the patio, the plate. Rendering it alt="" would be silently dropping the one
// thing a visitor using a screen reader would want described. That is also why
// the admin picker flags an undescribed photo.
//
// When nothing describes the photo we render NOTHING rather than an
// undescribed image. Unlike a photo slot there is no shipped fallback alt to
// borrow here, so the choice is between an image announced as nothing and no
// image at all — and a card without a photo is a complete, correct card. The
// admin UI is where that gets fixed, and it says so.

import Image from "next/image";
import { mediaUrl, type MediaItem } from "@/lib/media/refs";

export function ListingPhoto({
  images,
  library,
  className = "",
}: {
  images: string[] | undefined;
  library: Record<string, MediaItem>;
  className?: string;
}) {
  const name = images?.[0];
  if (!name) return null;

  const item = library[name];
  // Missing from the library (removed, or a restored row pointing at a photo
  // that is gone) — same treatment as undescribed: show no photo, never a
  // broken one.
  if (!item) return null;

  const alt = item.alt.trim();
  if (!alt) return null;

  return (
    <div
      className={`relative -mx-4 -mt-4 mb-3 aspect-[3/2] overflow-hidden rounded-t-xl sm:-mx-6 sm:-mt-6 ${className}`}
    >
      <Image
        src={mediaUrl(name)}
        alt={alt}
        fill
        // Cards sit in a 1/2/3-up grid depending on width. Overstating this
        // would ship a desktop-sized file to a phone on the ferry.
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className="object-cover"
      />
    </div>
  );
}
