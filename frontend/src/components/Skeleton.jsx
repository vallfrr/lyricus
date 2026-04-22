export function SkeletonBlock({ w = 100 }) {
  return (
    <div
      className="h-4 bg-muted-foreground/10 animate-pulse"
      style={{ width: `${w}%` }}
    />
  );
}

export function LyricsSkeleton() {
  const lines = [70, 50, 85, 60, 75, 40, 90, 55, 65, 80, 45, 70];
  return (
    <div className="flex flex-col gap-5">
      {lines.map((w, i) => (
        <SkeletonBlock key={i} w={w} />
      ))}
    </div>
  );
}
