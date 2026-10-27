import type { EndpointGroup } from "../store/service/types";
import { tr } from "../lib/app-language";

export const GROUP_ORDER: ReadonlyArray<EndpointGroup> = [
  "aggregator",
  "overseas",
  "china",
  "local",
  "codingPlan",
] as const;

// 标签在渲染时通过 tr() 取值，不能在模块加载时固化成单一语言字符串，
// 所以这里存 zh/en 对，由下方 getGroupLabel 等函数在调用时解析。
const GROUP_LABELS: Record<EndpointGroup, { zh: string; en: string; ko: string }> = {
  overseas: { zh: "海外原厂", en: "International providers", ko: "해외 서비스" },
  china: { zh: "国产原厂", en: "China providers", ko: "중국 서비스" },
  aggregator: { zh: "聚合 API", en: "Aggregator APIs", ko: "통합 API" },
  local: { zh: "本地 / 订阅", en: "Local / Subscription", ko: "로컬 / 구독" },
  codingPlan: { zh: "CodingPlan", en: "CodingPlan", ko: "CodingPlan" },
};

const GROUP_DESCRIPTIONS: Partial<Record<EndpointGroup, { zh: string; en: string; ko: string }>> = {
  aggregator: {
    zh: "聚合国内外主流模型，适合用一个 API Key 接入多模型的场景。",
    en: "Aggregates mainstream models from multiple vendors — access many models with one API key.",
    ko: "여러 회사의 주요 모델을 한데 모은 서비스로, API 키 하나로 여러 모델을 쓸 때 적합합니다.",
  },
};

const GROUP_SHORT_LABELS: Record<EndpointGroup, { zh: string; en: string; ko: string }> = {
  overseas: { zh: "海外", en: "Intl", ko: "해외" },
  china: { zh: "国产", en: "China", ko: "중국" },
  aggregator: { zh: "聚合", en: "Aggregator", ko: "통합" },
  local: { zh: "本地", en: "Local", ko: "로컬" },
  codingPlan: { zh: "CodingPlan", en: "CodingPlan", ko: "CodingPlan" },
};

export function getGroupLabel(group: EndpointGroup): string {
  const label = GROUP_LABELS[group];
  return tr(label.zh, label.en, label.ko);
}

export function getGroupDescription(group: EndpointGroup): string | null {
  const desc = GROUP_DESCRIPTIONS[group];
  return desc ? tr(desc.zh, desc.en, desc.ko) : null;
}

export function getGroupShortLabel(group: EndpointGroup): string {
  const label = GROUP_SHORT_LABELS[group];
  return tr(label.zh, label.en, label.ko);
}
