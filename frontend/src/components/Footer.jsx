"use client";
import { useI18n } from "@/contexts/I18nContext";

export default function Footer() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-border px-4 py-4 flex items-center justify-between text-[11px] text-muted-foreground">
      <span>
        {t("footer.lyrics")}{" "}
        <a href="https://lrclib.net" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">
          lrclib.net
        </a>
      </span>
      <span>
        {t("footer.by")}{" "}
        <a href="https://github.com/vallfrr/lyricus" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">
          vallfrr
        </a>
      </span>
    </footer>
  );
}
