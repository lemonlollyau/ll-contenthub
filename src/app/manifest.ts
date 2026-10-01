import type { MetadataRoute } from "next";

// Lets "Add to Home Screen" open the phone Pick page full-screen, like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "lemonlolly Pick",
    short_name: "Pick",
    description: "Pick client photos on your phone and send them to Content Studio.",
    start_url: "/pick",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#fafaf9",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
