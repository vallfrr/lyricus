// Umami event tracking — safe no-op if script not loaded
export function track(event, data) {
  if (typeof window !== "undefined" && window.umami) {
    window.umami.track(event, data);
  }
}
