import {
  Zap,
  Search,
  FileOutput,
  TrendingUp,
} from "lucide-react";
import { tr } from "../../lib/app-language";

export interface QuickActionsProps {
  readonly onAction: (command: string, requestedIntent?: "write_next") => void;
  readonly disabled: boolean;
}

/** [zh, en, ko] */
type LocalizedText = readonly [string, string, string];

interface ChipDef {
  readonly id: string;
  readonly icon: React.ReactNode;
  readonly label: LocalizedText;
  // Sent as the user's chat message, so it is shown in the transcript too.
  readonly command: LocalizedText;
  readonly requestedIntent?: "write_next";
}

const CHIPS: ReadonlyArray<ChipDef> = [
  {
    id: "write-next",
    icon: <Zap size={12} />,
    label: ["写下一章", "Write next", "다음 챕터 쓰기"],
    command: ["写下一章", "write next", "다음 챕터 쓰기"],
    requestedIntent: "write_next",
  },
  {
    id: "audit",
    icon: <Search size={12} />,
    label: ["审计", "Audit", "검토"],
    command: ["审计", "audit", "검토"],
  },
  {
    id: "export",
    icon: <FileOutput size={12} />,
    label: ["导出", "Export", "내보내기"],
    command: ["导出全书", "export book", "책 전체 내보내기"],
  },
  {
    id: "market-radar",
    icon: <TrendingUp size={12} />,
    label: ["市场雷达", "Market radar", "시장 레이더"],
    command: ["扫描市场趋势", "scan market trends", "시장 트렌드 분석"],
  },
];

export function QuickActions({ onAction, disabled }: QuickActionsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto px-1 py-1">
      {CHIPS.map((chip) => {
        const label = tr(...chip.label);
        const command = tr(...chip.command);
        return (
          <button
            key={chip.id}
            onClick={() => onAction(command, chip.requestedIntent)}
            disabled={disabled}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/30 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-40 disabled:pointer-events-none group"
          >
            <span className="group-hover:scale-110 transition-transform">{chip.icon}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
