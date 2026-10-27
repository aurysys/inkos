import { useState } from "react";
import { getUiLocale } from "../lib/app-language";

export function LanguageSelector({ onSelect }: { onSelect: (lang: "zh" | "en") => void }) {
  const [hovering, setHovering] = useState<"zh" | "en" | null>(null);
  const [selected, setSelected] = useState<"zh" | "en" | null>(null);
  const isKoUi = getUiLocale() === "ko";

  const handleSelect = (lang: "zh" | "en") => {
    setSelected(lang);
    // Brief pause for the selection animation before transitioning
    setTimeout(() => onSelect(lang), 400);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8">
      {/* Logo — cinematic scale */}
      <div className="mb-16 text-center">
        <div className="flex items-baseline justify-center gap-1.5 mb-4">
          <span className="font-serif text-6xl italic text-primary">Ink</span>
          <span className="text-5xl font-semibold tracking-tight text-foreground">OS</span>
        </div>
        <div className="text-base text-muted-foreground tracking-widest uppercase">Studio</div>
      </div>

      {isKoUi && (
        <div className="-mt-8 mb-12 max-w-xl text-center space-y-2">
          <h1 className="text-xl font-semibold text-foreground">기본 집필 언어 선택</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            작품 본문을 쓸 기본 언어를 고릅니다. 화면 언어(한국어)와는 별개입니다.
            <br />
            한국어 집필은 아직 지원하지 않습니다.
          </p>
        </div>
      )}

      {/* Language cards — generous, distinct, immersive */}
      <div className="flex gap-8 mb-16">
        <button
          onClick={() => handleSelect("zh")}
          onMouseEnter={() => setHovering("zh")}
          onMouseLeave={() => setHovering(null)}
          className={`group w-80 border rounded-lg p-10 text-left transition-all duration-300 ${
            selected === "zh"
              ? "border-primary bg-primary/10 scale-[1.02]"
              : hovering === "zh"
                ? "border-primary/50 bg-card"
                : "border-border bg-card/50"
          }`}
        >
          <div className="font-serif text-3xl mb-4 text-foreground">中文创作</div>
          {isKoUi && <div className="-mt-2 mb-4 text-sm font-medium text-primary">중국어로 집필</div>}
          <div className="text-base text-foreground/70 leading-relaxed mb-6">
            玄幻 · 仙侠 · 都市 · 恐怖 · 通用
          </div>
          <div className="text-sm text-muted-foreground">
            番茄小说 · 起点中文网 · 飞卢
          </div>
        </button>

        <button
          onClick={() => handleSelect("en")}
          onMouseEnter={() => setHovering("en")}
          onMouseLeave={() => setHovering(null)}
          className={`group w-80 border rounded-lg p-10 text-left transition-all duration-300 ${
            selected === "en"
              ? "border-primary bg-primary/10 scale-[1.02]"
              : hovering === "en"
                ? "border-primary/50 bg-card"
                : "border-border bg-card/50"
          }`}
        >
          <div className="font-serif text-3xl italic mb-4 text-foreground">English Writing</div>
          {isKoUi && <div className="-mt-2 mb-4 text-sm font-medium text-primary">영어로 집필</div>}
          <div className="text-base text-foreground/70 leading-relaxed mb-6">
            LitRPG · Progression · Romantasy · Sci-Fi · Isekai
          </div>
          <div className="text-sm text-muted-foreground">
            Royal Road · Kindle Unlimited · Scribble Hub
          </div>
        </button>
      </div>

      <div className="text-sm text-muted-foreground">
        {isKoUi ? "집필 언어는 나중에 설정에서 바꿀 수 있습니다." : "可在设置中更改 · Can be changed in Settings"}
      </div>
    </div>
  );
}
