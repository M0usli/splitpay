import type { MetadataRoute } from "next";

/**
 * The web app manifest: what a phone needs to know to put this site on the
 * home screen like an app (its name, icon and colours). Next.js serves it at
 * /manifest.webmanifest and links it from every page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SplitPay",
    short_name: "SplitPay",
    description: "A wallet for sending money and splitting bills, with receipt scanning",
    start_url: "/",
    // "standalone" opens it in its own window, without the browser's address bar.
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#18181b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // "maskable" lets Android crop the icon into a circle or rounded square.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
